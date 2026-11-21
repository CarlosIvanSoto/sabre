#!/usr/bin/env node
// Primera llamada real de ADR-034 (#272, U.6 de plan-v0-9): `session.reservation.confirmAirSegments`
// y `removeAirSegments` contra producción, con la API pública del SDK compilado. Lo corre el
// usuario a mano, con su ok en cada corrida; nunca la CI. Necesita `npm run build` antes.
//
// Tres pasos, elegidos con SABRE_UPDATE_STEP. Una sola sesión SOAP por corrida, cerrada siempre.
//
// A. `read` (default), SOLO LECTURA. Lista las colas SABRE_UPDATE_QUEUES (5 y 6: ahí están los PNR
//    con TK de cambio de horario, ver sabre-wiki/wiki/concepts/cambio-de-horario.md), revisa hasta
//    SABRE_UPDATE_SCAN PNR con `GetReservationRQ` `Stateless` (no deja nada en el AAA) y elige el
//    primero con un segmento en TK. Con SABRE_UPDATE_LOCATOR, salta las colas y lee ese PNR. Del
//    elegido graba el `GetReservationRQ` `Stateful` (el mismo request que manda el SDK antes de
//    escribir, por el método interno de la sesión: el SDK no tiene una lectura pública de STL) y,
//    ya con la sesión cerrada, su `booking.get` (REST), para comparar los ids STL con
//    `flights[].itemId` (Q-140). Nunca llama a confirmAirSegments ni a removeAirSegments.
//
//      SABRE_ENVIRONMENT=production node --env-file=.env.production scripts/validate-update-reservation.mjs
//
// B. `confirm`, ESCRITURA: `confirmAirSegments` (CONFIRM-ALL) sobre SABRE_UPDATE_LOCATOR con
//    SABRE_UPDATE_EXPECTED_IDS. C. `remove`, ESCRITURA: `removeAirSegments` (`op="D"`) de
//    SABRE_UPDATE_SEGMENT_IDS, con el default del SDK (solo UN y HX; el script no deja ampliarlo).
//    Sin candado, los dos son una corrida en seco: imprimen lo que harían y no llaman a Sabre ni
//    leen credenciales. Solo escriben con SABRE_UPDATE_WRITE=<paso>:<localizador> (p. ej.
//    `confirm:ABC123`), que repite el paso y el localizador, y en producción. Un candado que no
//    cuadra corta con código 2 sin escribir. Después de escribir, y con la sesión ya cerrada, relee
//    con `booking.get`.
//
//      SABRE_ENVIRONMENT=production SABRE_UPDATE_STEP=confirm SABRE_UPDATE_LOCATOR=ABC123 \
//        SABRE_UPDATE_EXPECTED_IDS=3,4 node --env-file=.env.production scripts/validate-update-reservation.mjs
//      … y con SABRE_UPDATE_WRITE=confirm:ABC123 para escribir de verdad.
//
// Variables: las credenciales (scripts/lib/env-credentials.mjs, siempre v3), SABRE_ENVIRONMENT
// (`sandbox` por defecto), SABRE_QUEUE_PCC (el PCC de las colas y el `targetPcc` de `booking.get`;
// `target` toma SABRE_TARGET_PCC; sin ella, el de la sesión), SABRE_UPDATE_RECEIVED_FROM
// (`SABRE CLIENT U6` por defecto; Q-141) y las de cada paso de arriba.
//
// Fixtures en test/fixtures: get-reservation.<entorno>-schedule-change.json (A) y
// update-reservation.<entorno>-confirm.json / -remove.json (B, C). Guardan los requests
// (`onRawRequest`) y las respuestas (`onRawResponse`) de la reserva y de `booking.get`, no los de
// colas. Anonimización por lista blanca (scripts/lib/update-reservation.mjs): localizadores (del
// PNR y de la aerolínea) a alias, PCC a XXXX, firmas a AAA, y nombres, teléfonos, correos,
// boletos, remarks y `ReceivedFrom` enmascarados. Si queda un dato real, no escribe nada (código 1).
// La consola sí muestra el localizador real del elegido: hace falta para el paso B o C.
import { writeFileSync } from 'node:fs';
import { Sabre, SabreReservationUpdateError, SabreUncertainOutcomeError } from '../dist/index.js';
import { createAnonymizer } from '../dist/testing.js';
import { fileTokenStore } from './file-token-store.mjs';
import { legacyClient, legacyEnvironment, sessionSendOf } from './lib/legacy-recorder.mjs';
import {
  REMOVABLE_STATUSES,
  compareSegmentIds,
  createScrubber,
  describeError,
  getReservationPayload,
  mask,
  previewUpdate,
  readStlReservation,
  receivedFromShape,
  resolvePlan,
  statusCounts,
} from './lib/update-reservation.mjs';

