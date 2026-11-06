#!/usr/bin/env node
// Pruebas previas del Tier 4 (#154, F0.1): Get Queue Activity (`QA`) e historial del PNR (`*H`),
// por `session.command()` y por los servicios XML que tiparán A1 y B1 (ADR-027). Graba las
// respuestas, anonimizadas, como fixtures para #161 y #164. Lo corre el usuario, con su
// confirmación en cada corrida; nunca la CI. Necesita `npm run build` antes.
//
//   node --env-file=.env scripts/validate-activity.mjs qa
//   SABRE_ENVIRONMENT=production node --env-file=.env.production scripts/validate-activity.mjs qa
//   SABRE_HISTORY_PNR=ABC123 node --env-file=.env scripts/validate-activity.mjs history
//   SABRE_HISTORY_PNR=ABC123 SABRE_HISTORY_PLACE_QUEUE=401 \
//     node --env-file=.env scripts/validate-activity.mjs history
//   SABRE_HISTORY_PNR=ABC123 SABRE_QUEUE=50 node --env-file=.env scripts/validate-activity.mjs history-in-queue
//   SABRE_QUEUE=401 node --env-file=.env scripts/validate-activity.mjs in-queue-own
//
// `qa` (sandbox o producción, solo lectura), en una sesión:
//  1. `QueueAnalysisLLSRQ` 2.0.0 crudo, sin `SI9` (Q-098: ¿hace falta duty code 9?).
//  2. `QA/<PCC>` por `session.command()`, sin `SI9`.
//  3. `SI9`: duty code 9 en la sesión. No cambia la configuración del PCC; el AAA se descarta al
//     cerrar (igual que en validate-command.mjs).
//  4. `QueueAnalysisLLSRQ` y `QA/<PCC>` otra vez, ya con duty 9.
//  Hallazgos: si cada intento funcionó, el formato de `QueueInfo@DateTime` (¿con año?) y los
//  contadores que llegaron.
//
// `history` (solo sandbox), en una sesión, sobre SABRE_HISTORY_PNR (un PNR de prueba de CERT):
//  0. Solo con SABRE_HISTORY_PLACE_QUEUE: coloca el PNR en esa cola (PIC SABRE_INSTRUCTION_CODE, 11
//     por defecto), para ver si el historial registra la colocación (Q-097). **Escribe en la
//     cola** y deja el PNR ahí.
//  1. `TravelItineraryHistoryLLSRQ` 2.4.0 crudo, con `UniqueID` (JX HST*<PNR>).
//  2. `*<PNR>` y `*H` por `session.command()`.
//  3. `TravelItineraryHistoryLLSRQ` sin `UniqueID` (JX HST), con el PNR ya en el AAA.
//  Hallazgos: el nombre del atributo del PCC en `Source` (`AAA_PseudoCityCode` o
//  `AAAPseudoCityCode`), el formato de `CreateDateTime`, los valores de `@Action` y si el historial
//  menciona la cola.
//
// `history-in-queue` (solo sandbox, Q-102), en una sesión: ¿`session.reservation.history` dentro
// de un recorrido cambia el PNR del AAA? Solo lectura (access, `*R`, `I` y `QXI`; el `I` suma a
// `Ignored`):
//  1. `access` a SABRE_QUEUE: el PNR P1 queda en el AAA. `list` antes, para saber el siguiente (P2).
//  2. `*R`: qué PNR muestra el AAA (por la línea de firma).
//  3. `session.reservation.history(SABRE_HISTORY_PNR)`, un PNR distinto de P1.
//  4. `*R` otra vez: ¿sigue P1?
//  5. `ignore`: ¿llega a P2 y `state` sigue en `inside`?
//  6. `exit`.
//
// `in-queue-own` (solo sandbox, #167): los dos supuestos del fake. Solo lectura (`count`,
// `activity`, `access`, historial y `QXI`; sin `I`, para no sumar a `Ignored`):
//  1. `count` y `activity` fuera de la cola SABRE_QUEUE.
//  2. `access`: el primer PNR (P1) queda en pantalla.
//  3. `count` y `activity` dentro de la cola: ¿`NumMessages` cuenta a P1, como no lo hace `count`?
//  4. `session.reservation.history(P1)`: ¿el historial del PNR en pantalla se acepta?
//  5. `exit`, y `activity` otra vez: ¿qué contador movió el `QXI`? (un dato para Q-097).
//
// Las pruebas crudas usan el método interno de la sesión (`sessionSend`), como validate-queue.mjs:
// es un truco de los scripts, no API pública (aprobado por el usuario el 2026-11-01).
//
// Variables: el juego único de credenciales de scripts/lib/env-credentials.mjs, SABRE_ENVIRONMENT,
// SABRE_QUEUE_PCC (el PCC del `QA`; por defecto, el de la sesión), y para `history`,
// SABRE_HISTORY_PNR, SABRE_HISTORY_PLACE_QUEUE y SABRE_INSTRUCTION_CODE.
//
// Anonimización: la de scripts/lib/legacy-recorder.mjs, más una propia para el historial, que
// enmascara (letras a `X`, dígitos a `9`) el texto y los valores de atributo salvo `@Action` y las
// fechas, y conserva solo las líneas de pantalla que nombran una cola. Si queda un dato real, no se
// escribe la fixture.
import { createRecorder, env, legacyClient, legacyEnvironment, queueRef, sessionSendOf } from './lib/legacy-recorder.mjs';

