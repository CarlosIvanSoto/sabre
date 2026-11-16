#!/usr/bin/env node
// Prueba de punta a punta de `session.reservation.searchByUpdateDate` (Trip_SearchRQ 4.5.0,
// ADR-033, #258) con la API pública del SDK compilado, no con un request armado a mano. Graba las
// respuestas, anonimizadas, como fixture. Lo corre el usuario, con su confirmación en cada corrida;
// nunca la CI. Necesita `npm run build` antes.
//
//   node --env-file=.env scripts/validate-search-by-update-date.mjs
//   SABRE_ENVIRONMENT=production SABRE_SEARCH_PCC=target \
//     node --env-file=.env.production scripts/validate-search-by-update-date.mjs
//
// Solo lectura: el SDK nunca manda `ResultAction` (que podría colocar los PNR en una cola).
//
// Recorrido, en una sesión:
//  1. ventana inválida (`from` = `to`): debe dar `TypeError` sin llamar a Sabre.
//  2. las últimas SABRE_SEARCH_HOURS horas con `anyBranch: true` (el default).
//  3. la misma ventana con `anyBranch: false`: ¿los de `false` están todos en `true`?
//  4. una ventana de 1 h en el futuro: ¿vacía, advertencia o error?
//  5. la ventana del paso 2 con `maxItems: 1`: si hay 2 o más PNR, debe dar `truncated`.
//  6. con SABRE_SEARCH_INACTIVE=1, la misma ventana con `searchType: 'BOTH'`.
//
// Variables: las credenciales (como en los demás scripts), SABRE_ENVIRONMENT (`sandbox` por
// defecto), SABRE_SEARCH_PCC (el PCC de la búsqueda; `target` toma SABRE_TARGET_PCC; por
// defecto, SABRE_PCC), SABRE_SEARCH_TZ (zona IANA del PCC, `America/Mexico_City` por defecto),
// SABRE_SEARCH_HOURS (24 por defecto) y SABRE_SEARCH_INACTIVE.
//
// Escribe test/fixtures/trip-search.<entorno>-validate.json. Los localizadores pasan a alias
// (`AAAAAA`…) y el PCC y `eb:CPAId` a `XXXX`; si queda un dato real, no escribe nada.
import { createRecorder, env, legacyClient } from './lib/legacy-recorder.mjs';
import { envCredentials } from './lib/env-credentials.mjs';

const environment = process.env.SABRE_ENVIRONMENT ?? 'sandbox';
if (environment !== 'sandbox' && environment !== 'production') {
  console.error(`SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})`);
  process.exit(2);
}
const pccEnv = process.env.SABRE_SEARCH_PCC;
const pcc = pccEnv === 'target' ? env('SABRE_TARGET_PCC') : (pccEnv ?? env('SABRE_PCC'));
const pccLabel = pccEnv === 'target' ? 'SABRE_TARGET_PCC' : pccEnv === undefined ? 'SABRE_PCC' : 'SABRE_SEARCH_PCC';
const timeZone = process.env.SABRE_SEARCH_TZ || 'America/Mexico_City';
const hours = Number(process.env.SABRE_SEARCH_HOURS ?? 24);
if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 7) {
  console.error('SABRE_SEARCH_HOURS debe ser un número de horas mayor a 0 y de hasta 168');
  process.exit(2);
}
const withInactive = process.env.SABRE_SEARCH_INACTIVE === '1';

const { credentials, secrets } = envCredentials({ authVersion: 'v3' });
const scrubbed = [...secrets, pcc, process.env.SABRE_PCC, process.env.SABRE_TARGET_PCC].filter((v) => typeof v === 'string' && v.length >= 3);
const { aliasOf, step, results, options, logger, writeFixture, rawBodies, transformBodies } = createRecorder(scrubbed);
const legacy = legacyClient(environment, credentials, logger);