const plan = resolvePlan(process.env);
if (plan.error !== undefined) {
  console.error(plan.error);
  process.exit(2);
}

if (plan.step !== 'read' && !plan.write) {
  const method = plan.step === 'confirm' ? 'confirmAirSegments' : `removeAirSegments (allowedStatuses: ${REMOVABLE_STATUSES.join(', ')})`;
  console.log(`EN SECO: no se llama a Sabre. Entorno ${plan.environment}, ${method} sobre ${plan.locator}`);
  console.log(`${plan.step === 'confirm' ? 'expectedSegmentIds' : 'segmentIds'}: ${plan.segmentIds.join(', ')} · receivedFrom: "${plan.receivedFrom}" (${plan.receivedFrom.length} caracteres)\n`);
  console.log(previewUpdate(plan));
  console.log(`\nPara escribir de verdad, con el ok del usuario: SABRE_UPDATE_WRITE=${plan.lock}${plan.environment === 'production' ? '' : ' y SABRE_ENVIRONMENT=production'}`);
  process.exit(0);
}

const { environment, credentials, queuePcc, queuePccLabel, secrets } = legacyEnvironment();
const anonymizer = createAnonymizer({ secrets: [...secrets, process.env.SABRE_TARGET_PCC] });
const scrub = createScrubber({ aliasOf: anonymizer.aliasOf, secrets: [...secrets, process.env.SABRE_TARGET_PCC] });

// ---------- Captura ----------

const RECORDED = new Set(['reservation.get', 'reservation.confirmAirSegments', 'reservation.removeAirSegments', 'booking.get']);
const requests = [];
const responses = [];
const hooks = {
  onRawRequest: (raw) => {
    if (RECORDED.has(raw.operation)) requests.push({ operation: raw.operation, protocol: raw.protocol, method: raw.method, url: raw.url, body: raw.body });
  },
  onRawResponse: (raw) => {
    if (RECORDED.has(raw.operation)) responses.push({ operation: raw.operation, status: raw.status, attempts: raw.attempts, body: raw.body });
  },
};
const events = [];
const logger = Object.fromEntries(
  ['debug', 'info', 'warn', 'error'].map((level) => [level, (message, context) => events.push({ level, message, context: JSON.parse(JSON.stringify(context ?? {})) })]),
);
const results = [];

/** Corre un paso y anota su resultado. Si falla, sigue: devuelve `{ error }`. */
async function step(name, run, summarize = () => undefined) {
  try {
    const value = await run();
    results.push({ step: name, ok: true, ...(summarize(value) ?? {}) });
    return { value };
  } catch (error) {
    results.push({ step: name, ok: false, error: describeError(error) });
    return { error };
  }
}

const legacy = legacyClient(environment, credentials, logger);
const sabre = new Sabre({ environment, credentials, retry: { maxRetries: 0 }, tokenStore: fileTokenStore, logger });
const targetPcc = queuePcc === undefined ? {} : { targetPcc: queuePcc };

async function openSession() {
  const session = await legacy.openSession();
  const send = sessionSendOf(session);
  return { session, send };
}

/** `GetReservationRQ` por el método interno de la sesión (un truco de los scripts, no API pública). */
const rawGet = ({ session, send }, locator, requestType, operation) => {
  if (send === undefined) throw new Error('no se encontró sessionSend en el prototipo de la sesión');
  return session[send]({
    service: 'updateReservation',
    action: 'GetReservationRQ',
    payload: getReservationPayload(locator, requestType),
    idempotent: true,
    operation,
    ...hooks,
  });
};

const bookingGet = (name, locator) =>
  step(name, () => sabre.booking.get({ confirmationId: locator, ...targetPcc }, hooks), (r) => ({
    flights: r.flights?.length ?? 0,
    warnings: r.warnings.length,
    errors: r.errors.map(describeError),
  }));

/** Lo que se graba de cada segmento STL: vuelos e ids, nada de personas. */
const segmentRow = (s) => ({
  airId: s.airId,
  segmentId: s.segmentId,
  productId: s.productId,
  sequence: s.sequence,
  status: s.status,
  flight: `${s.carrier ?? '?'}${s.flightNumber ?? '?'}`,
  route: `${s.from ?? '?'}-${s.to ?? '?'}`,
  departure: s.departure,
  arrival: s.arrival,
  scheduleChangeIndicator: s.scheduleChangeIndicator,
  ...(s.marriage === undefined ? {} : { marriage: s.marriage }),
});
const restFlightRow = (f) => ({
  itemId: f.itemId,
  flight: `${f.airlineCode ?? '?'}${f.flightNumber ?? '?'}`,
  route: `${f.fromAirportCode ?? '?'}-${f.toAirportCode ?? '?'}`,
  departure: `${f.departureDate ?? '?'}T${f.departureTime ?? '?'}`,
  flightStatusCode: f.flightStatusCode,
  flightStatusName: f.flightStatusName,
});

