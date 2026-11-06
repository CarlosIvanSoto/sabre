// Lo que comparten los scripts que graban fixtures de colas contra Sabre (validate-queue.mjs y
// validate-place.mjs): credenciales del entorno, captura de respuestas, anonimización por
// estructura y la protección que no escribe una fixture con datos reales. Nunca lo usa la CI.
import { writeFileSync } from 'node:fs';
import { SabreError, SabreLegacy } from '../../dist/index.js';
import { createAnonymizer } from '../../dist/testing.js';
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

/**
 * Captura y anonimización de un recorrido. La anonimización es `createAnonymizer` de
 * `sabre-client/testing` (ver su JSDoc): cada localizador pasa a un alias (`AAAAAA`, `AAAAAB`…)
 * igual en todo el sobre; `PassengerName` y `Group` a valores falsos; `AgentSine` a `AAA` (salvo
 * `SABRE`); todo PCC, el usuario y las credenciales a `XXXX`; el `LNIATA` a `XXXXXX`. De cada
 * `<Text>` (el PNR en formato de host) quedan tal cual solo las líneas de la lista blanca; las
 * demás se enmascaran: letras a `X` y dígitos a `9`.
 */
export function createRecorder(secretValues) {
  const { anonymize, aliasOf, maskLine, leaks } = createAnonymizer({ secrets: secretValues });

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
    const found = leaks(text);
    for (const r of fixture.results) console.log(`${r.ok ? '✔' : '✘'} ${r.step} ${JSON.stringify({ ...r, step: undefined, ok: undefined })}`);
    console.log('\nhallazgos:', JSON.stringify(fixture.findings, null, 2));
    if (found.length > 0) {
      console.error(`⚠️ la fixture todavía trae datos reales (${found.join(', ')}): no se escribe.`);
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
