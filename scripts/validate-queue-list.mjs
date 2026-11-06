#!/usr/bin/env node
// Pruebas previas del Tier 4 (#155, F0.2, Q-095): ¿`list` pagina o tiene un tope con una cola
// grande?, ¿acepta filtros de selección (`QD`, `PI`)?, ¿`access` con `QD` devuelve solo lo
// colocado ese día? Graba las respuestas, anonimizadas, como fixture para #162. Lo corre el
// usuario, con su confirmación en cada corrida; nunca la CI. Necesita `npm run build` antes.
//
//   SABRE_ENVIRONMENT=production SABRE_QUEUE=1 node --env-file=.env.production scripts/validate-queue-list.mjs
//   SABRE_ENVIRONMENT=production SABRE_QUEUE=1 SABRE_SELECTION_DATE=05NOV SABRE_SELECTION_PIC=11 \
//     node --env-file=.env.production scripts/validate-queue-list.mjs
//
// Solo lectura: count, list, access, ignore (`I`) y exit (`QXI`). Nunca manda `QR` (remove) ni
// place, así que ningún PNR sale de su cola ni se mueve a otra.
//
// Recorrido, en una sesión:
//  1. count: cuántos PNR tiene SABRE_QUEUE.
//  2. list(SABRE_QUEUE): ¿trae todos?, ¿cómo termina el párrafo?
//  3. `list` crudo con `Selection QD-<fecha>` y con `Selection PI-<pic>` (el SDK no deja pasar
//     `selection` a `list`).
//  4. access con `selection: [{ function: 'QD', criteria: <fecha> }]`, ignore hasta el fin o
//     SABRE_QUEUE_LIMIT PNR (10 por defecto), y exit. Se anota la fecha de cada PNR visitado.
//
// Variables: las de scripts/validate-queue.mjs (credenciales, SABRE_QUEUE_PCC), más SABRE_QUEUE
// (número o nombre de la cola grande), SABRE_SELECTION_DATE (`DDMMM`; por defecto, hoy en UTC),
// SABRE_SELECTION_PIC (11 por defecto) y SABRE_QUEUE_LIMIT.
//
// Las pruebas crudas usan el método interno de la sesión (`sessionSend`), como validate-queue.mjs:
// es un truco de los scripts, no API pública (aprobado por el usuario el 2026-11-01). La
// anonimización y la protección contra fugas están en scripts/lib/legacy-recorder.mjs.
import { createRecorder, env, legacyClient, legacyEnvironment, queueRef, sessionSendOf } from './lib/legacy-recorder.mjs';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const now = new Date();
const today = `${String(now.getUTCDate()).padStart(2, '0')}${MONTHS[now.getUTCMonth()]}`;

const { environment, credentials, queuePcc, queuePccLabel, secrets } = legacyEnvironment();
const queueText = env('SABRE_QUEUE');
const queue = queueRef(queueText);
const date = (process.env.SABRE_SELECTION_DATE || today).toUpperCase();
if (!/^\d{2}[A-Z]{3}$/.test(date)) {
  console.error('SABRE_SELECTION_DATE debe tener la forma DDMMM (p. ej. 05NOV)');
  process.exit(2);
}
const pic = process.env.SABRE_SELECTION_PIC || '11';
const limit = Number(process.env.SABRE_QUEUE_LIMIT ?? 10);
if (!Number.isInteger(limit) || limit < 1) {
  console.error('SABRE_QUEUE_LIMIT debe ser un entero ≥ 1');
  process.exit(2);
}
const pcc = queuePcc ?? env('SABRE_PCC');
const pccRequest = queuePcc === undefined ? {} : { pcc: queuePcc };

const { aliasOf, step, stepSummary, results, options, logger, writeFixture } = createRecorder([...secrets, pcc]);
const legacy = legacyClient(environment, credentials, logger);

console.log(`entorno ${environment} · cola ${queueText} · QD-${date} · PI-${pic} · PCC de las colas: ${queuePccLabel}`);
const session = await legacy.openSession(options);
const send = sessionSendOf(session);
if (send === undefined) {
  console.error('no se encontró sessionSend en el prototipo de la sesión');
  await session.close();
  process.exit(1);
}