function printSegments(title, segments, comparison) {
  console.log(`\n${title}`);
  console.table(
    segments.map((s) => {
      const pair = comparison?.pairs.find((p) => p.airId === s.airId);
      return { 'Air@id': s.airId, 'Segment@id': s.segmentId, 'Product@id': s.productId, seq: s.sequence, status: s.status, vuelo: `${s.carrier}${s.flightNumber}`, ruta: `${s.from}-${s.to}`, salida: s.departure, itemId: pair?.itemId ?? '—' };
    }),
  );
}

// ---------- Fixture ----------

const isXml = (body) => typeof body === 'string' && body.trimStart().startsWith('<');
function scrubBody(body) {
  if (body === undefined || body === '') return body;
  if (isXml(body)) return scrub.xml(body);
  try {
    return JSON.stringify(scrub.json(JSON.parse(body)));
  } catch {
    return mask(body);
  }
}

/** Anonimiza todo, revisa que no quede un dato real y escribe; si queda uno, corta con código 1. */
function writeFixture(name, meta, findings) {
  // Primero los sobres: ahí se registran los localizadores de la aerolínea.
  const recordedRequests = requests.map((r) => ({ ...r, url: scrub.text(r.url), body: scrubBody(r.body) }));
  const recordedResponses = responses.map((r) => ({ ...r, body: scrubBody(r.body) }));
  const clean = (value) => JSON.parse(scrub.text(JSON.stringify(value)));
  const fixture = {
    recordedAt: new Date().toISOString().slice(0, 10),
    environment,
    ...clean(meta),
    results: clean(results),
    findings: clean(findings),
    events: clean(events),
    requests: recordedRequests,
    responses: recordedResponses,
  };
  const text = `${JSON.stringify(fixture, null, 2)}\n`;
  for (const r of fixture.results) console.log(`${r.ok ? '✔' : '✘'} ${r.step} ${JSON.stringify({ ...r, step: undefined, ok: undefined })}`);
  console.log('\nhallazgos:', JSON.stringify(fixture.findings, null, 2));
  const found = [...anonymizer.leaks(text), ...scrub.leaks(text)];
  if (found.length > 0) {
    console.error(`⚠️ la fixture todavía trae datos reales (${[...new Set(found)].join(', ')}): no se escribe.`);
    process.exit(1);
  }
  const file = new URL(`../test/fixtures/${name}.json`, import.meta.url);
  writeFileSync(file, text);
  console.log(`fixture: ${file.pathname}`);
}

const parsedResponses = (operation) => responses.filter((r) => r.operation === operation && isXml(r.body)).map((r) => ({ raw: r.body, ...readStlReservation(r.body) }));
const restFlights = () => {
  const last = responses.filter((r) => r.operation === 'booking.get').at(-1);
  try {
    return JSON.parse(last?.body ?? '{}').flights ?? [];
  } catch {
    return [];
  }
};

// ---------- A. Lectura ----------

