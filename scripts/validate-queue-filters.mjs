#!/usr/bin/env node
// Prueba previa de la 0.6.0 (#213, F0.1, Q-104): ¿qué filtros acepta el host en `QC` y `QA`? Por
// `session.command()` y por `QueueCountLLSRQ` 2.2.1 / `QueueAnalysisLLSRQ` 2.0.0 a mano. Graba las
// respuestas, anonimizadas, como fixture para #212 y #203. Lo corre el usuario, con su
// confirmación en cada corrida; nunca la CI. Necesita `npm run build` antes.
//
//   SABRE_QUEUE=50 node --env-file=.env scripts/validate-queue-filters.mjs
//   SABRE_ENVIRONMENT=production SABRE_QUEUE=1 SABRE_QUEUE_RANGE=1-50 SABRE_SELECTION_DATE=05NOV \
//     node --env-file=.env.production scripts/validate-queue-filters.mjs
//
// Solo lectura: count (`QC`), list (`Q/…` con `List@Ind`) y activity (`QA`). Nunca entra a una
// cola (sin `access`), ni manda `QR`, place o `I`: no mueve ningún PNR ni suma a los contadores.
//
// Recorrido, en una sesión:
//  1. `session.queue.count()`: la cuenta sin filtro, para comparar.
//  2. `QueueCountLLSRQ` crudo: con `Number` (SABRE_QUEUE), con `Range` (SABRE_QUEUE_RANGE), y con
//     `Selection` sobre SABRE_QUEUE: `QD`, `AK`, `AL`, `PI`, `AC`, y dos juntos (`QD` + `PI`).
//     También `QD` sin `Number` (todo el PCC).
//  3. Los mismos por `session.command()`: `QC/<PCC><cola>`, `QC/<PCC><a>-<b>`, `QC/<PCC><cola>¥QD-…`…
//  4. `QueueAnalysisLLSRQ` crudo con `Number` y con `Range`, y `QA/<PCC><cola>`, `QA/<PCC><a>-<b>`.
//  5. `list` crudo de SABRE_QUEUE con `Selection QD-<fecha>`: cuántas `Line`, para compararlo con
//     el `QC` con el mismo `QD`.
//
// Hallazgos: qué funciones acepta `count` y con qué error rechaza las demás (Q-104), si `count` con
// `QD` da lo mismo que `list` con `QD`, si el `Range` trae colas vacías, y si apareció
// `AdditionalQueueInfo` (y si es hijo o hermano de `QueueIdentifier`).
//
// Variables: las de scripts/validate-queue.mjs (credenciales, SABRE_QUEUE_PCC), más SABRE_QUEUE
// (número de la cola; obligatoria), SABRE_QUEUE_RANGE (`<a>-<b>`; por defecto, de la cola a la
// cola + 10), SABRE_SELECTION_DATE (`DDMMM`; por defecto, la fecha de la última `Line` del `list`, o hoy en UTC), SABRE_SELECTION_PIC (11),
// SABRE_SELECTION_AIRLINE (AM), SABRE_SELECTION_ACTION (HK) y SABRE_SELECTION_AGENT (`AK`: PCC y
// firma del agente que colocó, p. ej. `PCC1AAT`; sin ella, se toma de la primera `Line` del `list`
// sin filtro, que se manda primero).
//
// Las pruebas crudas usan el método interno de la sesión (`sessionSend`), como validate-queue.mjs:
// es un truco de los scripts, no API pública (aprobado por el usuario el 2026-11-01). La
// anonimización y la protección contra fugas están en scripts/lib/legacy-recorder.mjs; el agente de
// `AK` entra como secreto.
import { createRecorder, env, legacyClient, legacyEnvironment, rejectMessageQueue, sessionSendOf } from './lib/legacy-recorder.mjs';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const now = new Date();
const today = `${String(now.getUTCDate()).padStart(2, '0')}${MONTHS[now.getUTCMonth()]}`;
const fail = (message) => {
  console.error(message);
  process.exit(2);
};

