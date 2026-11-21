#!/usr/bin/env node
// Primera llamada real de ADR-034 (#272, U.6 de plan-v0-9): `session.reservation.confirmAirSegments`
// y `removeAirSegments` contra producción, con la API pública del SDK compilado. Lo corre el
// usuario a mano, con su ok en cada corrida; nunca la CI. Necesita `npm run build` antes.
//
// Cuatro pasos, elegidos con SABRE_UPDATE_STEP. Una sola sesión SOAP por corrida, cerrada siempre.
//
// Contexto de la sesión (Q-143). La sesión SOAP vive en el PCC de las credenciales y no cambia de
// AAA sola: `queue.list` lleva el PCC en el request, pero `GetReservationRQ` lee en el AAA de la
// sesión, y un PNR de otro PCC da `700102` (Viewership is restricted). Con SABRE_SESSION_PCC (un PCC
// de 3 o 4 letras o dígitos; `target` toma SABRE_TARGET_PCC, como SABRE_QUEUE_PCC), el script cambia
// el PCC de la sesión justo después de abrirla y antes de cualquier lectura o escritura, en los cuatro
// pasos. SABRE_SESSION_CONTEXT elige cómo:
//   - `aaa` (default): `session.command('AAA<PCC>')`, SabreCommandLLSRQ.
//   - `context-change`: ContextChangeLLSRQ 2.0.3. Si la respuesta trae `SecurityToken Updated="true"`,
//     todos los requests siguientes, `close` incluido, usan ese token (el anterior queda inválido).
//     El token nunca se imprime ni se graba.
//   - `context-change-cpaid`: lo mismo y además el `CPAId` del encabezado pasa al PCC destino en los
//     requests siguientes.
// Las dos últimas reemplazan el token y el CPAId con un setter interno de la sesión (`sessionSecurity`,
// como `sessionSend`: un truco de los scripts, no API pública). Si la pantalla no confirma el cambio
// (`ApplicationResults` no `Complete`, o el primer `Text` no empieza con el PCC destino; con `aaa`,
// `<PCC>.<home>*<sine>.<duty>`), o la llamada falla, aborta sin leer ni escribir (código 4), cierra
// la sesión e imprime la pantalla. Sin SABRE_SESSION_PCC no se cambia nada. Producción, para un PNR de
// P8 desde las credenciales de BX3 (una variante por corrida):
//
//      SABRE_QUEUE_PCC=target SABRE_SESSION_PCC=target SABRE_SESSION_CONTEXT=context-change \
//        SABRE_ENVIRONMENT=production SABRE_UPDATE_STEP=scan \
//        node --env-file=.env.production scripts/validate-update-reservation.mjs
//
// En `scan`, si sigue dando 700102 después del cambio, la consola lo dice, e imprime completo el primer
// error de lectura que lanzó (nombre, código, mensaje y errores anidados). Los `Message` de Sabre
// (los de `GetReservationRS/Errors`, en la tabla y en `read`) pasan por el scrubber con los PCC en su
// alias: el destino es `P8` en producción (`destino` en CERT) y el de las credenciales, `home`. Con
// SABRE_UPDATE_REST_CHECK=1, ya con la sesión cerrada, hace un `booking.get` con `targetPcc` sobre el
// primer PNR que intentó leer y dice solo ok o el código (sin grabar nada). En `read`, la fixture trae
// findings.q143 = { context, aaaSent, aaaOk, screen (anonimizada), newToken (sí/no, sin el valor),
// cpaIdChanged, readAfterAaa }. Si el cambio aborta `read`, graba una fixture mínima
// (get-reservation.<entorno>-aaa-aborted) solo con ese q143, sin lecturas.
//
// 0. `scan`, SOLO LECTURA, para que las agentes elijan un PNR. Lista las colas SABRE_UPDATE_QUEUES
//    (5 y 6: ahí están los PNR con TK de cambio de horario, ver sabre-wiki/wiki/concepts/
//    cambio-de-horario.md), lee hasta SABRE_UPDATE_SCAN PNR (de 1 a 20) con `GetReservationRQ` 1.19
//    del tipo SABRE_SCAN_REQUEST_TYPE e imprime una tabla: colas, aerolíneas, segmentos viejos y
//    nuevos (id, estado, vuelo, ruta, salida), boleto, marriage, pasajeros, otros estados que
//    tocaría CONFIRM-ALL y cada `Errors/Error` con su código y su mensaje completos (también de las
//    lecturas que fallaron). No llama a booking.get y no graba fixture. SABRE_SCAN_REQUEST_TYPE:
//      - `trip` (default): `RequestType` `Trip` con `ViewName` `Full` y `ResponseFormat` `STL`. Lee
//        del almacén de PNR sin pasar por el AAA: solo lectura.
//      - `stateful`: el request del SDK; desempaca el PNR en el AAA, así que después de cada lectura
//        manda `IgnoreTransaction` (el del SDK) antes del PNR siguiente. Nunca un ET. Si el
//        `IgnoreTransaction` falla o la lectura da 700411/700412 (algo pendiente en el AAA), no lee
//        más PNR. Cerrar la sesión descarta el AAA de todos modos.
//    `stateless` es un error antes de abrir sesión (código 2): la guía de Retrieve Itinerary 1.19.22
//    dice «Stateless requests can be used by airlines only», y una agencia recibe 700102.
//
//      SABRE_QUEUE_PCC=target SABRE_SESSION_PCC=target SABRE_ENVIRONMENT=production SABRE_UPDATE_STEP=scan node --env-file=.env.production scripts/validate-update-reservation.mjs
//      … con SABRE_SCAN_REQUEST_TYPE=stateful, SABRE_SESSION_CONTEXT=context-change o
//      context-change-cpaid, y SABRE_UPDATE_REST_CHECK=1 al principio.
//
// A. `read` (default), SOLO LECTURA. Con SABRE_UPDATE_LOCATOR lee ese PNR; sin ella, revisa las
//    colas como `scan` (con SABRE_SCAN_REQUEST_TYPE) y elige el primero con un segmento en TK. Del elegido graba el
//    `GetReservationRQ` `Stateful` (el mismo request que manda el SDK antes de escribir, por el
//    método interno de la sesión: el SDK no tiene una lectura pública de STL), seguido siempre de
//    `IgnoreTransaction` (con o sin error, nunca un ET), y, ya con la sesión cerrada, su
//    `booking.get` (REST), para comparar los ids STL con `flights[].itemId` (Q-140).
//    Nunca llama a confirmAirSegments ni a removeAirSegments.
//
//      SABRE_QUEUE_PCC=target SABRE_SESSION_PCC=target SABRE_ENVIRONMENT=production SABRE_UPDATE_LOCATOR=ABC123 node --env-file=.env.production scripts/validate-update-reservation.mjs
//
// B. `confirm`, ESCRITURA: `confirmAirSegments` (CONFIRM-ALL) sobre SABRE_UPDATE_LOCATOR con
//    SABRE_UPDATE_EXPECTED_IDS. C. `remove`, ESCRITURA: `removeAirSegments` (`op="D"`) de
//    SABRE_UPDATE_SEGMENT_IDS, con el default del SDK (solo UN y HX; el script no deja ampliarlo).
//    Sin candado, los dos son una corrida en seco: imprimen lo que harían y el candado exacto, y no
//    llaman a Sabre ni leen credenciales. Solo escriben con el argumento `--write=<paso>:<localizador>:<ids>`
//    (p. ej. `--write=confirm:ABC123:8,10`, los ids en el orden de la variable), en producción y con
//    SABRE_UPDATE_RECEIVED_FROM, que no tiene default. El candado va en la línea de comandos y no en
//    el entorno, para que un `export` o una línea de .env.production no conviertan en escritura un
//    comando de lectura; SABRE_UPDATE_WRITE es un error. Un candado que no cuadra corta con código 2
//    sin escribir. Después de escribir, y con la sesión ya cerrada, relee con `booking.get`.
//
//      SABRE_QUEUE_PCC=target SABRE_SESSION_PCC=target SABRE_ENVIRONMENT=production \
//        SABRE_UPDATE_STEP=confirm SABRE_UPDATE_LOCATOR=ABC123 \
//        SABRE_UPDATE_EXPECTED_IDS=8,10 SABRE_UPDATE_RECEIVED_FROM=BX3 \
//        node --env-file=.env.production scripts/validate-update-reservation.mjs
//      … y con --write=confirm:ABC123:8,10 al final para escribir de verdad.
//
// Variables: las credenciales (scripts/lib/env-credentials.mjs, siempre v3), SABRE_ENVIRONMENT
// (`sandbox` por defecto), SABRE_QUEUE_PCC (el PCC de las colas y el `targetPcc` de `booking.get`;
// `target` toma SABRE_TARGET_PCC; sin ella, el de la sesión), SABRE_SESSION_PCC (el PCC de la sesión,
// arriba), SABRE_SESSION_CONTEXT (cómo se cambia: aaa, context-change o context-change-cpaid),
// SABRE_SCAN_REQUEST_TYPE (trip o stateful, solo scan y read; confirm y remove leen siempre Stateful,
// como el SDK), SABRE_UPDATE_REST_CHECK (1, solo scan), SABRE_UPDATE_RECEIVED_FROM
// (obligatoria para escribir, sin default: el «recibido de» que verá la agencia en el historial,
// p. ej. BX3; Q-141 y R3) y las de cada paso de arriba.
//
// Fixtures en test/fixtures (`scan` no graba): get-reservation.<entorno>-schedule-change.json (A) y
// update-reservation.<entorno>-confirm.json / -remove.json (B, C). Guardan los requests
// (`onRawRequest`) y las respuestas (`onRawResponse`) de la reserva y de `booking.get`, no los de
// colas. Anonimización por lista blanca (scripts/lib/update-reservation.mjs): localizadores (del
// PNR y de la aerolínea) a alias, PCC a XXXX, firmas a AAA, y nombres, teléfonos, correos,
// boletos, remarks y `ReceivedFrom` enmascarados; el texto que no es de un elemento hoja (contenido
// mixto, CDATA, comentarios), siempre enmascarado. Si queda un dato real (también una palabra de un
// nombre del PNR), no escribe nada (código 1). La consola sí muestra los localizadores reales: hacen
// falta para el paso siguiente.
import { writeFileSync } from 'node:fs';
import { Sabre, SabreReservationUpdateError, SabreUncertainOutcomeError } from '../dist/index.js';
import { createAnonymizer } from '../dist/testing.js';
import { fileTokenStore } from './file-token-store.mjs';
import { legacyClient, legacyEnvironment, sessionSecurityOf, sessionSendOf } from './lib/legacy-recorder.mjs';
import {
  OTHER_CONFIRMABLE,
  RECEIVED_FROM_EXAMPLE,
  REMOVABLE_STATUSES,
  aaaCommand,
  compareSegmentIds,
  createScrubber,
  describeError,
  firstReadError,
  formatReadError,
  errorMentions,
  formatStlErrors,
  isLocator,
  mask,
  pccAliasText,
  previewUpdate,
  readAfterAaa,
  readCandidates,
  readStateful,
  readStlReservation,
  reservationOfError,
  receivedFromShape,
  resolvePlan,
  scanRow,
  statusCounts,
} from './lib/update-reservation.mjs';
import { createSessionContext } from './lib/session-context.mjs';