async function readStep() {
  console.log(`entorno ${environment} · SOLO LECTURA · ${plan.locator === undefined ? `colas ${plan.queues.join(', ')}, hasta ${plan.scan} PNR` : `PNR ${plan.locator}`} · PCC de las colas: ${queuePccLabel}`);
  const pccRequest = queuePcc === undefined ? {} : { pcc: queuePcc };
  const candidates = [];
  let chosen = plan.locator;
  const conn = await openSession();
  try {
    if (chosen === undefined) {
      const queueOf = new Map();
      for (const queue of plan.queues) {
        const listed = await step(`list cola ${queue}`, () => conn.session.queue.list({ queue, ...pccRequest }), (r) => ({ locators: r.locators.length }));
        for (const locator of listed.value?.locators ?? []) if (!queueOf.has(locator)) queueOf.set(locator, queue);
      }
      for (const [locator, queue] of [...queueOf].slice(0, plan.scan)) {
        const read = await step(`revisar ${scrub.alias(locator)} (Stateless)`, () => rawGet(conn, locator, 'Stateless', 'reservation.scan'), () => ({}));
        if (read.value === undefined) continue;
        const pnr = readStlReservation(read.value.raw);
        candidates.push({ locator, queue, statuses: statusCounts(pnr.segments), errors: pnr.errors.map((e) => e.code) });
      }
      chosen = candidates.find((c) => (c.statuses.TK ?? 0) > 0)?.locator;
    } else {
      scrub.alias(chosen);
    }
    if (chosen !== undefined) await step('GetReservationRQ Stateful', () => rawGet(conn, chosen, 'Stateful', 'reservation.get'), () => ({}));
  } finally {
    await step('close', () => conn.session.close());
  }

  if (candidates.length > 0) {
    console.log('\ncandidatos (la consola muestra el localizador real; la fixture, el alias):');
    console.table(candidates.map((c) => ({ localizador: c.locator, alias: scrub.alias(c.locator), cola: c.queue, estados: JSON.stringify(c.statuses), errores: c.errors.join(' ') })));
  }
  const stateful = parsedResponses('reservation.get').at(-1);
  if (chosen === undefined || stateful === undefined) {
    console.log(chosen === undefined ? '\nningún PNR revisado tiene TK: no se graba fixture. Sube SABRE_UPDATE_SCAN o elige otra cola.' : '\nel GetReservationRQ Stateful falló: no se graba fixture.');
    return;
  }

  await bookingGet('booking.get', chosen);
  const flights = restFlights();
  const comparison = compareSegmentIds(stateful.segments, flights);
  printSegments(`segmentos de ${chosen} (alias ${scrub.alias(chosen)}):`, stateful.segments, comparison);
  const tk = stateful.segments.filter((s) => s.status === 'TK').map((s) => s.airId);
  const removable = stateful.segments.filter((s) => REMOVABLE_STATUSES.includes(s.status)).map((s) => s.airId);
  const base = `SABRE_ENVIRONMENT=${environment} SABRE_UPDATE_LOCATOR=${chosen}`;
  if (tk.length > 0) console.log(`\npaso B, en seco: ${base} SABRE_UPDATE_STEP=confirm SABRE_UPDATE_EXPECTED_IDS=${tk.join(',')}`);
  if (removable.length > 0) console.log(`paso C, en seco: ${base} SABRE_UPDATE_STEP=remove SABRE_UPDATE_SEGMENT_IDS=<de ${removable.join(',')}>`);

  const statuses = statusCounts(stateful.segments);
  writeFixture(
    `get-reservation.${environment}-schedule-change`,
    { step: 'read', queues: plan.locator === undefined ? plan.queues : undefined, scanned: candidates.length, locator: chosen },
    {
      candidates: candidates.map((c) => ({ locator: c.locator, queue: c.queue, statuses: c.statuses, errors: c.errors })),
      segments: stateful.segments.map(segmentRow),
      restFlights: flights.map(restFlightRow),
      stl: { payloadName: stateful.payloadName, errors: stateful.errors, applicationResults: stateful.applicationResults ?? null },
      // Q-139: qué estados conviven con el TK (KK/KL/TL los tocaría CONFIRM-ALL) y si
      // ScheduleChangeIndicator sirve de señal.
      q139: {
        statuses,
        otherConfirmable: ['KK', 'KL', 'TL', 'TN'].filter((s) => statuses[s] !== undefined),
        scheduleChangeIndicator: [...new Set(stateful.segments.filter((s) => s.status === 'TK').map((s) => s.scheduleChangeIndicator))],
        candidatesWithOtherConfirmable: candidates.filter((c) => ['KK', 'KL', 'TL', 'TN'].some((s) => c.statuses[s] !== undefined)).length,
      },
      // Q-140: Air@id, Segment@id y Product@id contra flights[].itemId, y si Get Booking lista los UN/HX.
      q140: { ...comparison, restListsRemovable: removable.length === 0 ? undefined : removable.every((id) => comparison.pairs.find((p) => p.airId === id)?.matched) },
      // Q-141: cómo guarda el PNR el ReceivedFrom (elementos y largos, sin el valor).
      q141: { receivedFromInPnr: receivedFromShape(stateful.raw) ?? null },
    },
  );
}

// ---------- B y C. Escritura ----------