const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';
// Número y cola alfabética ('S') van en Number; las con nombre, en Name (ADR-028).
const queueAttribute = typeof queue === 'object' ? `Name="${queue.name}"` : `Number="${queue}"`;
const rawList = (name, fn, criteria) =>
  session[send]({
    service: 'queueAccess',
    action: 'QueueAccessLLSRQ',
    payload: `<QueueAccessRQ Version="2.1.1" xmlns="${NAMESPACE}"><QueueIdentifier ${queueAttribute} PseudoCityCode="${pcc}"><List Ind="true"/></QueueIdentifier><Selection Function="${fn}" Criteria="${criteria}"/></QueueAccessRQ>`,
    idempotent: true,
    operation: `probe.${name}`,
    ...options,
  });
const lineCount = (response) => {
  const line = response.payload?.Line;
  return line === undefined ? 0 : Array.isArray(line) ? line.length : 1;
};

const sameQueue = (ref) => (typeof ref !== 'object' ? ref === queue : typeof queue === 'object' && ref.name === queue.name);
const count = await step('count', () => session.queue.count(pccRequest, options), (r) => ({
  queue: { queue: queueText, count: r.queues.find((q) => sameQueue(q.queue))?.count ?? 0 },
}));
const listed = await step('list', () => session.queue.list({ queue, ...pccRequest }, options), (r) => ({
  locators: r.locators.length,
  lastLines: r.paragraph.slice(-3),
}));
listed?.locators.forEach(aliasOf);
const listQd = await step(`list con QD-${date}`, () => rawList('listQD', 'QD', date), (r) => ({ payload: r.payloadName, lines: lineCount(r), warnings: r.warnings.length }));
const listPi = await step(`list con PI-${pic}`, () => rawList('listPI', 'PI', pic), (r) => ({ payload: r.payloadName, lines: lineCount(r), warnings: r.warnings.length }));

const visited = [];
try {
  let current = await step(`access con QD-${date}`, () => session.queue.access({ queue, ...pccRequest, selection: [{ function: 'QD', criteria: date }] }, options), stepSummary);
  if (current !== undefined && !current.done) visited.push(current.item);
  while (current !== undefined && !current.done && visited.length < limit) {
    current = await step('ignore', () => session.queue.ignore(options), stepSummary);
    if (current !== undefined && !current.done) visited.push(current.item);
  }
  if (session.queue.state !== 'outside') await step('exit', () => session.queue.exit(options));
} finally {
  await step('close', () => session.close(options));
}

const queueCount = count?.queues.find((q) => sameQueue(q.queue))?.count;
const listedCount = listed?.locators.length;
// `QD-05NOV` en la fecha de `access` (`2026-11-05T…` o `11-05T…`).
const month = String(MONTHS.indexOf(date.slice(2)) + 1).padStart(2, '0');
const placedOnDate = (placedAt) => typeof placedAt === 'string' && placedAt.includes(`${month}-${date.slice(0, 2)}T`);
const findings = {
  queueCount,
  listedCount,
  listReturnsAll: queueCount !== undefined && listedCount !== undefined ? listedCount === queueCount : undefined,
  listParagraphTail: listed?.paragraph.slice(-3),
  listAcceptsSelection: {
    QD: listQd === undefined ? 'error' : { lines: lineCount(listQd), sameAsUnfiltered: lineCount(listQd) === listedCount },
    PI: listPi === undefined ? 'error' : { lines: lineCount(listPi), sameAsUnfiltered: lineCount(listPi) === listedCount },
  },
  accessWithQd: {
    visited: visited.length,
    placedAt: visited.map((item) => item.placedAt),
    allPlacedOnDate: visited.length > 0 ? visited.every((item) => placedOnDate(item.placedAt)) : undefined,
    reachedEnd: results.some((r) => r.done === true),
  },
};

writeFixture(`queue.${environment}-list-large`, { environment, queue: typeof queue === 'object' ? { name: 'XXXX' } : queue, date, pic, limit }, findings);