// `eb:CPAId` es el PCC de la sesión; el resto lo cubre el anonimizador (secretos y localizadores con alias).
transformBodies((body) => body.replace(/(<(?:[\w-]+:)?CPAId\b[^>]*>)[^<]*(<\/(?:[\w-]+:)?CPAId>)/g, '$1XXXX$2'));
// El alias se registra antes de anonimizar: así `anonymize` lo reemplaza en todos los sobres.
transformBodies((body) => {
  for (const match of body.matchAll(/<(?:[\w-]+:)?Reservation\b[^>]*\bLocator="([^"]+)"/g)) aliasOf(match[1]);
  return body;
});

const now = new Date();
const to = now;
const from = new Date(now.getTime() - hours * 3600_000);
const base = { pcc, from, to, timeZone };
const summary = (r) =>
  r === undefined
    ? undefined
    : {
        status: r.status,
        anyBranch: r.anyBranch,
        window: { after: r.window.after, before: r.window.before, timeZone: r.window.timeZone },
        reservations: r.reservations.map((x) => ({ locator: aliasOf(x.locator), ...(x.pastDate !== undefined && { pastDate: x.pastDate }) })),
        numberResults: r.numberResults,
        totalResults: r.totalResults,
        warnings: r.warnings,
        respondedAt: r.respondedAt,
        sabreLocalOffsetMinutes: r.sabreLocalOffsetMinutes ?? null,
      };

console.log(`entorno ${environment} · PCC de ${pccLabel} · ${timeZone} · últimas ${hours} h${withInactive ? ' · con BOTH' : ''}`);
const session = await legacy.openSession(options);
let wide, narrow, future, capped, both;
let invalidWentToNetwork;
try {
  const before = rawBodies().length;
  await step('ventana inválida', () => session.reservation.searchByUpdateDate({ ...base, from: to }, options));
  invalidWentToNetwork = rawBodies().length !== before;

  wide = await step(`últimas ${hours} h, anyBranch true`, () => session.reservation.searchByUpdateDate(base, options), summary);
  narrow = await step(`últimas ${hours} h, anyBranch false`, () => session.reservation.searchByUpdateDate({ ...base, anyBranch: false }, options), summary);
  future = await step('1 h en el futuro', () => session.reservation.searchByUpdateDate({ ...base, from: new Date(now.getTime() + 3600_000), to: new Date(now.getTime() + 7200_000) }, options), summary);
  capped = await step('maxItems 1', () => session.reservation.searchByUpdateDate({ ...base, maxItems: 1 }, options), summary);
  if (withInactive) both = await step('searchType BOTH', () => session.reservation.searchByUpdateDate({ ...base, searchType: 'BOTH' }, options), summary);
} finally {
  await step('close', () => session.close(options));
}

const locators = (r) => new Set(r?.reservations.map((x) => x.locator) ?? []);
const wideSet = locators(wide);
const findings = {
  invalidWindow: { threwTypeError: results[0]?.ok === false && results[0]?.error?.name === 'TypeError', wentToNetwork: invalidWentToNetwork },
  anyBranch:
    wide === undefined || narrow === undefined
      ? 'error'
      : { true: wide.reservations.length, false: narrow.reservations.length, falseIsSubsetOfTrue: [...locators(narrow)].every((l) => wideSet.has(l)) },
  sabreLocalOffsetMinutes: wide?.sabreLocalOffsetMinutes ?? null,
  timezoneMismatch: [wide, narrow, future, capped, both].some((r) => r?.warnings.some((w) => w.code === 'TIMEZONE_MISMATCH')),
  futureWindow: future === undefined ? results.find((r) => r.step === '1 h en el futuro')?.error ?? 'error' : { status: future.status, reservations: future.reservations.length, warnings: future.warnings },
  maxItems1:
    capped === undefined
      ? results.find((r) => r.step === 'maxItems 1')?.error ?? 'error'
      : { status: capped.status, numberResults: capped.numberResults, totalResults: capped.totalResults, warnings: capped.warnings, expectedTruncated: wideSet.size >= 2 },
  ...(withInactive && { both: both === undefined ? 'error' : { reservations: both.reservations.length, pastDate: both.reservations.filter((x) => x.pastDate).length } }),
};

writeFixture(`trip-search.${environment}-validate`, { environment, timeZone, hours, searchType: withInactive ? ['ACTIVE', 'BOTH'] : ['ACTIVE'] }, findings);