async function writeStep() {
  const method = plan.step === 'confirm' ? 'confirmAirSegments' : 'removeAirSegments';
  const operation = `reservation.${method}`;
  const request =
    plan.step === 'confirm'
      ? { locator: plan.locator, receivedFrom: plan.receivedFrom, expectedSegmentIds: plan.segmentIds }
      : { locator: plan.locator, receivedFrom: plan.receivedFrom, segmentIds: plan.segmentIds };
  scrub.alias(plan.locator);
  console.log(`entorno ${environment} · ESCRITURA · ${method} sobre ${plan.locator} · ids ${plan.segmentIds.join(', ')} · receivedFrom "${plan.receivedFrom}"`);

  const conn = await openSession();
  let outcome;
  try {
    outcome = await step(method, () => conn.session.reservation[method](request, hooks), (r) => ({
      status: r.status,
      locator: r.locator,
      changed: r.changed,
      warnings: r.warnings,
      respondedAt: r.respondedAt,
      segments: r.segments,
    }));
  } finally {
    await step('close', () => conn.session.close());
  }

  if (outcome.error instanceof SabreUncertainOutcomeError) {
    console.error(`\n⚠️ INCIERTO (${outcome.error.reason}): Sabre pudo haber aplicado el cambio. No repitas la escritura: el booking.get de abajo, o el paso read con SABRE_UPDATE_LOCATOR=${plan.locator}, dice cómo quedó.`);
    process.exitCode = 3;
  } else if (outcome.error instanceof SabreReservationUpdateError) {
    console.error(`\nno se escribió (${outcome.error.reason}${outcome.error.code === outcome.error.reason ? '' : ` ${outcome.error.code}`}): ${outcome.error.message}`);
  } else if (outcome.error !== undefined) {
    console.error(`\nfalló: ${outcome.error.name}: ${outcome.error.message}`);
  }

  await bookingGet('booking.get después', plan.locator);
  const flights = restFlights();
  const stl = parsedResponses(operation);
  const before = stl.find((r) => r.payloadName === 'GetReservationRS');
  const after = stl.find((r) => r.payloadName === 'UpdateReservationRS');
  const statusById = (r) => Object.fromEntries((r?.segments ?? []).map((s) => [s.airId, s.status]));
  const was = statusById(before);
  const now = statusById(after);
  const transitions = Object.entries(was).map(([id, status]) => ({ id, before: status, after: now[id] ?? (after?.hasReservation ? 'borrado' : '?') }));
  const result = outcome.value;
  if (before !== undefined) printSegments('antes (GetReservationRS):', before.segments);
  if (after !== undefined) printSegments('después (UpdateReservationRS):', after.segments, compareSegmentIds(after.segments, flights));

  writeFixture(
    `update-reservation.${environment}-${plan.step}`,
    { step: plan.step, locator: plan.locator, segmentIds: plan.segmentIds, receivedFromLength: plan.receivedFrom.length },
    {
      outcome: result === undefined ? { error: describeError(outcome.error) } : { status: result.status, changed: result.changed, warnings: result.warnings },
      uncertain: outcome.error instanceof SabreUncertainOutcomeError,
      updateSent: requests.some((r) => r.operation === operation && r.body?.includes('UpdateReservationRQ')),
      transitions,
      segmentsBefore: before?.segments.map(segmentRow) ?? null,
      segmentsAfter: after?.segments.map(segmentRow) ?? null,
      restFlightsAfter: flights.map(restFlightRow),
      update:
        after === undefined
          ? null
          : { success: after.success, errors: after.errors, updateResults: after.updateResults, applicationResults: after.applicationResults ?? null, sequences: after.segments.map((s) => `${s.airId}/${s.sequence}`) },
      // Q-139 (confirm): qué pasó con lo que no era TK (KK/KL/TL) y si Results viene vacío.
      q139:
        plan.step === 'confirm'
          ? {
              nonTkChanged: transitions.filter((t) => t.before !== 'TK' && t.after !== t.before).map((t) => `${t.id} ${t.before}→${t.after}`),
              tkNotConfirmed: transitions.filter((t) => t.before === 'TK' && t.after !== 'HK').map((t) => `${t.id} TK→${t.after}`),
              resultsEmpty: after === undefined ? null : after.updateResults.length === 0,
            }
          : undefined,
      // Q-140 (remove): si op="D" borró los UN/HX y si itemId sigue igual al id STL después.
      q140: {
        removed: plan.step === 'remove' ? plan.segmentIds.map((id) => ({ id, before: was[id], gone: after === undefined ? null : !(id in now) })) : undefined,
        idsAfter: after === undefined ? null : compareSegmentIds(after.segments, flights),
      },
      // Q-141: si el EPR pudo escribir y cómo vuelve el ReceivedFrom (elementos y largos).
      q141: {
        wrote: result !== undefined && result.status !== 'noop',
        errorCode: outcome.error?.code ?? null,
        receivedFromLength: plan.receivedFrom.length,
        receivedFromInResponse: after === undefined ? null : (receivedFromShape(after.raw) ?? null),
      },
    },
  );
}

if (plan.step === 'read') await readStep();
else await writeStep();
