#!/usr/bin/env node
// Graba fixtures de Revalidate Itinerary v5 contra sandbox (cert): busca con BFM, elige un
// itinerario, arma el request con buildRevalidateItineraryRequest y lo revalida.
// Lo corre el usuario; nunca la CI. Necesita `npm run build` antes.
//
//   node --env-file=.env scripts/record-revalidate.mjs [direct|connection]
//
// Variables: las mismas que scripts/record-bfm.mjs. Opcionales: SABRE_AUTH_VERSION (v3 por
// defecto), SABRE_REVALIDATE_ORIGIN / SABRE_REVALIDATE_DESTINATION.
//
// `direct` revalida un ida y vuelta DFW–LAX sin escalas. `connection` busca solo ida con una
// escala (MEX–MAD por defecto) y prefiere un itinerario cuya conexión salga al día siguiente,
// para ver si BFM manda `departureDateAdjustment` en `legDescs[].schedules[]`.
//
// Antes de guardar se redacta: PCC, TRANSACTIONID y cualquier string con el usuario EPR.
import { writeFileSync } from 'node:fs';
import { buildRevalidateItineraryRequest, Sabre, SabreError } from '../dist/index.js';

const mode = process.argv[2] ?? 'direct';
if (mode !== 'direct' && mode !== 'connection') {
  console.error(`modo desconocido: ${mode} (usa direct o connection)`);
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

const day = (offset) => {
  const date = new Date(Date.now() + offset * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T10:00:00`;
};

const origin = process.env.SABRE_REVALIDATE_ORIGIN ?? (mode === 'direct' ? 'DFW' : 'MEX');
const destination = process.env.SABRE_REVALIDATE_DESTINATION ?? (mode === 'direct' ? 'LAX' : 'MAD');
const legs =
  mode === 'direct'
    ? [
        [origin, destination, day(30)],
        [destination, origin, day(37)],
      ]
    : [[origin, destination, day(30)]];

const search = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: { Source: [{ PseudoCityCode: pcc, RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
    OriginDestinationInformation: legs.map(([from, to, when]) => ({
      DepartureDateTime: when,
      OriginLocation: { LocationCode: from },
      DestinationLocation: { LocationCode: to },
    })),
    TravelPreferences: { MaxStopsQuantity: mode === 'direct' ? 0 : 1 },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  },
};

// Captura los bodies crudos (el SDK devuelve las respuestas ya desnormalizadas).
const captured = {};
const recordingFetch = async (input, init) => {
  const response = await fetch(input, init);
  const url = String(input);
  const key = url.includes('/v5/offers/shop') ? 'bfm' : url.includes('/v5/shop/flights/revalidate') ? 'revalidate' : undefined;
  if (key !== undefined) captured[key] = { status: response.status, body: await response.clone().text() };
  return response;
};

const sabre = new Sabre({ environment: 'sandbox', authVersion, credentials, fetch: recordingFetch, retry: { maxRetries: 0 } });

const result = await sabre.air.bargainFinderMax(search);
const candidates = result.itineraryGroups.flatMap((group) => group.itineraries.map((itinerary) => ({ group, itinerary })));
const connects = ({ itinerary }) => itinerary.legs.some((leg) => leg.schedules.length > 1);
const nextDay = ({ itinerary }) => itinerary.legs.some((leg) => leg.schedules.some((s) => s.departureDateAdjustment));
const overnight = ({ group, itinerary }) =>
  itinerary.legs.some((leg) =>
    leg.schedules.some((s, i) => i > 0 && s.departure.time.slice(0, 8) < leg.schedules[i - 1].departure.time.slice(0, 8)),
  );
const chosen =
  mode === 'direct'
    ? candidates[0]
    : (candidates.find(nextDay) ?? candidates.find(overnight) ?? candidates.find(connects) ?? candidates[0]);
if (chosen === undefined) {
  console.error('BFM no devolvió itinerarios');
  process.exit(1);
}

const bfmRaw = JSON.parse(captured.bfm.body);
const adjustments = JSON.stringify(bfmRaw).match(/"departureDateAdjustment":\s*-?\d+/g) ?? [];
console.log(`BFM: ${candidates.length} itinerarios; departureDateAdjustment en la respuesta cruda: ${adjustments.length}`);
console.log(
  `elegido: ${chosen.itinerary.legs
    .map((leg) => leg.schedules.map((s) => `${s.carrier.marketing}${s.carrier.marketingFlightNumber} ${s.departure.airport}${s.departure.time}→${s.arrival.airport}${s.arrival.time}${s.arrival.dateAdjustment ? `+${s.arrival.dateAdjustment}` : ''}${s.departureDateAdjustment ? ` (sale +${s.departureDateAdjustment})` : ''}`).join(' / '))
    .join(' | ')}`,
);

const request = buildRevalidateItineraryRequest({ search, ...chosen });

let outcome;
try {
  const revalidated = await sabre.air.revalidateItinerary(request);
  const itineraries = revalidated.itineraryGroups.flatMap((group) => group.itineraries);
  const before = chosen.itinerary.pricingInformation[0]?.fare.totalFare;
  const after = itineraries[0]?.pricingInformation[0]?.fare.totalFare;
  outcome = `ok: ${itineraries.length} itinerarios; precio BFM ${before?.totalPrice} ${before?.currency} → revalidado ${after?.totalPrice} ${after?.currency}`;
} catch (error) {
  if (!(error instanceof SabreError)) throw error;
  outcome = `${error.name}: ${error.message} (code ${error.code ?? '-'}, retryable ${error.retryable})`;
}
console.log(outcome);

if (captured.revalidate === undefined) {
  console.error('no se capturó la respuesta de Revalidate');
  process.exit(1);
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

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

// La búsqueda va completa (cruda) para que el test pueda rearmar el request desde ella.
const fixture = redact({
  recordedAt: new Date().toISOString().slice(0, 10),
  environment: 'sandbox',
  outcome,
  search: { request: search, response: { status: captured.bfm.status, body: bfmRaw } },
  request,
  response: { status: captured.revalidate.status, body: parse(captured.revalidate.body) },
});

const file = new URL(`../test/fixtures/revalidate-itinerary.sandbox-${mode}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`fixture guardada en ${file.pathname}`);
