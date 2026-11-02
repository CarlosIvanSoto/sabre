#!/usr/bin/env node
// Recorrido de colas de solo lectura contra Sabre (#96): graba las respuestas reales, anonimizadas,
// como fixtures. Lo corre el usuario, con su confirmación en cada corrida; nunca la CI. Necesita
// `npm run build` antes.
//
//   SABRE_ENVIRONMENT=production SABRE_QUEUE=2 node --env-file=.env.production scripts/validate-queue.mjs walk
//   SABRE_ENVIRONMENT=production SABRE_EMPTY_QUEUE=3 node --env-file=.env.production scripts/validate-queue.mjs empty
//
// Solo lectura: count, list, access, ignore (`I`) y exit (`QXI`). Nunca manda `QR` (remove) ni
// place, así que ningún PNR sale de su cola ni se mueve a otra.
//
// - `walk` (una sesión): count → list(SABRE_QUEUE) → `I` y `QXI` crudos (¿list deja la sesión
//   dentro de la cola?, y el texto de `QXI` fuera de una cola) → access → count dentro de la cola →
//   ignore hasta el fin de cola o SABRE_QUEUE_LIMIT PNR (10 por defecto) → exit si hace falta.
// - `empty` (una sesión): count → list(SABRE_EMPTY_QUEUE) → access → exit si hace falta.
//
// Las pruebas crudas usan el método interno de la sesión (`sessionSend`), sacado del prototipo con
// Object.getOwnPropertySymbols: el SDK no deja mandar `I` ni `QXI` cuando cree que la sesión está
// afuera. Es un truco del script, no API pública (aprobado por el usuario el 2026-11-01).
//
// Variables: las de scripts/validate-session.mjs (SABRE_USERNAME, SABRE_PASSWORD, SABRE_PCC o
// SABRE_ORGANIZATION, SABRE_CLIENT_ID, SABRE_CLIENT_SECRET, SABRE_DOMAIN, SABRE_ENVIRONMENT), más
// SABRE_QUEUE, SABRE_EMPTY_QUEUE (un número o un nombre de cola) y SABRE_QUEUE_LIMIT.
//
// Anonimización, porque el párrafo es el PNR entero:
// - cada localizador pasa a uno falso (AAAAAA, AAAAAB…), igual en todo el sobre;
// - PassengerName y Group pasan a valores falsos; AgentSine a `AAA` (salvo `SABRE`); todo
//   PseudoCityCode, el usuario y las credenciales a `XXXX`;
// - del párrafo quedan tal cual solo las líneas de una lista blanca (avisos PIC, encabezados fijos,
//   END OF DISPLAY, la cabecera de la lista y las líneas vacías). Las demás se enmascaran: letras a
//   `X`, dígitos a `9`, se conservan espacios y puntuación.
// Si después queda un localizador real, un nombre, una línea original enmascarada, un secreto o
// algo con forma de token, no se escribe la fixture. La consola solo muestra los alias.
import { writeFileSync } from 'node:fs';
import { SabreError, SabreLegacy } from '../dist/index.js';

const scenario = process.argv[2];
if (scenario !== 'walk' && scenario !== 'empty') {
  console.error(`escenario desconocido: ${scenario ?? '(ninguno)'} (usa walk o empty)`);
  process.exit(2);
}
const environment = process.env.SABRE_ENVIRONMENT ?? 'sandbox';
if (environment !== 'sandbox' && environment !== 'production') {
  console.error(`SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})`);
  process.exit(2);
}
const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`falta la variable de entorno ${name}`);
    process.exit(2);
  }
  return value;
};

const rawUser = env('SABRE_USERNAME');
const user = rawUser.startsWith('V1:')
  ? rawUser.split(':').slice(1, -2).join(':')
  : rawUser.includes('-')
    ? rawUser.split('-').slice(0, -2).join('-')
    : rawUser;