const { environment, credentials, queuePcc, queuePccLabel, secrets } = legacyEnvironment();
const queueText = env('SABRE_QUEUE');
rejectMessageQueue(queueText, 'SABRE_QUEUE');
if (!/^\d{1,3}$/.test(queueText)) fail('SABRE_QUEUE debe ser el número de una cola (0–999)');
const queue = Number(queueText);
const rangeText = process.env.SABRE_QUEUE_RANGE || `${queue}-${Math.min(queue + 10, 999)}`;
const rangeMatch = /^(\d{1,3})-(\d{1,3})$/.exec(rangeText);
if (rangeMatch === null || Number(rangeMatch[1]) >= Number(rangeMatch[2])) fail('SABRE_QUEUE_RANGE debe tener la forma <a>-<b>, con a < b (p. ej. 1-50)');
const range = { start: Number(rangeMatch[1]), end: Number(rangeMatch[2]) };
let date = (process.env.SABRE_SELECTION_DATE || today).toUpperCase();
const dateFromEnv = Boolean(process.env.SABRE_SELECTION_DATE);
if (!/^\d{2}[A-Z]{3}$/.test(date)) fail('SABRE_SELECTION_DATE debe tener la forma DDMMM (p. ej. 05NOV)');
const pic = process.env.SABRE_SELECTION_PIC || '11';
const airline = (process.env.SABRE_SELECTION_AIRLINE || 'AM').toUpperCase();
const action = (process.env.SABRE_SELECTION_ACTION || 'HK').toUpperCase();
let agent = process.env.SABRE_SELECTION_AGENT?.toUpperCase();
const pcc = queuePcc ?? env('SABRE_PCC');
const pccRequest = queuePcc === undefined ? {} : { pcc: queuePcc };

const { step, results, options, logger, writeFixture, rawBodies, transformBodies } = createRecorder([...secrets, pcc, agent]);
const legacy = legacyClient(environment, credentials, logger);

const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';
const escapeXml = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Los filtros que se prueban. `AK` solo si hay agente (se arma después del primer `list`).
let FILTERS = [];
const buildFilters = () => [
  ['QD', [{ function: 'QD', criteria: date }]],
  ...(agent === undefined ? [] : [['AK', [{ function: 'AK', criteria: agent }]]]),
  ['AL', [{ function: 'AL', criteria: airline }]],
  ['PI', [{ function: 'PI', criteria: pic }]],
  ['AC', [{ function: 'AC', criteria: action }]],
  ['QD+PI', [{ function: 'QD', criteria: date }, { function: 'PI', criteria: pic }]],
  ...(agent === undefined ? [] : [['QD+AK', [{ function: 'QD', criteria: date }, { function: 'AK', criteria: agent }]]]),
];

console.log(`entorno ${environment} · cola ${queue} · rango ${range.start}-${range.end} · QD-${date} · PI-${pic} · AL-${airline} · AC-${action} · PCC: ${queuePccLabel}`);
const session = await legacy.openSession(options);
const send = sessionSendOf(session);
if (send === undefined) {
  console.error('no se encontró sessionSend en el prototipo de la sesión');
  await session.close();
  process.exit(1);
}
const raw = (service, actionName, name, payload) =>
  session[send]({ service, action: actionName, payload, idempotent: true, operation: `probe.${name}`, ...options });

// `form`: `{}` (todo el PCC), `{ number }` o `{ range }`.
const identifierXml = (form) => {
  const pccAttribute = `PseudoCityCode="${escapeXml(pcc)}"`;
  if (form.range !== undefined) return `<QueueIdentifier ${pccAttribute}><Range Start="${form.range.start}" End="${form.range.end}"/></QueueIdentifier>`;
  if (form.number !== undefined) return `<QueueIdentifier Number="${form.number}" ${pccAttribute}/>`;
  return `<QueueIdentifier ${pccAttribute}/>`;
};
const selectionXml = (selection = []) => selection.map((s) => `<Selection Function="${escapeXml(s.function)}" Criteria="${escapeXml(s.criteria)}"/>`).join('');
const countPayload = (form, selection) =>
  `<QueueCountRQ Version="2.2.1" xmlns="${NAMESPACE}"><QueueInfo>${identifierXml(form)}</QueueInfo>${selectionXml(selection)}</QueueCountRQ>`;
