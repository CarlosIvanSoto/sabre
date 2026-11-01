#!/usr/bin/env node
// Graba fixtures de Get Seats v3 por payload: busca con BFM, revalida el primer itinerario que
// Revalidate acepte, arma el request con buildSeatAvailabilityRequest y pide el mapa.
// Lo corre el usuario; nunca la CI. Necesita `npm run build` antes.
//
//   node --env-file=.env scripts/record-get-seats.mjs [direct|connection]
//   SABRE_ENVIRONMENT=production node --env-file=.env.production scripts/record-get-seats.mjs connection
//
// Todo es de solo lectura (BFM, Revalidate y Get Seats por payload), así que se permite en
// producción (decisión del 2026-10-31 en sabre-wiki/wiki/sdk/plan-tier-2.md). Cualquier URL de
// /v1/trip/orders/ corta la corrida antes de salir a la red.
//
// Variables: las mismas que scripts/record-bfm.mjs, más SABRE_ENVIRONMENT (sandbox por defecto),
// SABRE_AUTH_VERSION (v3 por defecto), SABRE_DEPARTURE_DAYS (75) y SABRE_GET_SEATS_ORIGIN /
// SABRE_GET_SEATS_DESTINATION y SABRE_REVALIDATE_ATTEMPTS (3). `direct` busca solo ida DFW–LAX sin escalas; `connection`, solo
// ida MEX–MAD con una escala.
//
// Antes de guardar se redacta: PCC, TRANSACTIONID y cualquier string con el usuario EPR. El
// request no lleva nombres: los pasajeros de Get Seats son P1…Pn con su tipo.
import { writeFileSync } from 'node:fs';
import { buildRevalidateItineraryRequest, buildSeatAvailabilityRequest, Sabre, SabreError } from '../dist/index.js';
import { fileTokenStore } from './file-token-store.mjs';

const mode = process.argv[2] ?? 'direct';
if (mode !== 'direct' && mode !== 'connection') {
  console.error(`modo desconocido: ${mode} (usa direct o connection)`);
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

const departureDays = Number(process.env.SABRE_DEPARTURE_DAYS ?? 75);
const departure = new Date(Date.now() + departureDays * 86_400_000).toISOString().slice(0, 10);
const origin = process.env.SABRE_GET_SEATS_ORIGIN ?? (mode === 'direct' ? 'DFW' : 'MEX');
const destination = process.env.SABRE_GET_SEATS_DESTINATION ?? (mode === 'direct' ? 'LAX' : 'MAD');

const search = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: { Source: [{ PseudoCityCode: pcc, RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
    OriginDestinationInformation: [
      {
        DepartureDateTime: `${departure}T10:00:00`,
        OriginLocation: { LocationCode: origin },
        DestinationLocation: { LocationCode: destination },
      },
    ],
    TravelPreferences: { MaxStopsQuantity: mode === 'direct' ? 0 : 1 },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  },
};

// Captura los bodies crudos del último Revalidate y de Get Seats.
const captured = {};
let tokenRequests = 0;
const recordingFetch = async (input, init) => {
  const url = String(input);
  if (url.includes('/v1/trip/orders/')) throw new Error(`llamada de escritura bloqueada: ${url}`);
  if (url.includes('/auth/token')) tokenRequests += 1;
  const response = await fetch(input, init);
  const key = url.includes('/v5/shop/flights/revalidate') ? 'revalidate' : url.includes('/getseats/') ? 'getSeats' : undefined;
  if (key !== undefined) captured[key] = { status: response.status, body: await response.clone().text() };
  return response;
};

const sabre = new Sabre({
  environment,
  authVersion,
  credentials,
  fetch: recordingFetch,
  retry: { maxRetries: 0 },
  tokenStore: fileTokenStore,
});

console.log(`entorno ${environment} · ${mode} ${origin}→${destination} · salida ${departure}`);
const found = await sabre.air.bargainFinderMax(search);
const candidates = found.itineraryGroups.flatMap((group) => group.itineraries.map((itinerary) => ({ group, itinerary })));
const preferred = mode === 'connection' ? candidates.filter(({ itinerary }) => itinerary.legs[0].schedules.length > 1) : candidates;

let revalidateRequest, revalidated;
const attempts = Number(process.env.SABRE_REVALIDATE_ATTEMPTS ?? 3);
const flightsOf = ({ itinerary }) =>
  itinerary.legs.flatMap((leg) => leg.schedules).map((s) => `${s.carrier.marketing}${s.carrier.marketingFlightNumber} ${s.departure.airport}→${s.arrival.airport}`).join(' / ');
for (const candidate of (preferred.length > 0 ? preferred : candidates).slice(0, attempts)) {
  revalidateRequest = buildRevalidateItineraryRequest({ search, ...candidate });
  try {
    revalidated = await sabre.air.revalidateItinerary(revalidateRequest);
    break;
  } catch (error) {
    if (!(error instanceof SabreError)) throw error;
    console.log(`Revalidate rechazó ${flightsOf(candidate)}: ${error.message}`);
  }
}
if (revalidated === undefined) {
  console.error('ningún itinerario pasó Revalidate');
  process.exit(1);
}
const revalidateResponse = { status: captured.revalidate.status, body: JSON.parse(captured.revalidate.body) };

const group = revalidated.itineraryGroups[0];
const itinerary = group.itineraries[0];
const request = buildSeatAvailabilityRequest({ group, itinerary });
console.log(
  `revalidado: ${request.segments.map((s) => `${s.bookingAirlineCode}${s.bookingFlightNumber} ${s.departureAirportCode}→${s.arrivalAirportCode} ${s.bookingClassCode}`).join(' / ')}`,
);

let outcome;
try {
  const seats = await sabre.air.getSeats(request);
  const maps = request.returnSeatMapsOnlyForSegmentRefs.map(
    (ref) => `${ref}:${seats.response.seatMaps.filter((m) => m.segmentRef === ref).length}`,
  );
  outcome =
    `ok: mapas por segmento ${maps.join(' ')}; offerItems ${seats.response.offerItems.length}` +
    `; warnings ${seats.warnings.map((w) => w.code).join(',') || '-'}; errors ${seats.errors.map((e) => e.code).join(',') || '-'}`;
} catch (error) {
  if (!(error instanceof SabreError)) throw error;
  outcome = `${error.name}: ${error.message} (code ${error.code ?? '-'}, status ${error.status ?? '-'}, retryable ${error.retryable})`;
}
console.log(outcome);
console.log(`peticiones de token: ${tokenRequests}`);

if (captured.getSeats === undefined) {
  console.error('no se capturó la respuesta de Get Seats');
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

// Sin la respuesta de BFM, que pesa mucho: el test rearma el itinerario desde Revalidate.
const fixture = redact({
  recordedAt: new Date().toISOString().slice(0, 10),
  environment,
  outcome,
  revalidate: { request: revalidateRequest, response: revalidateResponse },
  request,
  response: { status: captured.getSeats.status, body: parse(captured.getSeats.body) },
});

const file = new URL(`../test/fixtures/get-seats.${environment}-${mode}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`fixture guardada en ${file.pathname} (revisa que no quede PII antes de commitear)`);