const plan = resolvePlan(process.env, process.argv.slice(2));
if (plan.error !== undefined) {
  console.error(plan.error);
  process.exit(2);
}

if ((plan.step === 'confirm' || plan.step === 'remove') && !plan.write) {
  const method = plan.step === 'confirm' ? 'confirmAirSegments' : `removeAirSegments (allowedStatuses: ${REMOVABLE_STATUSES.join(', ')})`;
  const receivedFrom = plan.receivedFrom ?? RECEIVED_FROM_EXAMPLE;
  console.log(`EN SECO: no se llama a Sabre. Entorno ${plan.environment}, ${method} sobre ${plan.locator}`);
  console.log(`${plan.step === 'confirm' ? 'expectedSegmentIds' : 'segmentIds'}: ${plan.segmentIds.join(', ')} · receivedFrom: "${receivedFrom}" (${receivedFrom.length} caracteres)${plan.receivedFrom === undefined ? ' · EJEMPLO: falta SABRE_UPDATE_RECEIVED_FROM' : ''}\n`);
  if (plan.sessionPcc !== undefined) {
    const change =
      plan.sessionContext === 'aaa'
        ? `${aaaCommand(plan.sessionPcc)} (SabreCommandLLSRQ, PCC de ${plan.sessionPccLabel})`
        : `ContextChangeLLSRQ 2.0.3 hacia el PCC de ${plan.sessionPccLabel}${plan.sessionContext === 'context-change-cpaid' ? ', con el CPAId del encabezado en el PCC destino' : ''}`;
    console.log(`antes de leer o escribir se mandaría ${change} y, si la pantalla no lo confirma, se abortaría\n`);
  }
  console.log(previewUpdate(plan));
  const missing = [
    ...(plan.environment === 'production' ? [] : ['SABRE_ENVIRONMENT=production']),
    ...(plan.receivedFrom === undefined ? [`SABRE_UPDATE_RECEIVED_FROM=${RECEIVED_FROM_EXAMPLE} (o el que corresponda; no hay default)`] : []),
  ];
  console.log(`\nPara escribir de verdad, con el ok del usuario, el mismo comando con este argumento al final: --write=${plan.lock}`);
  if (missing.length > 0) console.log(`y además: ${missing.join(' y ')}`);
  process.exit(0);
}