const scenario = process.argv[2];
const SCENARIOS = ['qa', 'history', 'history-in-queue', 'in-queue-own'];
if (!SCENARIOS.includes(scenario)) {
  console.error(`escenario desconocido: ${scenario ?? '(ninguno)'} (usa ${SCENARIOS.join(', ')})`);
  process.exit(2);
}
const { environment, credentials, queuePcc, secrets } = legacyEnvironment();
const historyScenario = scenario === 'history' || scenario === 'history-in-queue' || scenario === 'in-queue-own';
if (historyScenario && environment !== 'sandbox') {
  console.error(`${scenario} solo corre en sandbox: lee un PNR de prueba de CERT`);
  process.exit(2);
}
const pcc = queuePcc ?? env('SABRE_PCC');
const historyPnr = scenario === 'history' || scenario === 'history-in-queue' ? env('SABRE_HISTORY_PNR').toUpperCase() : undefined;
const walkQueue = scenario === 'history-in-queue' || scenario === 'in-queue-own' ? queueRef(env('SABRE_QUEUE')) : undefined;
if (historyPnr !== undefined && !/^[A-Z0-9]{6}$/.test(historyPnr)) {
  console.error('SABRE_HISTORY_PNR debe ser un localizador de 6 caracteres');
  process.exit(2);
}
const placeQueue = scenario === 'history' && process.env.SABRE_HISTORY_PLACE_QUEUE ? queueRef(process.env.SABRE_HISTORY_PLACE_QUEUE) : undefined;
const instructionCode = Number(process.env.SABRE_INSTRUCTION_CODE ?? 11);

const recorder = createRecorder([...secrets, pcc]);
const { aliasOf, step, stepSummary, results, options, logger } = recorder;
if (historyPnr !== undefined) aliasOf(historyPnr);
const legacy = legacyClient(environment, credentials, logger);

const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';
const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

console.log(`entorno ${environment} · escenario ${scenario}${placeQueue === undefined ? '' : ' · CON place (escribe en la cola)'}`);
const session = await legacy.openSession(options);
const send = sessionSendOf(session);
if (send === undefined) {
  console.error('no se encontró sessionSend en el prototipo de la sesión');
  await session.close();
  process.exit(1);
}
const raw = (operation, action, payload) =>
  session[send]({ service: operation, action, payload, idempotent: true, operation: `probe.${operation}`, ...options });

// Pantallas de `session.command()`, sin anonimizar: solo para calcular hallazgos.
const screens = new Map();
const commandStep = (name, command) =>
  step(
    name,
    async () => {
      const screen = await session.command(command, { idempotent: true, ...options });
      screens.set(name, screen.text);
      return screen;
    },
    (screen) => ({ lines: screen.text.split('\n').length, warnings: screen.warnings.length }),
  );

