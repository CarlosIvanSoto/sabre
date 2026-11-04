#!/usr/bin/env node
// Valida la sesión SOAP contra Sabre (#95): abre, hace ping y cierra una sesión real, y graba las
// respuestas como fixtures. Lo corre el usuario, con su confirmación en cada corrida; nunca la CI.
// Necesita `npm run build` antes.
//
//   SABRE_ENVIRONMENT=production node --env-file=.env.production scripts/validate-session.mjs v3
//   SABRE_ENVIRONMENT=production node --env-file=.env.production scripts/validate-session.mjs v2
//   SABRE_ENVIRONMENT=production node --env-file=.env.production scripts/validate-session.mjs expire
//
// - `v3`: credenciales con clientId y clientSecret → SessionCreateRQ 2.0.0. Abre, ping, cierra.
// - `v2`: el mismo EPR en formato `V1:user:PCC:domain` y sin clientId ni clientSecret →
//   SessionCreateRQ 1.0.0. Abre, ping, cierra.
// - `expire`: como `v3`, pero espera SABRE_EXPIRE_MINUTES (16 por defecto) sin keepAlive antes
//   del ping, para ver qué devuelve Sabre con la sesión vencida. Después intenta cerrar.
//
// Solo toca la sesión: ninguna operación de cola. Ocupa uno de los 50 cupos del PCC mientras está
// abierta. Sin reintentos genéricos (`maxRetries: 0`), para ver la primera respuesta de Sabre.
//
// Variables: el juego único de credenciales de scripts/lib/env-credentials.mjs (SABRE_USERNAME
// solo el usuario, SABRE_PCC, SABRE_DOMAIN, SABRE_PASSWORD; SABRE_CLIENT_ID y
// SABRE_CLIENT_SECRET solo en `v3` y `expire`), más SABRE_ENVIRONMENT (sandbox por defecto) y
// SABRE_EXPIRE_MINUTES.
//
// Se graban solo las respuestas, nunca los requests (llevan el password y el clientSecret). El
// SDK ya tapa el BinarySecurityToken como `[REDACTED]`. Además se reemplazan por `XXXX` el
// usuario, el PCC y las credenciales. Si después de redactar queda algún secreto o algo con forma
// de token de sesión, no se escribe la fixture.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { SabreError, SabreLegacy, SabreSessionError } from '../dist/index.js';
import { envCredentials } from './lib/env-credentials.mjs';

const scenario = process.argv[2];
if (scenario !== 'v3' && scenario !== 'v2' && scenario !== 'expire') {
  console.error(`escenario desconocido: ${scenario ?? '(ninguno)'} (usa v3, v2 o expire)`);
  process.exit(2);
}
const environment = process.env.SABRE_ENVIRONMENT ?? 'sandbox';
if (environment !== 'sandbox' && environment !== 'production') {
  console.error(`SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})`);
  process.exit(2);
}

// `v2` sin clientId/clientSecret, para que la sesión sea la 1.0.0.
const { authVersion, credentials, domain, secrets: credentialSecrets } = envCredentials(
  scenario === 'v2' ? { authVersion: 'v2', app: false } : { authVersion: 'v3' },
);
const expireMinutes = Number(process.env.SABRE_EXPIRE_MINUTES ?? 16);

const secrets = credentialSecrets
  .filter((value) => typeof value === 'string' && value.length >= 3)
  .sort((a, b) => b.length - a.length);
const redact = (text) => secrets.reduce((value, secret) => value.split(secret).join('XXXX'), String(text));
const redactDeep = (value) => {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, redactDeep(v)]));
  }
  return value;
};

// Lo que emite el SDK, ya sin secretos según su contrato; se redacta igual antes de imprimir.
const events = [];
const logger = Object.fromEntries(
  ['debug', 'info', 'warn', 'error'].map((level) => [
    level,
    (message, context) => {
      const safe = redactDeep(JSON.parse(JSON.stringify(context ?? {})));
      events.push({ level, message, context: safe });
      if (level !== 'debug') console.error(`  [${level}] ${message} ${JSON.stringify(safe)}`);
    },
  ]),
);

const legacy = new SabreLegacy({
  environment,
  credentials,
  retry: { maxRetries: 0 },
  logger,
});

