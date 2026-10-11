#!/usr/bin/env node
// Smoke manual del Tier 1 con credenciales propias: auth → BFM → Revalidate → Create Booking.
// Lo corre el usuario; nunca la CI. Necesita `npm run build` antes. Ver examples/README.md.
//
//   node --env-file=.env examples/run-air-booking-flow.mjs
//   SABRE_CREATE_BOOKING=1 node --env-file=.env examples/run-air-booking-flow.mjs
//   SABRE_ENVIRONMENT=production node --env-file=.env.production examples/run-air-booking-flow.mjs
//
// Create Booking solo corre con SABRE_CREATE_BOOKING=1 y nunca en producción: crearía un PNR
// real (decisión del 2026-10-11 en sabre-wiki/wiki/sdk/plan-tier-1.md).
import { Sabre, SabreBusinessError, SabreError } from 'sabre-client';
import { airBookingFlow, oneWaySearch } from './air-booking-flow.mjs';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`falta la variable de entorno ${name}`);
    process.exit(2);
  }
  return value;
};

const environment = process.env.SABRE_ENVIRONMENT ?? 'sandbox';
if (environment !== 'sandbox' && environment !== 'production') {
  console.error(`SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})`);
  process.exit(2);
}
const book = process.env.SABRE_CREATE_BOOKING === '1';
if (book && environment === 'production') {
  console.error('Create Booking no se corre en producción: crearía un PNR real. Quita SABRE_CREATE_BOOKING.');
  process.exit(2);
}

const authVersion = process.env.SABRE_AUTH_VERSION ?? 'v3';
const pcc = env('SABRE_PCC', process.env.SABRE_ORGANIZATION);
const user = env('SABRE_USERNAME');
const isEpr = user.includes('-') || user.includes(':');
const username = isEpr ? user : authVersion === 'v3' ? `${user}-${pcc}-AA` : `V1:${user}:${pcc}:AA`;
const credentials = {
  clientId: authVersion === 'v3' ? env('SABRE_CLIENT_ID') : process.env.SABRE_CLIENT_ID,
  clientSecret: authVersion === 'v3' ? env('SABRE_CLIENT_SECRET') : process.env.SABRE_CLIENT_SECRET,
  username,
  password: env('SABRE_PASSWORD'),
};

// Cuenta las peticiones de token para comprobar que el token se reutiliza en todo el flujo.
let tokenRequests = 0;
const countingFetch = (input, init) => {
  if (String(input).includes('/auth/token')) tokenRequests += 1;
  return fetch(input, init);
};

// Opcional: reutiliza el token de corridas anteriores (archivo .sabre-token.json, ignorado por git).
const tokenStore =
  process.env.SABRE_TOKEN_STORE === 'file' ? (await import('../scripts/file-token-store.mjs')).fileTokenStore : undefined;

// El SDK ya redacta el contexto antes de llamar al logger.
const logger = process.env.SABRE_DEBUG === '1' ? console : undefined;

const sabre = new Sabre({
  environment,
  authVersion,
  credentials,
  fetch: countingFetch,
  ...(tokenStore === undefined ? {} : { tokenStore }),
  ...(logger === undefined ? {} : { logger }),
});

const departure = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const search = oneWaySearch({
  pcc,
  origin: process.env.SABRE_ORIGIN ?? 'DFW',
  destination: process.env.SABRE_DESTINATION ?? 'LAX',
  departureDateTime: `${departure}T10:00:00`,
});

console.log(`entorno ${environment} · OAuth ${authVersion} · Create Booking ${book ? 'activado' : 'desactivado'}`);
try {
  const summary = await airBookingFlow(sabre, {
    search,
    book,
    onStep: (step, detail) => console.log(`✓ ${step}`, detail),
  });
  if (!book) console.log('- createBooking omitido (SABRE_CREATE_BOOKING=1 para activarlo, solo en sandbox)');
  console.log(`precio en BFM ${summary.searchPrice} · revalidado ${summary.revalidatedPrice}`);
} catch (error) {
  if (!(error instanceof SabreError)) throw error;
  const warnings = error instanceof SabreBusinessError ? error.warnings.map((w) => w.code).join(', ') : '';
  console.error(
    `✗ ${error.name}: ${error.message} (code ${error.code ?? '-'}, status ${error.status ?? '-'}` +
      `${warnings === '' ? '' : `, warnings ${warnings}`})`,
  );
  process.exitCode = 1;
}

const reused = tokenRequests <= 1;
console.log(
  `peticiones de token: ${tokenRequests}${tokenStore === undefined ? '' : ' (con tokenStore de archivo)'}` +
    ` → ${reused ? 'el token se reutilizó en todo el flujo' : 'ERROR: se pidió más de un token (con SABRE_DEBUG=1 se ve si hubo un refresco reactivo por 401)'}`,
);
if (!reused) process.exitCode = 1;