const analysisPayload = (form) => `<QueueAnalysisRQ Version="2.0.0" xmlns="${NAMESPACE}"><QueueInfo>${identifierXml(form)}</QueueInfo></QueueAnalysisRQ>`;
const listPayload = (selection) =>
  `<QueueAccessRQ Version="2.1.1" xmlns="${NAMESPACE}"><QueueIdentifier Number="${queue}" PseudoCityCode="${escapeXml(pcc)}"><List Ind="true"/></QueueIdentifier>${selectionXml(selection)}</QueueAccessRQ>`;

// Lo que se resume de cada respuesta cruda, sin datos: el payload, las colas con su cuenta y los avisos.
const queuesOf = (payload) => {
  const info = payload?.QueueInfo;
  const ids = info?.QueueIdentifier;
  return (ids === undefined ? [] : Array.isArray(ids) ? ids : [ids]).map((q) => ({ number: q['@Number'], name: q['@Name'], count: q['@Count'] ?? q.NumMessages?.['@Count'] }));
};
const xmlSummary = (r) => ({ payload: r.payloadName, queues: queuesOf(r.payload), warnings: r.warnings.map((w) => w.message ?? w.text ?? JSON.stringify(w)) });
const describeFailure = (name) => results.find((r) => r.step === name)?.error;

// Pantallas de `session.command()`. Las primeras líneas van a los hallazgos; la anonimización
// general les quita el PCC y el agente.
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
const hostFilter = (selection) => selection.map((s) => `¥${s.function}-${s.criteria}`).join('');
// Otra forma de combinar en el host: un solo `¥` y los demás calificadores tras `/` (`¥AL-BA/FL-159`).
const hostFilterSlash = (selection) => `¥${selection.map((s) => `${s.function}-${s.criteria}`).join('/')}`;