const steps = [];
const record = (raw) =>
  steps.push({
    operation: raw.operation,
    status: raw.status,
    attempts: raw.attempts,
    contentType: raw.headers.get('content-type'),
    body: redact(raw.body),
  });
const options = { onRawResponse: record };

/** Los campos del fault, y en cuál aparece el `USG_*`. */
function faultFields(body) {
  const field = (name) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(body)?.[1]?.trim();
  const fields = { faultcode: field('faultcode'), faultstring: field('faultstring'), detail: field('detail') };
  const usgIn = Object.entries(fields)
    .filter(([, value]) => value !== undefined && /USG_[A-Z_]+/.test(value))
    .map(([name]) => name);
  return { ...fields, usgIn };
}

function describeError(error) {
  if (!(error instanceof Error)) return { thrown: String(error) };
  const described = {
    name: error.name,
    message: redact(error.message),
    ...(error instanceof SabreError && { code: error.code, retryable: error.retryable, status: error.status }),
    ...(error instanceof SabreSessionError && { kind: error.kind }),
    ...(error.cause instanceof Error && { cause: describeError(error.cause) }),
  };
  if (typeof error.raw === 'string') described.fault = faultFields(redact(error.raw));
  return described;
}

async function step(name, run) {
  const started = Date.now();
  try {
    await run();
    const result = { step: name, ok: true, ms: Date.now() - started };
    console.log(`✔ ${name} (${result.ms} ms)`);
    return result;
  } catch (error) {
    const result = { step: name, ok: false, ms: Date.now() - started, error: describeError(error) };
    console.log(`✘ ${name}: ${JSON.stringify(result.error, null, 2)}`);
    return result;
  }
}

console.log(`entorno ${environment} · escenario ${scenario} · OAuth ${authVersion} · domain ${domain}`);
console.log(`endpoint ${legacy.baseUrl}`);

const results = [];
let session;
results.push(await step('openSession', async () => (session = await legacy.openSession(options))));

if (session !== undefined) {
  if (scenario === 'expire') {
    console.log(`esperando ${expireMinutes} min sin keepAlive…`);
    for (let minute = 1; minute <= expireMinutes; minute++) {
      await sleep(60_000);
      console.log(`  ${minute}/${expireMinutes} min · idleMs ${session.idleMs}`);
    }
  }
  results.push(await step('ping', () => session.ping(options)));
  results.push(await step('close', () => session.close(options)));
}

// --- Respuestas a las preguntas abiertas -------------------------------------------------------
const bodyOf = (operation) => steps.find((s) => s.operation === operation)?.body;
const opened = results[0].ok;
const findings = {
  sessionVersion: events.find((e) => e.message === 'sabre.session.open')?.context.version,
  opened,
  domainWorks: opened ? true : undefined,
  soapActionNeeded: opened ? false : undefined,
  // El SDK tapa el token que mandó en toda la respuesta: `[REDACTED]` en ping o close quiere decir
  // que Sabre lo repitió.
  tokenEchoed: Object.fromEntries(
    ['ping', 'close'].filter((op) => bodyOf(op) !== undefined).map((op) => [op, bodyOf(op).includes('[REDACTED]')]),
  ),
  ...(scenario === 'expire' && { expiredAfterMinutes: expireMinutes, expired: results.find((r) => r.step === 'ping')?.error }),
};

const fixture = {
  recordedAt: new Date().toISOString().slice(0, 10),
  environment,
  scenario,
  results,
  findings,
  events,
  responses: steps,
};

const text = `${JSON.stringify(fixture, null, 2)}\n`;
const leaks = credentialSecrets.filter((s) => typeof s === 'string' && s.length >= 3 && text.includes(s));
if (leaks.length > 0 || /IceSess|Shared\/IDL/.test(text)) {
  console.error('⚠️ la fixture todavía trae un secreto o un token de sesión: no se escribe.');
  process.exit(1);
}
const name = scenario === 'expire' ? `expire-${expireMinutes}min` : scenario;
const file = new URL(`../test/fixtures/session.${environment}-${name}.json`, import.meta.url);
writeFileSync(file, text);

console.log('\nhallazgos:', JSON.stringify(findings, null, 2));
console.log(`fixture: ${file.pathname}`);
const expected =
  scenario === 'expire' ? results[0].ok && results[1]?.ok === false : results.every((result) => result.ok);
process.exit(expected ? 0 : 1);