const findings = {};
try {
  if (scenario === 'qa') {
    const qaPayload = `<QueueAnalysisRQ Version="2.0.0" xmlns="${NAMESPACE}"><QueueInfo><QueueIdentifier PseudoCityCode="${escapeXml(pcc)}"/></QueueInfo></QueueAnalysisRQ>`;
    const qaXml = (name) =>
      step(name, () => raw('queueAnalysis', 'QueueAnalysisLLSRQ', qaPayload), (r) => ({ payload: r.payloadName }));
    await qaXml('QueueAnalysisLLSRQ sin SI9');
    await commandStep('QA sin SI9', `QA/${pcc}`);
    await commandStep('SI9', 'SI9');
    await qaXml('QueueAnalysisLLSRQ con SI9');
    await commandStep('QA con SI9', `QA/${pcc}`);

    const ok = (name) => results.find((r) => r.step === name)?.ok === true;
    findings.q098 = {
      xmlWithoutSi9: ok('QueueAnalysisLLSRQ sin SI9'),
      hostWithoutSi9: ok('QA sin SI9'),
      xmlWithSi9: ok('QueueAnalysisLLSRQ con SI9'),
      hostWithSi9: ok('QA con SI9'),
    };
    const xml = recorder.rawBodies().filter((r) => r.operation === 'probe.queueAnalysis').map((r) => r.body);
    const dateTimes = xml.flatMap((body) => [...body.matchAll(/<(?:\w+:)?QueueInfo\b[^>]*\bDateTime="([^"]*)"/g)].map((m) => m[1]));
    findings.queueInfoDateTime = dateTimes.map((value) => ({ value, hasYear: /^\d{4}-/.test(value) }));
    findings.counters = [...new Set(xml.flatMap((body) => [...body.matchAll(/<(?:\w+:)?(\w+) Count="/g)].map((m) => m[1])))].sort();
  } else if (scenario === 'in-queue-own') {
    const sameQueue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const counted = (r) => r?.queues.find((q) => sameQueue(q.queue, walkQueue))?.count ?? 0;
    const analyzed = (r) => r?.queues.find((q) => sameQueue(q.queue, walkQueue));
    const countersOf = (r) => {
      const { queue: _queue, ...counters } = analyzed(r) ?? {};
      return counters;
    };
    const activitySummary = (r) => ({ queue: countersOf(r) });

    const countBefore = await step('count fuera', () => session.queue.count({}, options), (r) => ({ count: counted(r) }));
    const activityBefore = await step('activity fuera', () => session.queue.activity({}, options), activitySummary);
    const first = await step('access', () => session.queue.access({ queue: walkQueue }, options), stepSummary);
    const p1 = first !== undefined && !first.done && first.kind === 'pnr' ? first.item.locator : undefined;
    let countInside;
    let activityInside;
    let history;
    if (p1 !== undefined) {
      countInside = await step('count dentro', () => session.queue.count({}, options), (r) => ({ count: counted(r) }));
      activityInside = await step('activity dentro', () => session.queue.activity({}, options), activitySummary);
      history = await step('reservation.history del PNR en pantalla', () => session.reservation.history(p1, options), (r) => ({ transactions: r.transactions.length }));
    }
    if (session.queue.state !== 'outside') await step('exit', () => session.queue.exit(options));
    const activityAfter = await step('activity después del exit', () => session.queue.activity({}, options), activitySummary);

    const before = countersOf(activityBefore);
    const after = countersOf(activityAfter);
    findings.inQueueOwn = {
      p1Found: p1 !== undefined,
      countOutside: counted(countBefore),
      countInside: countInside === undefined ? null : counted(countInside),
      numMessagesOutside: before.numMessages ?? null,
      numMessagesInside: analyzed(activityInside)?.numMessages ?? null,
      activityInsideExcludesScreenPnr:
        activityInside === undefined ? null : analyzed(activityInside)?.numMessages === (before.numMessages ?? 0) - 1,
      ownHistoryAccepted: p1 === undefined ? null : history !== undefined,
      ownHistoryError: results.find((r) => r.step === 'reservation.history del PNR en pantalla' && !r.ok)?.error?.message ?? null,
      countersChangedByAccessAndExit: Object.fromEntries(
        Object.keys(after)
          .filter((key) => after[key] !== before[key])
          .map((key) => [key, { before: before[key], after: after[key] }]),
      ),
    };
  } else if (scenario === 'history-in-queue') {
    // El localizador del PNR en el AAA, de la línea de firma de `*R` (`… HHMM/DDMMMYY ABC123 H`).
    const aaaLocator = (name) => /\d{4}\/\d{2}[A-Z]{3}\d{2}\s+([A-Z0-9]{6})\s+H\s*$/m.exec(screens.get(name) ?? '')?.[1];
    const listed = await step('list', () => session.queue.list({ queue: walkQueue }, options), (r) => ({ locators: r.locators.map(aliasOf) }));
    const first = await step('access', () => session.queue.access({ queue: walkQueue }, options), stepSummary);
    const p1 = first !== undefined && !first.done && first.kind === 'pnr' ? first.item.locator : undefined;
    await commandStep('*R antes', '*R');
    await step('reservation.history', () => session.reservation.history(historyPnr, options), (r) => ({ transactions: r.transactions.length }));
    await commandStep('*R después', '*R');
    const next = session.queue.state === 'inside' ? await step('ignore', () => session.queue.ignore(options), stepSummary) : undefined;
    if (session.queue.state !== 'outside') await step('exit', () => session.queue.exit(options));

    const p2 = next !== undefined && !next.done && next.kind === 'pnr' ? next.item.locator : undefined;
    const before = aaaLocator('*R antes');
    const after = aaaLocator('*R después');
    for (const locator of [p1, p2, before, after]) if (locator !== undefined) aliasOf(locator);
    findings.q102 = {
      historyPnrIsP1: p1 === historyPnr,
      aaaBefore: before === undefined ? 'sin firma' : before === p1 ? 'P1' : aliasOf(before),
      aaaAfter: after === undefined ? 'sin firma' : after === p1 ? 'P1' : after === historyPnr ? 'el PNR del historial' : aliasOf(after),
      aaaUnchanged: before !== undefined && before === after,
      ignoreReachedListedNext: p2 !== undefined && p2 === listed?.locators[1],
      stateAfterIgnore: next === undefined ? 'sin ignore' : next.done ? 'outside (fin de cola)' : 'inside',
    };
  } else {
    if (placeQueue !== undefined) {
      await step('place', () => session.queue.place({ to: [{ queue: placeQueue, instructionCode }], locators: [historyPnr] }, options), (r) => ({ placements: r.placements.length }));
    }
    const historyXml = (name, payload) =>
      step(name, () => raw('itineraryHistory', 'TravelItineraryHistoryLLSRQ', payload), (r) => ({ payload: r.payloadName }));
    await historyXml('TravelItineraryHistoryLLSRQ con UniqueID', `<TravelItineraryHistoryRQ Version="2.4.0" xmlns="${NAMESPACE}"><UniqueID ID="${historyPnr}"/></TravelItineraryHistoryRQ>`);
    await commandStep('*PNR', `*${historyPnr}`);
    await commandStep('*H', '*H');
    await historyXml('TravelItineraryHistoryLLSRQ sin UniqueID', `<TravelItineraryHistoryRQ Version="2.4.0" xmlns="${NAMESPACE}"/>`);

    const xml = recorder.rawBodies().filter((r) => r.operation === 'probe.itineraryHistory').map((r) => r.body);
    const screen = screens.get('*H') ?? '';
    findings.sourcePccAttributes = [...new Set(xml.flatMap((body) => [...body.matchAll(/\b(AAA_?PseudoCityCode)="/g)].map((m) => m[1])))];
    findings.createDateTime = [...new Set(xml.flatMap((body) => [...body.matchAll(/\bCreateDateTime="([^"]*)"/g)].map((m) => (/^\d{4}-/.test(m[1]) ? 'con año' : `sin año (${m[1].replace(/\d/g, '9')})`))))];
    findings.actions = [...new Set(xml.flatMap((body) => [...body.matchAll(/\bAction="([^"]*)"/g)].map((m) => m[1])))].sort();
    findings.queueMentions = {
      xml: xml.some((body) => /QUEUE|\bQP\b|\bQ\/\d/i.test(body)),
      host: /QUEUE|\bQP\b|\bQ\/\d/i.test(screen),
      hostLines: screen.split('\n').filter((line) => /QUEUE|\bQP\b|\bQ\/\d/i.test(line)).map((line) => line.replace(/\b[A-Z0-9]{6}\b/g, (m) => (m === historyPnr ? aliasOf(m) : m))),
    };
  }
} finally {
  await step('close', () => session.close(options));
}

// El historial trae el PNR entero en atributos y elementos que el recorder no cubre: se enmascara
// todo salvo `@Action`, las fechas, los nombres de elemento/atributo y las líneas que nombran una cola.
const HISTORY_KEEP_ATTRIBUTES = /^(Action|Version|status|xmlns(:\w+)?|timeStamp|TimeStamp|\w*Date\w*|\w*Time\w*)$/;
const maskValue = (text) => text.replace(/\p{L}/gu, 'X').replace(/\p{N}/gu, '9');
const keepLine = (line) => /QUEUE|\bQP\b|\bQ\/\d/i.test(line);
function anonymizeHistory(body) {
  if (!/TravelItineraryHistoryRS|SabreCommandLLSRS/.test(body)) return body;
  return body
    .replace(/(\s)([\w:]+)="([^"]*)"/g, (all, space, name, value) => (HISTORY_KEEP_ATTRIBUTES.test(name) ? all : `${space}${name}="${maskValue(value)}"`))
    .replace(/>([^<]+)</g, (all, text) => `>${text.split('\n').map((line) => (keepLine(line) ? line : maskValue(line))).join('\n')}<`);
}
if (historyScenario) recorder.transformBodies(anonymizeHistory);

// Con place, otra fixture: la de F0.1 (`activity.sandbox-history.json`) la usan los tests.
recorder.writeFixture(`activity.${environment}-${scenario}${placeQueue === undefined ? '' : '-place'}`, { environment, scenario, place: placeQueue !== undefined }, findings);