const counts = {};
let agentFromList = false;
try {
  // 0. list sin filtro: la base de la comparación, y el agente de `AK` si no vino.
  counts.listAll = await step('list xml sin filtro', () => raw('queueAccess', 'QueueAccessLLSRQ', 'list', listPayload([])), (r) => ({ payload: r.payloadName, lines: lineCount(r), warnings: r.warnings.length }));
  if (agent === undefined && counts.listAll !== undefined) {
    const line = [counts.listAll.payload?.Line ?? []].flat()[0];
    const source = line?.POS?.Source;
    if (source?.['@PseudoCityCode'] && source?.['@AgentSine']) {
      agent = `${source['@PseudoCityCode']}${source['@AgentSine']}`.toUpperCase();
      agentFromList = true;
      const placed = agent;
      transformBodies((body) => body.replaceAll(placed, 'XXXX'));
    }
  }
  // Sin SABRE_SELECTION_DATE, la fecha de la última `Line` (la colocación más reciente).
  const lastPlaced = [counts.listAll?.payload?.Line ?? []].flat().at(-1)?.DateTime;
  const placedMatch = typeof lastPlaced === 'string' ? /^\d{4}-(\d{2})-(\d{2})T/.exec(lastPlaced) : null;
  if (!dateFromEnv && placedMatch !== null) date = `${placedMatch[2]}${MONTHS[Number(placedMatch[1]) - 1]}`;
  console.log(`QD-${date} (${dateFromEnv ? 'de SABRE_SELECTION_DATE' : placedMatch !== null ? 'la última colocación del list' : 'hoy'})`);
  FILTERS = buildFilters();
  console.log(`AK: ${agent === undefined ? 'no se prueba' : agentFromList ? 'tomado del list' : 'de SABRE_SELECTION_AGENT'}`);

  await step('count (SDK)', () => session.queue.count(pccRequest, options), (r) => ({ queues: r.queues.length, totals: r.totals }));

  // 2. QueueCountLLSRQ crudo.
  counts.number = await step(`QC xml Number=${queue}`, () => raw('queueCount', 'QueueCountLLSRQ', 'qcNumber', countPayload({ number: queue })), xmlSummary);
  counts.range = await step(`QC xml Range ${range.start}-${range.end}`, () => raw('queueCount', 'QueueCountLLSRQ', 'qcRange', countPayload({ range })), xmlSummary);
  counts.numberAndRange = await step('QC xml Number y Range juntos', () => raw('queueCount', 'QueueCountLLSRQ', 'qcNumberRange', countPayload({ number: queue }).replace('/>', `><Range Start="${range.start}" End="${range.end}"/></QueueIdentifier>`)), xmlSummary);
  counts.selection = {};
  for (const [name, selection] of FILTERS) {
    counts.selection[name] = await step(`QC xml ${name}`, () => raw('queueCount', 'QueueCountLLSRQ', `qc${name}`, countPayload({ number: queue }, selection)), xmlSummary);
  }
  counts.qdAllPcc = await step('QC xml QD sin Number', () => raw('queueCount', 'QueueCountLLSRQ', 'qcQDAll', countPayload({}, FILTERS[0][1])), xmlSummary);

  // 3. Los mismos por el host.
  await commandStep(`QC host ${queue}`, `QC/${pcc}${queue}`);
  await commandStep(`QC host ${range.start}-${range.end}`, `QC/${pcc}${range.start}-${range.end}`);
  for (const [name, selection] of FILTERS) {
    await commandStep(`QC host ${name}`, `QC/${pcc}${queue}${hostFilter(selection)}`);
    if (selection.length > 1) await commandStep(`QC host ${name} con /`, `QC/${pcc}${queue}${hostFilterSlash(selection)}`);
  }
  await commandStep('QC host QD sin cola', `QC/${pcc}${hostFilter(FILTERS[0][1])}`);

  // 4. QueueAnalysisLLSRQ y QA.
  counts.qaNumber = await step(`QA xml Number=${queue}`, () => raw('queueAnalysis', 'QueueAnalysisLLSRQ', 'qaNumber', analysisPayload({ number: queue })), xmlSummary);
  counts.qaRange = await step(`QA xml Range ${range.start}-${range.end}`, () => raw('queueAnalysis', 'QueueAnalysisLLSRQ', 'qaRange', analysisPayload({ range })), xmlSummary);
  await commandStep(`QA host ${queue}`, `QA/${pcc}${queue}`);
  await commandStep(`QA host ${range.start}-${range.end}`, `QA/${pcc}${range.start}-${range.end}`);

  // 5. list con el mismo QD.
  counts.listQd = await step(`list xml QD-${date}`, () => raw('queueAccess', 'QueueAccessLLSRQ', 'listQD', listPayload(FILTERS[0][1])), (r) => ({ payload: r.payloadName, lines: lineCount(r), warnings: r.warnings.length }));
} finally {
  await step('close', () => session.close(options));
}

function lineCount(response) {
  const line = response.payload?.Line;
  return line === undefined ? 0 : Array.isArray(line) ? line.length : 1;
}

const countOfQueue = (r) => {
  const found = r === undefined ? undefined : queuesOf(r.payload).find((q) => q.number === String(queue));
  return found === undefined ? (r === undefined ? undefined : 0) : Number(String(found.count).replace(/\D/g, ''));
};
const accepted = (r, name) => (r === undefined ? { ok: false, error: describeFailure(name) } : { ok: true, count: countOfQueue(r), warnings: xmlSummary(r).warnings });