const pcc = env('SABRE_PCC', process.env.SABRE_ORGANIZATION);
const domain = process.env.SABRE_DOMAIN ?? 'AA';
const password = env('SABRE_PASSWORD');
const clientId = env('SABRE_CLIENT_ID');
const clientSecret = env('SABRE_CLIENT_SECRET');
const username = `${user}-${pcc}-${domain}`;

const queueRef = (text) => (/^\d+$/.test(text) ? Number(text) : { name: text });
const queueText = scenario === 'walk' ? env('SABRE_QUEUE') : env('SABRE_EMPTY_QUEUE');
const queue = queueRef(queueText);
const limit = Number(process.env.SABRE_QUEUE_LIMIT ?? 10);
if (!Number.isInteger(limit) || limit < 1) {
  console.error('SABRE_QUEUE_LIMIT debe ser un entero ≥ 1');
  process.exit(2);
}

// --- Anonimización ------------------------------------------------------------------------------
const secrets = [username, `V1:${user}:${pcc}:${domain}`, user, pcc, password, clientId, clientSecret]
  .filter((value) => typeof value === 'string' && value.length >= 3)
  .sort((a, b) => b.length - a.length);
const redactSecrets = (text) => secrets.reduce((value, secret) => value.split(secret).join('XXXX'), String(text));

const locatorAliases = new Map();
const aliasOf = (locator) => {
  if (!locatorAliases.has(locator)) {
    const n = locatorAliases.size;
    locatorAliases.set(locator, `AAAA${String.fromCharCode(65 + Math.floor(n / 26))}${String.fromCharCode(65 + (n % 26))}`);
  }
  return locatorAliases.get(locator);
};
const NAMES = ['UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ'];
const realNames = new Map();
const fakeName = (name) => {
  if (!realNames.has(name)) realNames.set(name, `PASAJERO/${NAMES[realNames.size] ?? realNames.size + 1}`);
  return realNames.get(name);
};
const maskedLines = new Set();

const decode = (text) =>
  text.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]);
const encode = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SAFE_LINES = [
  /^\s*$/,
  /^\s*\d{3}\s{2,}[A-Z][A-Z0-9 ,.\/-]*$/, // aviso PIC: 011  SEE REMARKS
  /^\s*END OF DISPLAY FOR REQUESTED DATA\s*$/,
  /^\s*(TKT\/TIME LIMIT|PHONES|REMARKS|ADDRESS|INVOICED|GENERAL FACTS|[A-Z0-9]{2} FACTS|NO ITIN)\s*$/,
  /^\s*PASSENGER EMAIL DATA EXISTS\s+\*PE TO DISPLAY ALL\s*$/,
];
function anonymizeLine(line) {
  if (SAFE_LINES.some((pattern) => pattern.test(line))) return line;
  const header = /^(\s*QUEUE LIST FOR )\S+(\s+QUEUE )(\S+)\s*$/.exec(line);
  if (header !== null) return `${header[1]}XXXX${header[2]}${header[3]}`;
  const received = /^(\s*RECEIVED FROM - )(.*)$/.exec(line);
  const masked = (text) => text.replace(/\p{L}/gu, 'X').replace(/\p{N}/gu, '9');
  const result = received === null ? masked(line) : `${received[1]}${masked(received[2])}`;
  if (line.trim().length >= 4 && result.trim() !== line.trim()) maskedLines.add(line.trim());
  return result;
}

