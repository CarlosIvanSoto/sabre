#!/usr/bin/env node
// Lee una reserva completa con Get Booking y la imprime en JSON. Es de solo lectura: sirve para
// revisar un PNR, por ejemplo el del piloto durante su ventana de revisión. Necesita
// `npm run build` antes.
//
//   node --env-file=.env.production examples/get-booking.mjs        # localizador, PCC y entorno del lock del piloto
//   SABRE_ENVIRONMENT=production node --env-file=.env.production examples/get-booking.mjs ABCDEF
//
// La salida trae los datos del pasajero tal como los guardó Sabre: solo va a la consola.
import { readFile } from 'node:fs/promises';
import { Sabre, SabreError } from 'sabre-client';

const LOCK_FILE = new URL('../.sabre-pilot-pnr.json', import.meta.url);

const fail = (message) => {
  console.error(message);
  process.exit(2);
};
const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') fail(`falta la variable de entorno ${name}`);
  return value;
};

// Sin argumento, el localizador y su PCC salen del lock del piloto.
let lock;
try {
  lock = JSON.parse(await readFile(LOCK_FILE, 'utf8'));
} catch {
  lock = undefined;
}
const confirmationId = process.argv[2] ?? lock?.confirmationId ?? undefined;
if (confirmationId === undefined || confirmationId === null || !/^[A-Z0-9]{6,}$/.test(confirmationId)) {
  fail('uso: get-booking.mjs <localizador>  (6 o más mayúsculas o dígitos; sin argumento usa .sabre-pilot-pnr.json)');
}
const fromLock = process.argv[2] === undefined || process.argv[2] === lock?.confirmationId;
const targetPcc = process.env.SABRE_TARGET_PCC || (fromLock ? lock?.targetPcc : undefined) || undefined;
// El entorno del lock si el localizador sale de ahí; si no, sandbox como los demás ejemplos.
const environment = process.env.SABRE_ENVIRONMENT ?? (fromLock ? lock?.environment : undefined) ?? 'sandbox';
if (environment !== 'sandbox' && environment !== 'production') {
  fail(`SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})`);
}

const authVersion = process.env.SABRE_AUTH_VERSION ?? 'v3';
const pcc = env('SABRE_PCC', process.env.SABRE_ORGANIZATION);
const user = env('SABRE_USERNAME');
const isEpr = user.includes('-') || user.includes(':');
const username = isEpr ? user : authVersion === 'v3' ? `${user}-${pcc}-AA` : `V1:${user}:${pcc}:AA`;
const tokenStore =
  process.env.SABRE_TOKEN_STORE === 'file' ? (await import('../scripts/file-token-store.mjs')).fileTokenStore : undefined;

const sabre = new Sabre({
  environment,
  authVersion,
  credentials: {
    clientId: authVersion === 'v3' ? env('SABRE_CLIENT_ID') : process.env.SABRE_CLIENT_ID,
    clientSecret: authVersion === 'v3' ? env('SABRE_CLIENT_SECRET') : process.env.SABRE_CLIENT_SECRET,
    username,
    password: env('SABRE_PASSWORD'),
  },
  ...(tokenStore === undefined ? {} : { tokenStore }),
});

console.error(`entorno ${environment} · localizador ${confirmationId}${targetPcc === undefined ? '' : ` · targetPcc ${targetPcc}`}`);
try {
  // Sin `returnOnly`: la reserva completa.
  const booking = await sabre.booking.get({ confirmationId, ...(targetPcc === undefined ? {} : { targetPcc }) });
  const { warnings, errors, ...rest } = booking;
  console.log(JSON.stringify(rest, null, 2));
  if (warnings.length > 0) console.error(`warnings: ${warnings.map((w) => w.code).join(', ')}`);
  if (errors.length > 0) console.error(`errores (la reserva llegó, pero le faltan secciones): ${errors.map((e) => e.code).join(', ')}`);
} catch (error) {
  if (!(error instanceof SabreError)) throw error;
  console.error(`✗ ${error.name}: ${error.message}`);
  process.exitCode = 1;
}
