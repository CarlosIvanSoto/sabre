// Lo que comparten los scripts que graban fixtures de colas contra Sabre (validate-queue.mjs y
// validate-place.mjs): credenciales del entorno, captura de respuestas, anonimización por
// estructura y la protección que no escribe una fixture con datos reales. Nunca lo usa la CI.
import { writeFileSync } from 'node:fs';
import { SabreError, SabreLegacy } from '../../dist/index.js';
import { env, envCredentials } from './env-credentials.mjs';

export { env };

/** `"12"` da `12`, `"S"` da `'S'` (cola alfabética) y `"HOTELS"`, `{ name: 'HOTELS' }` (ADR-028). */
/** Corta el script si la cola es la `S`: sus pasos son mensajes, no PNR (ADR-028). */
export function rejectMessageQueue(queue, variable) {
  if (queue !== 'S') return;
  console.error(`${variable}=S es la cola de mensajes: no tiene PNR (para grabarla, usa validate-queue.mjs messages)`);
  process.exit(2);
}

export const queueRef = (text) => (/^\d+$/.test(text) ? Number(text) : /^[A-Z]{1,2}$/.test(text) ? text : { name: text });

/**
 * Credenciales v3 del entorno y el PCC de las colas: SABRE_QUEUE_PCC, o SABRE_TARGET_PCC si vale
 * `target`; sin la variable, el de la sesión.
 */
export function legacyEnvironment() {
  const environment = process.env.SABRE_ENVIRONMENT ?? 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') {
    console.error(`SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})`);
    process.exit(2);
  }
  // Siempre v3: las fixtures de colas se graban con SessionCreateRQ 2.0.0.
  const { credentials, secrets: credentialSecrets } = envCredentials({ authVersion: 'v3' });
  const queuePccEnv = process.env.SABRE_QUEUE_PCC;
  const queuePcc = queuePccEnv === 'target' ? env('SABRE_TARGET_PCC') : queuePccEnv;
  const queuePccLabel = queuePccEnv === 'target' ? 'SABRE_TARGET_PCC' : queuePcc === undefined ? 'el de la sesión' : 'SABRE_QUEUE_PCC';
  const secrets = [...credentialSecrets, queuePcc];
  return { environment, credentials, queuePcc, queuePccLabel, secrets };
}

const NAMES = ['UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ'];

/** Líneas de un PNR en formato de host que quedan tal cual: no traen datos del pasajero. */
const SAFE_LINES = [
  /^\s*$/,
  // Aviso PIC: 011  SEE REMARKS. Sin dígitos después del número: una línea de `list`
  // (`100  ABC123  PLT  MAM  01JUN26  1948`) también empieza con 3 dígitos y trae el sine.
  /^\s*\d{3}\s{2,}[A-Z][A-Z ,.\/-]*$/,
  /^\s*END OF DISPLAY FOR REQUESTED DATA\s*$/,
  /^\s*(TKT\/TIME LIMIT|PHONES|REMARKS|ADDRESS|INVOICED|GENERAL FACTS|[A-Z0-9]{2} FACTS|NO ITIN)\s*$/,
  /^\s*PASSENGER EMAIL DATA EXISTS\s+\*PE TO DISPLAY ALL\s*$/,
];

const decode = (text) =>
  text.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]);
const encode = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Captura y anonimización de un recorrido. Cada localizador pasa a un alias (`AAAAAA`, `AAAAAB`…)
 * igual en todo el sobre; `PassengerName` y `Group` a valores falsos; `AgentSine` a `AAA` (salvo
 * `SABRE`); todo PCC, el usuario y las credenciales a `XXXX`; el `LNIATA` a `XXXXXX`. De cada `<Text>` (el PNR en formato
 * de host, en `Paragraph` o suelto en `QueuePlaceRS`) quedan tal cual solo las líneas de la lista
 * blanca; las demás se enmascaran: letras a `X` y dígitos a `9`.
 */
