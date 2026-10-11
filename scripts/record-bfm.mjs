#!/usr/bin/env node
// Graba fixtures de Bargain Finder Max v5 contra sandbox (cert) con credenciales reales.
// Lo corre el usuario; nunca la CI. Necesita `npm run build` antes.
//
//   node --env-file=.env scripts/record-bfm.mjs [ok|no-schedules]
//
// Variables: SABRE_CLIENT_ID, SABRE_CLIENT_SECRET, SABRE_USERNAME, SABRE_PASSWORD y
// SABRE_PCC (o SABRE_ORGANIZATION). Si SABRE_USERNAME es solo el ID de usuario, se arma el
// EPR: `<user>-<PCC>-AA` en v3 y `V1:<user>:<PCC>:AA` en v2.
//
// Opcionales: SABRE_AUTH_VERSION (v3 por defecto), SABRE_BFM_ORIGIN / SABRE_BFM_DESTINATION
// (DFW / LAX por defecto).
//
// `ok` busca ida y vuelta y debe devolver itinerarios. `no-schedules` pide un directo
// imposible para provocar un error de BFM y ver en qué campo viaja.
//
// Antes de guardar se redacta: PCC, TRANSACTIONID y cualquier string con el usuario EPR.
// El token nunca llega al archivo: solo se graba el body del servicio.
import { writeFileSync } from 'node:fs';
import { Sabre, SabreError } from '../dist/index.js';
import { fileTokenStore } from './file-token-store.mjs';

const mode = process.argv[2] ?? 'ok';
if (mode !== 'ok' && mode !== 'no-schedules') {
  console.error(`modo desconocido: ${mode} (usa ok o no-schedules)`);
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

const origin = process.env.SABRE_BFM_ORIGIN ?? 'DFW';
const destination = process.env.SABRE_BFM_DESTINATION ?? 'LAX';
const day = (offset) => {
  const date = new Date(Date.now() + offset * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T10:00:00`;
};

const legs =
  mode === 'ok'
    ? [
        [origin, destination, day(30)],
        [destination, origin, day(37)],
      ]
    : // Ruta transoceánica corta sin directos: MaxStopsQuantity 0 debería fallar.
      [['GDL', 'WAW', day(30)]];

const request = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: { Source: [{ PseudoCityCode: pcc, RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
    OriginDestinationInformation: legs.map(([from, to, when]) => ({
      DepartureDateTime: when,
      OriginLocation: { LocationCode: from },
      DestinationLocation: { LocationCode: to },
    })),
    TravelPreferences: { MaxStopsQuantity: mode === 'ok' ? 1 : 0 },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  },
};

// Captura el body crudo del servicio (el SDK devuelve la respuesta ya desnormalizada).
let captured;
const recordingFetch = async (input, init) => {
  const response = await fetch(input, init);
  if (String(input).includes('/v5/offers/shop')) {
    captured = { status: response.status, body: await response.clone().text() };
  }
  return response;
};

const sabre = new Sabre({ environment: 'sandbox', authVersion, credentials, fetch: recordingFetch, retry: { maxRetries: 0 }, tokenStore: fileTokenStore });

let outcome;
try {
  const result = await sabre.air.bargainFinderMax(request);
  const count = result.itineraryGroups.reduce((n, group) => n + group.itineraries.length, 0);
  outcome = `ok: ${count} itinerarios`;
} catch (error) {
  if (!(error instanceof SabreError)) throw error;
  outcome = `${error.name}: ${error.message} (code ${error.code ?? '-'}, retryable ${error.retryable})`;
}
console.log(outcome);

if (captured === undefined) {
  console.error('no se capturó la respuesta del servicio');
  process.exit(1);
}

let body;
try {
  body = JSON.parse(captured.body);
} catch {
  body = captured.body;
}

const secrets = [username, user, pcc].filter((value) => value.length >= 3);
function redact(value) {
  if (typeof value === 'string') {
    return secrets.reduce((text, secret) => text.split(secret).join('XXXX'), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    const copy = Object.fromEntries(Object.entries(value).map(([key, v]) => [key, redact(v)]));
    if (copy.code === 'TRANSACTIONID' && typeof copy.text === 'string') copy.text = '0';
    return copy;
  }
  return value;
}

const fixture = redact({
  recordedAt: new Date().toISOString().slice(0, 10),
  environment: 'sandbox',
  outcome,
  request,
  response: { status: captured.status, body },
});

const file = new URL(`../test/fixtures/bargain-finder-max.sandbox-${mode}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`fixture guardada en ${file.pathname}`);