const { environment, credentials, queuePcc, queuePccLabel, secrets } = legacyEnvironment();
const allSecrets = [...secrets, process.env.SABRE_TARGET_PCC, plan.sessionPcc];
const anonymizer = createAnonymizer({ secrets: allSecrets });
const scrub = createScrubber({ aliasOf: anonymizer.aliasOf, secrets: allSecrets });
/**
 * Los `Message` de `GetReservationRS/Errors` en la consola: cada PCC conocido pasa a su alias (el
 * destino, `P8` en producción y `destino` en CERT; el de las credenciales, `home`), y después el
 * scrubber (localizadores a su alias, los demás secretos a XXXX). La fixture no los trae reales.
 */
const destinationAlias = environment === 'production' ? 'P8' : 'destino';
const show = (() => {
  const aliasPccs = pccAliasText([
    [queuePcc, destinationAlias],
    [process.env.SABRE_TARGET_PCC, destinationAlias],
    [plan.sessionPcc, destinationAlias],
    [process.env.SABRE_PCC, 'home'],
  ]);
  return (text) => scrub.text(aliasPccs(text));
})();

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
/** Los tokens nuevos de ContextChangeLLSRQ: ni se imprimen ni pueden estar en la fixture. */
const tokens = new Set();

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
  return { session, send: sessionSendOf(session), security: sessionSecurityOf(session) };
}