export function createRecorder(secretValues) {
  const secrets = secretValues.filter((value) => typeof value === 'string' && value.length >= 3).sort((a, b) => b.length - a.length);
  const redactSecrets = (text) => secrets.reduce((value, secret) => value.split(secret).join('XXXX'), String(text));
  const locatorAliases = new Map();
  const realNames = new Map();
  const maskedLines = new Set();

  const aliasOf = (locator) => {
    if (!locatorAliases.has(locator)) {
      const n = locatorAliases.size;
      // Base 26 en cuatro letras: `AAAAAA`, `AAAAAB`… y sigue en letras después del 676 (`AAABAA`).
      const letters = [17576, 676, 26, 1].map((size) => String.fromCharCode(65 + (Math.floor(n / size) % 26))).join('');
      locatorAliases.set(locator, `AA${letters}`);
    }
    return locatorAliases.get(locator);
  };
  const fakeName = (name) => {
    if (!realNames.has(name)) realNames.set(name, `PASAJERO/${NAMES[realNames.size] ?? realNames.size + 1}`);
    return realNames.get(name);
  };

  function anonymizeLine(line) {
    if (SAFE_LINES.some((pattern) => pattern.test(line))) return line;
    const header = /^(\s*QUEUE LIST FOR )\S+(\s+QUEUE )(\S+)\s*$/.exec(line);
    if (header !== null) return `${header[1]}XXXX${header[2]}${header[3]}`;
    const received = /^(\s*RECEIVED FROM - )(.*)$/.exec(line);
    const masked = (text) => text.replace(/\p{L}/gu, 'X').replace(/\p{N}/gu, '9');
    // La línea de firma (`<PCC>.<PCC>*<agente> HHMM/DDMMMYY <localizador> H`) conserva su forma:
    // de ella sale el localizador del PNR siguiente en `place` dentro de una cola. Se deja el
    // localizador solo si ya es un alias; uno desconocido se enmascara como el resto.
    const signature = /^(.*\s)(\d{4}\/\d{2}[A-Z]{3}\d{2})(\s+)([A-Z0-9]{6})(\s+H\s*)$/.exec(line);
    const aliases = new Set(locatorAliases.values());
    const result =
      received !== null
        ? `${received[1]}${masked(received[2])}`
        : signature !== null
          ? `${masked(signature[1])}${masked(signature[2])}${signature[3]}${aliases.has(signature[4]) ? signature[4] : masked(signature[4])}${signature[5]}`
          : masked(line);
    if (line.trim().length >= 4 && result.trim() !== line.trim()) maskedLines.add(line.trim());
    return result;
  }

  function anonymize(body) {
    let text = body.replace(/(<(?:\w+:)?UniqueID\b[^>]*\bID=")([^"]+)(")/g, (_, a, locator, b) => `${a}${aliasOf(locator)}${b}`);
    for (const [locator, alias] of locatorAliases) text = text.split(locator).join(alias);
    text = text.replace(/(<(?:\w+:)?PassengerName>)([^<]*)(<\/)/g, (_, a, name, b) => `${a}${fakeName(decode(name))}${b}`);
    text = text.replace(/(<(?:\w+:)?Group>)([^<]*)(<\/)/g, (_, a, value, b) => (value === '' ? `${a}${b}` : `${a}GRUPO${b}`));
    text = text.replace(/(\bAgentSine=")([^"]*)(")/g, (_, a, sine, b) => `${a}${sine === 'SABRE' ? sine : 'AAA'}${b}`);
    text = text.replace(/(\bPseudoCityCode=")([^"]*)(")/g, '$1XXXX$3');
    // La dirección de la terminal, como en validate-command.mjs.
    text = text.replace(/(\bLNIATA=")([^"]*)(")/g, '$1XXXXXX$3');
    text = text.replace(/(<(?:\w+:)?Text\b[^>/]*>)([\s\S]*?)(<\/(?:\w+:)?Text>)/g, (_, a, line, b) => `${a}${encode(anonymizeLine(decode(line)))}${b}`);
    return redactSecrets(text);
  }

  const raws = [];
  const transforms = [];
  const results = [];
  const events = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (message, context) => events.push({ level, message, context: JSON.parse(JSON.stringify(context ?? {})) }),
    ]),
  );
  const options = {
    onRawResponse: (raw) => raws.push({ operation: raw.operation, status: raw.status, attempts: raw.attempts, body: raw.body }),
  };

  function describeError(error) {
    if (!(error instanceof Error)) return { thrown: String(error) };
    return {
      name: error.name,
      message: error.message,
      ...(error instanceof SabreError && { code: error.code, retryable: error.retryable, status: error.status }),
    };
  }

  /** Corre un paso y guarda su resultado. Si falla, devuelve `undefined` y sigue. */
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

  /** Resumen de un `QueueStep` con el alias del localizador. Un mensaje de la `S` da solo cuántas líneas trae. */
  const stepSummary = (value) =>
    value === undefined
      ? undefined
      : 'done' in value && value.done
        ? { done: true, reason: value.reason, message: value.message, warnings: value.warnings.length }
        : 'done' in value && value.kind === 'message'
          ? { done: false, kind: 'message', lines: value.message.text.length, warnings: value.warnings.length }
          : 'done' in value
            ? { done: false, locator: aliasOf(value.item.locator), warnings: value.warnings.length }
          : { placements: value.placements.length, warnings: value.warnings.length };

  /**
   * Arma la fixture anonimizada, la imprime y la escribe en `test/fixtures/<name>.json`, salvo que
   * quede un dato real: entonces corta con código 1 sin escribir nada.
   */
  function writeFixture(name, meta, findings) {
    for (const raw of raws) raw.body = transforms.reduce((body, transform) => transform(body), raw.body);
    const fixture = {
      recordedAt: new Date().toISOString().slice(0, 10),
      ...meta,
      results: JSON.parse(anonymize(JSON.stringify(results))),
      findings: JSON.parse(anonymize(JSON.stringify(findings))),
      events: JSON.parse(anonymize(JSON.stringify(events))),
      responses: raws.map((raw) => ({ ...raw, body: anonymize(raw.body) })),
    };
    const text = `${JSON.stringify(fixture, null, 2)}\n`;
    const leaks = [
      ...secrets.filter((secret) => text.includes(secret)).map(() => 'secreto'),
      ...[...locatorAliases.keys()].filter((locator) => text.includes(locator)).map(() => 'localizador'),
      ...[...realNames.keys()].filter((realName) => realName.length >= 3 && text.includes(realName)).map(() => 'nombre'),
      ...[...maskedLines].filter((line) => text.includes(line)).map(() => 'línea del PNR'),
      ...(/IceSess|Shared\/IDL/.test(text) ? ['token'] : []),
    ];
    for (const r of fixture.results) console.log(`${r.ok ? '✔' : '✘'} ${r.step} ${JSON.stringify({ ...r, step: undefined, ok: undefined })}`);
    console.log('\nhallazgos:', JSON.stringify(fixture.findings, null, 2));
    if (leaks.length > 0) {
      console.error(`⚠️ la fixture todavía trae datos reales (${[...new Set(leaks)].join(', ')}): no se escribe.`);
      process.exit(1);
    }
    const file = new URL(`../../test/fixtures/${name}.json`, import.meta.url);
    writeFileSync(file, text);
    console.log(`fixture: ${file.pathname}`);
  }

  /** Las respuestas crudas, sin anonimizar, en orden: solo para calcular hallazgos. */
  const rawBodies = () => raws.map(({ operation, body }) => ({ operation, body }));
  /**
   * Una anonimización extra para los bodies, que corre antes de la general al escribir la fixture
   * (p. ej. el historial del PNR, que trae datos fuera de `<Text>`).
   */
  const transformBodies = (transform) => transforms.push(transform);

  /**
   * Una línea del PNR en formato de host, enmascarada como dentro de `<Text>`, para copiarla a
   * `results` o `findings`. Llamarla después de dar alias a los localizadores.
   */
  const maskLine = (line) => redactSecrets(anonymizeLine(line));

  return { aliasOf, anonymize, maskLine, step, stepSummary, results, options, logger, writeFixture, rawBodies, transformBodies };
}

/** Un `SabreLegacy` sin reintentos genéricos, para ver la primera respuesta de Sabre. */
export function legacyClient(environment, credentials, logger) {
  return new SabreLegacy({ environment, authVersion: 'v3', credentials, retry: { maxRetries: 0 }, logger });
}

/**
 * El método interno de la sesión (`sessionSend`), sacado del prototipo: el SDK no deja mandar `I`
 * ni `QXI` cuando cree que la sesión está afuera. Es un truco de los scripts, no API pública
 * (aprobado por el usuario el 2026-11-01).
 */
export function sessionSendOf(session) {
  return Object.getOwnPropertySymbols(Object.getPrototypeOf(session)).find((s) => s.description === 'sabre-client.session.send');
}