const bodies = rawBodies();
const countBodies = bodies.filter((b) => b.operation.startsWith('probe.qc'));
const additional = countBodies.flatMap(({ operation, body }) => {
  const matches = [...body.matchAll(/<(?:\w+:)?AdditionalQueueInfo\b[^>]*>/g)];
  return matches.map((m) => {
    // Hijo si el último `QueueIdentifier` antes de él quedó abierto (no autocerrado y sin cerrar).
    const before = body.slice(0, m.index);
    const lastOpen = before.lastIndexOf('<QueueIdentifier');
    const segment = lastOpen === -1 ? '' : before.slice(lastOpen);
    const child = lastOpen !== -1 && !/^<QueueIdentifier\b[^>]*\/>/.test(segment) && !segment.includes('</QueueIdentifier>');
    return { operation, element: m[0], position: child ? 'hijo de QueueIdentifier' : 'hermano' };
  });
});
const rangeQueues = counts.range === undefined ? undefined : queuesOf(counts.range.payload);
const firstLines = (name) => screens.get(name)?.split('\n').slice(0, 6);

const findings = {
  q104: {
    count: Object.fromEntries(FILTERS.map(([name]) => [name, accepted(counts.selection[name], `QC xml ${name}`)])),
    countWithoutFilter: countOfQueue(counts.number),
    qdAllPcc: counts.qdAllPcc === undefined ? { ok: false, error: describeFailure('QC xml QD sin Number') } : { ok: true, queues: queuesOf(counts.qdAllPcc.payload) },
    host: Object.fromEntries(FILTERS.flatMap(([name, selection]) => [[name, firstLines(`QC host ${name}`)], ...(selection.length > 1 ? [[`${name} con /`, firstLines(`QC host ${name} con /`)]] : [])])),
  },
  qdVersusList: {
    countQd: countOfQueue(counts.selection.QD),
    listQdLines: counts.listQd === undefined ? 'error' : lineCount(counts.listQd),
    listAllLines: counts.listAll === undefined ? 'error' : lineCount(counts.listAll),
    same: counts.selection.QD !== undefined && counts.listQd !== undefined ? countOfQueue(counts.selection.QD) === lineCount(counts.listQd) : undefined,
  },
  count: {
    number: accepted(counts.number, `QC xml Number=${queue}`),
    range: counts.range === undefined ? { ok: false, error: describeFailure(`QC xml Range ${range.start}-${range.end}`) } : { ok: true, queues: rangeQueues, includesEmpty: rangeQueues.some((q) => /^[.\s]*0$/.test(String(q.count))) },
    numberAndRange: counts.numberAndRange === undefined ? { ok: false, error: describeFailure('QC xml Number y Range juntos') } : { ok: true, queues: queuesOf(counts.numberAndRange.payload) },
    host: { number: firstLines(`QC host ${queue}`), range: firstLines(`QC host ${range.start}-${range.end}`) },
  },
  activity: {
    number: counts.qaNumber === undefined ? { ok: false, error: describeFailure(`QA xml Number=${queue}`) } : { ok: true, queues: queuesOf(counts.qaNumber.payload) },
    range: counts.qaRange === undefined ? { ok: false, error: describeFailure(`QA xml Range ${range.start}-${range.end}`) } : { ok: true, queues: queuesOf(counts.qaRange.payload) },
    host: { number: firstLines(`QA host ${queue}`), range: firstLines(`QA host ${range.start}-${range.end}`) },
  },
  additionalQueueInfo: additional.length === 0 ? 'no apareció' : additional,
};

// El agente tomado del `list` no está entre los secretos del recorder: se quita a mano de los hallazgos.
const scrub = (value) => (agent === undefined ? value : JSON.parse(JSON.stringify(value).replaceAll(agent, 'XXXX')));
writeFixture(`queue.${environment}-filters`, { environment, queue, range, date, pic, airline, action, agent: agent === undefined ? undefined : 'XXXX' }, scrub(findings));