/**
 * El AAA de la sesión (Q-143, scripts/lib/session-context.mjs): cada paso corre su cuerpo con
 * `runInContext`, que manda el AAA antes de leer o escribir, aborta si no se confirma y cierra la
 * sesión siempre. El home y la sine reales de la pantalla pasan al chequeo de fugas de la fixture.
 */
const { aaa, evidence, runInContext } = createSessionContext({
  plan,
  step,
  secrets: allSecrets,
  watch: (values) => scrub.addNames(values, 'AAA (PCC, home o sine)'),
  watchToken: (token) => tokens.add(token),
  fail: () => {
    process.exitCode = 4;
  },
  show,
});

/** Un request por el método interno de la sesión (un truco de los scripts, no API pública). */
const rawSend = ({ session, send }, request) => {
  if (send === undefined) throw new Error('no se encontró sessionSend en el prototipo de la sesión');
  return session[send](request);
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
  // El token nuevo, tal cual o escapado para JSON: si está, no se escribe (y no se dice cuál es).
  const tokenLeak = [...tokens].some((token) => text.includes(token) || text.includes(JSON.stringify(token).slice(1, -1)));
  if (tokenLeak) {
    console.error('⚠️ la fixture trae el token de sesión nuevo: no se escribe.');
    process.exit(1);
  }
  const general = anonymizer.leaks(text);
  const details = scrub.leakDetails(text);
  if (general.length > 0 || details.length > 0) {
    console.error(`⚠️ la fixture todavía trae datos reales: no se escribe.`);
    // La consola ya muestra datos reales; la fixture no se escribe. Así se ve qué palabra lo disparó.
    for (const { field, value } of details) console.error(`  campo ${field}: «${value}»`);
    if (general.length > 0) console.error(`  createAnonymizer: ${[...new Set(general)].join(', ')} (no dice el valor)`);
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

// ---------- Colas (0 y A) ----------

/**
 * Lista las colas y lee hasta `plan.scan` PNR con `GetReservationRQ` de `plan.scanRequestType`
 * (`readCandidates`): `Trip` por defecto (no pasa por el AAA) o `Stateful` (desempaca el PNR en el
 * AAA; después de cada lectura, `IgnoreTransaction`, y nunca un ET). No se graba
 * (`reservation.scan` no está en RECORDED). Solo se leen los localizadores con forma de PNR (N-1).
 * Devuelve cada lectura (también las que fallaron, con sus `Errors/Error`), `readable` (cuántas
 * trajeron reserva sin `Errors`; un `GetReservationRS` con `Errors` no lanza), `attempted` (los
 * localizadores que intentó leer) y `stopped` si el `Stateful` cortó antes.
 */
async function scanQueues(conn) {
  const pccRequest = queuePcc === undefined ? {} : { pcc: queuePcc };
  const queuesOf = new Map();
  let discarded = 0;
  for (const queue of plan.queues) {
    const listed = await step(`list cola ${queue}`, () => conn.session.queue.list({ queue, ...pccRequest }), (r) => ({ locators: r.locators.length }));
    for (const locator of listed.value?.locators ?? []) {
      if (!isLocator(locator)) {
        discarded += 1;
        continue;
      }
      if (!queuesOf.has(locator)) queuesOf.set(locator, new Set());
      queuesOf.get(locator).add(queue);
    }
  }
  if (discarded > 0) console.log(`se descartaron ${discarded} localizadores de la cola sin forma de PNR`);
  const candidates = [...queuesOf].slice(0, plan.scan).map(([locator, queues]) => ({ locator, queues: [...queues] }));
  const { reads, stopped } = await readCandidates({
    candidates,
    requestType: plan.scanRequestType,
    send: (request) => rawSend(conn, request),
    step,
    label: (locator) => scrub.alias(locator),
  });
  if (stopped !== undefined) console.error(`\n✘ ${stopped}`);
  return { listed: queuesOf.size, reads, readable: reads.filter((r) => r.ok && r.pnr.hasReservation && r.pnr.errors.length === 0).length, attempted: candidates.map((c) => c.locator), stopped };
}

// ---------- 0. Escaneo ----------

async function scanStep() {
  console.log(`entorno ${environment} · SOLO LECTURA, sin fixture · colas ${plan.queues.join(', ')}, hasta ${plan.scan} PNR · GetReservationRQ ${plan.scanRequestType}${plan.scanRequestType === 'Stateful' ? ' (IgnoreTransaction después de cada PNR, sin ET)' : ''} · PCC de las colas: ${queuePccLabel}`);
  const conn = await openSession();
  const { entered, value: found } = await runInContext(conn, () => scanQueues(conn));
  if (!entered) return;
  for (const r of results.filter((r) => !r.ok)) console.log(`✘ ${r.step}: ${r.error?.name ?? ''} ${show(r.error?.message ?? '')}`);
  // El primer error de lectura que lanzó, completo y con su código, con los PCC en su alias.
  const firstError = firstReadError(results);
  if (firstError !== undefined) console.log(`\nprimer error de lectura (${firstError.step}):\n${show(formatReadError(firstError, '  '))}`);
  // 700102 en los `Errors/Error` de la respuesta o en el error que lanzó (`code`, `message` o los
  // anidados, no por JSON.stringify: M-3).
  const viewership = found.reads.filter((r) => r.pnr.errors.some((e) => String(e.code) === '700102' || errorMentions(e, '700102'))).length;
  if (viewership > 0) {
    console.log(
      aaa.sent
        ? `\n⚠️ ${viewership} lecturas ${plan.scanRequestType} dieron 700102 (Viewership is restricted) INCLUSO DESPUÉS del cambio de contexto (${plan.sessionContext}) a ${plan.sessionPccLabel}: no basta (Q-143).`
        : `\n⚠️ ${viewership} lecturas ${plan.scanRequestType} dieron 700102 (Viewership is restricted): la sesión sigue en el PCC de las credenciales. Con SABRE_SESSION_PCC=target se cambia el contexto antes de leer (Q-143).`,
    );
  }
  console.log(`\n${found.listed} PNR en las colas, ${found.reads.length} lecturas ${plan.scanRequestType}, ${found.readable} con reserva y sin Errors (la consola muestra los localizadores reales; los errores, con alias):`);
  if (found.reads.length > 0) console.table(found.reads.map(({ locator, queues, pnr }) => scanRow(queues, locator, pnr, show)));
  console.log(`\npara leer uno y grabar su fixture: SABRE_ENVIRONMENT=${environment} SABRE_UPDATE_STEP=read SABRE_UPDATE_LOCATOR=<localizador>`);
  if (plan.restCheck) await restCheck(found.attempted[0]);
}

/**
 * SABRE_UPDATE_REST_CHECK=1: ya con la sesión cerrada, un `booking.get` con `targetPcc` sobre el primer
 * PNR que el scan intentó leer, aunque su lectura STL haya fallado. Solo dice ok o el código: no
 * graba y no pasa hooks.
 */
async function restCheck(locator) {
  if (locator === undefined) {
    console.log('\nREST (booking.get): no hay PNR en las colas para verificar');
    return;
  }
  const checked = await step('booking.get (verificación REST)', () => sabre.booking.get({ confirmationId: locator, ...targetPcc }), (r) => ({ flights: r.flights?.length ?? 0 }));
  if (checked.error === undefined) {
    console.log(`\nREST (booking.get, ${targetPcc.targetPcc === undefined ? 'sin targetPcc' : `targetPcc de ${queuePccLabel}`}) sobre el primer PNR: ok`);
  } else {
    const described = describeError(checked.error);
    console.log(`\nREST (booking.get, ${targetPcc.targetPcc === undefined ? 'sin targetPcc' : `targetPcc de ${queuePccLabel}`}) sobre el primer PNR: error ${described.code ?? described.name ?? 'sin código'}`);
  }
}

// ---------- A. Lectura ----------

async function readStep() {
  console.log(`entorno ${environment} · SOLO LECTURA · ${plan.locator === undefined ? `colas ${plan.queues.join(', ')}, hasta ${plan.scan} PNR` : `PNR ${plan.locator}`} · PCC de las colas: ${queuePccLabel}`);
  const candidates = [];
  let chosen = plan.locator;
  let readResult;
  const conn = await openSession();
  const { entered } = await runInContext(conn, async () => {
    if (chosen === undefined) {
      const { reads } = await scanQueues(conn);
      for (const { locator, queues, pnr } of reads) candidates.push({ locator, queue: queues.join(','), statuses: statusCounts(pnr.segments), errors: pnr.errors.map((e) => ({ code: e.code, message: show(e.message ?? '') })) });
      chosen = candidates.find((c) => (c.statuses.TK ?? 0) > 0)?.locator;
    } else {
      scrub.alias(chosen);
    }
    if (chosen === undefined) return;
    // Stateful y después IgnoreTransaction, con o sin error, como el scan: nunca un ET.
    const { read, ignored } = await readStateful({ locator: chosen, send: (request) => rawSend(conn, request), step, label: (locator) => scrub.alias(locator), hooks, name: 'GetReservationRQ Stateful' });
    readResult = read;
    if (ignored.error !== undefined) console.error(`\n⚠️ el IgnoreTransaction después de ${scrub.alias(chosen)} falló (${show(ignored.error?.message ?? ignored.error)}): el cierre de la sesión descarta el AAA.`);
  });
  if (!entered) {
    // M-2: sin AAA no hubo lecturas, pero la evidencia de Q-143 (la pantalla) se guarda, en su propia
    // fixture para no pisar la de una lectura buena.
    const q143 = evidence('sin lecturas: el cambio de contexto abortó el paso');
    console.log(`\nQ-143: ${JSON.stringify(q143)}`);
    writeFixture(`get-reservation.${environment}-aaa-aborted`, { step: 'read', locator: plan.locator }, { q143 });
    return;
  }

  if (candidates.length > 0) {
    console.log('\ncandidatos (la consola muestra el localizador real; la fixture, el alias):');
    console.table(candidates.map((c) => ({ localizador: c.locator, alias: scrub.alias(c.locator), cola: c.queue, estados: JSON.stringify(c.statuses), errores: formatStlErrors(c.errors, (t) => t) })));
  }
  const stateful = parsedResponses('reservation.get').at(-1);
  // Los `Errors/Error` del GetReservationRS Stateful, completos (de la respuesta o del error que lanzó).
  const statefulErrors = stateful?.errors ?? (readResult?.error === undefined ? [] : reservationOfError(readResult.error).errors);
  if (statefulErrors.length > 0) console.log(`\nerrores del GetReservationRQ Stateful: ${formatStlErrors(statefulErrors, show)}`);
  // Q-143: lo que dio la lectura después del AAA (`ok` o el código, p. ej. 700102).
  const q143 = aaa.sent ? evidence(readAfterAaa(stateful, readResult?.error)) : undefined;
  if (q143 !== undefined) console.log(`\nQ-143: ${JSON.stringify(q143)}`);
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
  const base = `SABRE_ENVIRONMENT=${environment} SABRE_UPDATE_LOCATOR=${chosen} SABRE_UPDATE_RECEIVED_FROM=${RECEIVED_FROM_EXAMPLE}`;
  if (tk.length > 0) console.log(`\npaso B, en seco (sin --write; el seco imprime el candado): ${base} SABRE_UPDATE_STEP=confirm SABRE_UPDATE_EXPECTED_IDS=${tk.join(',')}`);
  if (removable.length > 0) console.log(`paso C, en seco (sin --write): ${base} SABRE_UPDATE_STEP=remove SABRE_UPDATE_SEGMENT_IDS=<de ${removable.join(',')}>`);
  const airIdMissing = stateful.segments.filter((s) => s.airIdFromSegment).map((s) => s.segmentId);
  if (airIdMissing.length > 0) console.log(`⚠️ sin Air@id (se usa Segment@id, como el SDK): ${airIdMissing.join(', ')}`);

  const statuses = statusCounts(stateful.segments);
  writeFixture(
    `get-reservation.${environment}-schedule-change`,
    { step: 'read', queues: plan.locator === undefined ? plan.queues : undefined, scanned: candidates.length, locator: chosen },
    {
      candidates: candidates.map((c) => ({ locator: c.locator, queue: c.queue, statuses: c.statuses, errors: c.errors })),
      segments: stateful.segments.map(segmentRow),
      restFlights: flights.map(restFlightRow),
      stl: { payloadName: stateful.payloadName, errors: stateful.errors.map((e) => ({ ...e, message: e.message === undefined ? undefined : show(e.message) })), applicationResults: stateful.applicationResults ?? null },
      // Qué trae TicketingInfo (los nombres de sus hijos, p. ej. FutureTicketing): para saber cómo
      // viene un boleto emitido en STL 1.19 (duda de diseño 1). `null` si no viene TicketingInfo.
      ticketing: stateful.ticketing ?? null,
      // Q-139: qué estados conviven con el TK (KK/KL/TL los tocaría CONFIRM-ALL) y si
      // ScheduleChangeIndicator sirve de señal.
      q139: {
        statuses,
        otherConfirmable: OTHER_CONFIRMABLE.filter((s) => statuses[s] !== undefined),
        scheduleChangeIndicator: [...new Set(stateful.segments.filter((s) => s.status === 'TK').map((s) => s.scheduleChangeIndicator))],
        candidatesWithOtherConfirmable: candidates.filter((c) => OTHER_CONFIRMABLE.some((s) => c.statuses[s] !== undefined)).length,
      },
      // Q-140: Air@id, Segment@id y Product@id contra flights[].itemId, y si Get Booking lista los UN/HX.
      // `airIdMissing`: los Segment@id de los segmentos sin Air@id, cuyo id salió de Segment@id (M-4).
      q140: { ...comparison, airIdMissing, restListsRemovable: removable.length === 0 ? undefined : removable.every((id) => comparison.pairs.find((p) => p.airId === id)?.matched) },
      // Q-141: cómo guarda el PNR el ReceivedFrom (elementos y largos, sin el valor).
      q141: { receivedFromInPnr: receivedFromShape(stateful.raw) ?? null },
      // Q-143: si se mandó el AAA, qué pantalla dio (anonimizada) y qué dio la lectura después. Sin
      // SABRE_SESSION_PCC no hay q143.
      q143,
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
  const { entered } = await runInContext(conn, async () => {
    outcome = await step(method, () => conn.session.reservation[method](request, hooks), (r) => ({
      status: r.status,
      locator: r.locator,
      changed: r.changed,
      warnings: r.warnings,
      respondedAt: r.respondedAt,
      segments: r.segments,
    }));
  });
  if (!entered) return;

  if (outcome.error instanceof SabreUncertainOutcomeError) {
    console.error(`\n⚠️ INCIERTO (${outcome.error.reason}): Sabre pudo haber aplicado el cambio. No repitas la escritura: el booking.get de abajo, o el paso read con SABRE_UPDATE_LOCATOR=${plan.locator}, dice cómo quedó.`);
    process.exitCode = 3;
  } else if (outcome.error instanceof SabreReservationUpdateError) {
    console.error(`\nno se escribió (${outcome.error.reason}${outcome.error.code === outcome.error.reason ? '' : ` ${outcome.error.code}`}): ${show(outcome.error.message)}`);
  } else if (outcome.error !== undefined) {
    console.error(`\nfalló: ${outcome.error.name}: ${show(outcome.error.message ?? outcome.error)}`);
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
        airIdMissing: [...new Set([...(before?.segments ?? []), ...(after?.segments ?? [])].filter((s) => s.airIdFromSegment).map((s) => s.segmentId))],
        idsAfter: after === undefined ? null : compareSegmentIds(after.segments, flights),
      },
      // Q-141: si el EPR pudo escribir y cómo vuelve el ReceivedFrom (elementos y largos). Con un
      // resultado incierto, `wrote` es `null`: Sabre pudo haber aplicado el cambio (M-5).
      q141: {
        wrote: outcome.error instanceof SabreUncertainOutcomeError ? null : result !== undefined && result.status !== 'noop',
        errorCode: outcome.error?.code ?? null,
        receivedFromLength: plan.receivedFrom.length,
        receivedFromInResponse: after === undefined ? null : (receivedFromShape(after.raw) ?? null),
      },
    },
  );
}

if (plan.step === 'scan') await scanStep();
else if (plan.step === 'read') await readStep();
else await writeStep();