function anonymize(body) {
  // Primero los localizadores conocidos, para que el alias sea el mismo en todo el sobre.
  let text = body.replace(/(<(?:\w+:)?UniqueID\b[^>]*\bID=")([^"]+)(")/g, (_, a, locator, b) => `${a}${aliasOf(locator)}${b}`);
  for (const [locator, alias] of locatorAliases) text = text.split(locator).join(alias);
  text = text.replace(/(<(?:\w+:)?PassengerName>)([^<]*)(<\/)/g, (_, a, name, b) => `${a}${fakeName(decode(name))}${b}`);
  text = text.replace(/(<(?:\w+:)?Group>)([^<]*)(<\/)/g, (_, a, value, b) => (value === '' ? `${a}${b}` : `${a}GRUPO${b}`));
  text = text.replace(/(\bAgentSine=")([^"]*)(")/g, (_, a, sine, b) => `${a}${sine === 'SABRE' ? sine : 'AAA'}${b}`);
  text = text.replace(/(\bPseudoCityCode=")([^"]*)(")/g, '$1XXXX$3');
  text = text.replace(/(<(?:\w+:)?Paragraph\b[^>]*>)([\s\S]*?)(<\/(?:\w+:)?Paragraph>)/g, (_, open, inner, close) => {
    const lines = inner.replace(/(<(?:\w+:)?Text\b[^>/]*>)([\s\S]*?)(<\/(?:\w+:)?Text>)/g, (__, a, line, b) => `${a}${encode(anonymizeLine(decode(line)))}${b}`);
    return `${open}${lines}${close}`;
  });
  return redactSecrets(text);
}

// --- Cliente y captura --------------------------------------------------------------------------
const events = [];
const logger = Object.fromEntries(
  ['debug', 'info', 'warn', 'error'].map((level) => [
    level,
    (message, context) => events.push({ level, message, context: JSON.parse(JSON.stringify(context ?? {})) }),
  ]),
);
const legacy = new SabreLegacy({
  environment,
  authVersion: 'v3',
  credentials: { username, password, clientId, clientSecret },
  retry: { maxRetries: 0 },
  logger,
});

const raws = [];
const options = { onRawResponse: (raw) => raws.push({ operation: raw.operation, status: raw.status, attempts: raw.attempts, body: raw.body }) };
const results = [];

function describeError(error) {
  if (!(error instanceof Error)) return { thrown: String(error) };
  return {
    name: error.name,
    message: error.message,
    ...(error instanceof SabreError && { code: error.code, retryable: error.retryable, status: error.status }),
  };
}

/** Corre un paso y guarda su resultado; los localizadores se registran para el alias. */
async function step(name, run, summarize = () => undefined) {
  try {
    const value = await run();
    results.push({ step: name, ok: true, ...(summarize(value) ?? {}) });
    return value;
  } catch (error) {
    results.push({ step: name, ok: false, error: describeError(error) });
    return undefined;
  }
}
const stepSummary = (value) =>
  value === undefined
    ? undefined
    : value.done
      ? { done: true, message: value.message, warnings: value.warnings.length }
      : { done: false, locator: aliasOf(value.item.locator), warnings: value.warnings.length };

console.log(`entorno ${environment} · escenario ${scenario} · cola ${queueText}`);
const session = await legacy.openSession(options);
const send = Object.getOwnPropertySymbols(Object.getPrototypeOf(session)).find((s) => s.description === 'sabre-client.session.send');
if (send === undefined) {
  console.error('no se encontró sessionSend en el prototipo de la sesión');
  await session.close();
  process.exit(1);
}
const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';
const rawNavigation = (action) =>
  session[send]({
    service: 'queueAccess',
    action: 'QueueAccessLLSRQ',
    payload: `<QueueAccessRQ Version="2.1.1" xmlns="${NAMESPACE}"><Navigation Action="${action}"/></QueueAccessRQ>`,
    idempotent: false,
    operation: `probe.${action}`,
    ...options,
  });

let listed;
const visited = [];
try {
  await step('count', () => session.queue.count({}, options), (r) => ({ queues: r.queues.length, totals: r.totals }));
  listed = await step('list', () => session.queue.list({ queue }, options), (r) => ({ locators: r.locators.map(aliasOf) }));

  if (scenario === 'walk') {
    // ¿list dejó la sesión dentro de la cola? Un `I` crudo: un PNR quiere decir que sí.
    await step('probe.I después de list', () => rawNavigation('I'), (r) => ({ payload: r.payloadName, line: r.payload?.Line !== undefined }));
    // Salir por las dudas, y un segundo `QXI` que seguro va fuera de una cola.
    await step('probe.QXI', () => rawNavigation('QXI'), (r) => ({ payload: r.payloadName }));
    await step('probe.QXI fuera de una cola', () => rawNavigation('QXI'), (r) => ({ payload: r.payloadName }));
  }

  let current = await step('access', () => session.queue.access({ queue }, options), stepSummary);
  if (current !== undefined && !current.done) visited.push(current.item.locator);

  if (scenario === 'walk' && current !== undefined && !current.done) {
    await step('count dentro de la cola', () => session.queue.count({}, options), (r) => ({ queues: r.queues.length }));
    while (current !== undefined && !current.done && visited.length < limit) {
      current = await step('ignore', () => session.queue.ignore(options), stepSummary);
      if (current !== undefined && !current.done) visited.push(current.item.locator);
    }
  }
  if (session.queue.state !== 'outside') await step('exit', () => session.queue.exit(options));
} finally {
  await step('close', () => session.close(options));
}

// --- Hallazgos ----------------------------------------------------------------------------------
const listOrder = listed?.locators ?? [];
const result = (name) => results.find((r) => r.step === name);
const findings = {
  listedCount: listOrder.length,
  visitedCount: visited.length,
  traversalMatchesList: visited.every((locator, index) => locator === listOrder[index]),
  endOfDisplay: results.some((r) => r.done === true),
  ...(scenario === 'walk' && {
    listLeavesSessionInside: result('probe.I después de list')?.line === true,
    qxiOutsideQueue: result('probe.QXI fuera de una cola'),
    // Si el PNR que sigue a count dentro de la cola es el segundo de la lista, count no movió el cursor.
    countInsideKeepsCursor: visited.length >= 2 ? visited[1] === listOrder[1] : undefined,
  }),
  finalState: session.queue.state,
};

const responses = raws.map((raw) => ({ ...raw, body: anonymize(raw.body) }));
const fixture = {
  recordedAt: new Date().toISOString().slice(0, 10),
  environment,
  scenario,
  queue: typeof queue === 'number' ? queue : { name: 'XXXX' },
  results: JSON.parse(anonymize(JSON.stringify(results))),
  findings: JSON.parse(anonymize(JSON.stringify(findings))),
  events: JSON.parse(anonymize(JSON.stringify(events))),
  responses,
};
const text = `${JSON.stringify(fixture, null, 2)}\n`;

const leaks = [
  ...[password, clientId, clientSecret, user, pcc].filter((s) => s.length >= 3 && text.includes(s)).map(() => 'secreto'),
  ...[...locatorAliases.keys()].filter((locator) => text.includes(locator)).map(() => 'localizador'),
  ...[...realNames.keys()].filter((name) => name.length >= 3 && text.includes(name)).map(() => 'nombre'),
  ...[...maskedLines].filter((line) => text.includes(line)).map(() => 'línea del párrafo'),
  ...(/IceSess|Shared\/IDL/.test(text) ? ['token'] : []),
];
for (const r of fixture.results) console.log(`${r.ok ? '✔' : '✘'} ${r.step} ${JSON.stringify({ ...r, step: undefined, ok: undefined })}`);
console.log('\nhallazgos:', JSON.stringify(fixture.findings, null, 2));
if (leaks.length > 0) {
  console.error(`⚠️ la fixture todavía trae datos reales (${[...new Set(leaks)].join(', ')}): no se escribe.`);
  process.exit(1);
}
const file = new URL(`../test/fixtures/queue.${environment}-${scenario}.json`, import.meta.url);
writeFileSync(file, text);
console.log(`fixture: ${file.pathname}`);
