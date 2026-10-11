#!/usr/bin/env node
// Graba una fixture de Create Booking contra sandbox (cert): busca con BFM, revalida el primer
// itinerario y lo reserva por flightDetails (ATPCO) con un pasajero sintético.
// Lo corre el usuario; nunca la CI. Necesita `npm run build` antes. Crea un PNR real en cert.
//
//   node --env-file=.env scripts/record-booking.mjs
//
// Variables: las mismas que scripts/record-bfm.mjs. Opcionales: SABRE_AUTH_VERSION (v3 por
// defecto), SABRE_BOOKING_ORIGIN / SABRE_BOOKING_DESTINATION (DFW–LAX por defecto, solo ida).
//
// El pasajero ya es sintético (TEST/PASSENGER, test@example.com). Antes de guardar se redactan
// además el PCC, el usuario EPR y cualquier dato de contacto o de persona que devuelva Sabre
// (ver "Datos de pasajero en fixtures grabadas" en sabre-wiki/wiki/sdk/estrategia-de-testing.md).
import { writeFileSync } from 'node:fs';
import {
  buildBookingFlightDetails,
  buildRevalidateItineraryRequest,
  Sabre,
  SabreBusinessError,
  SabreError,
} from '../dist/index.js';

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

const origin = process.env.SABRE_BOOKING_ORIGIN ?? 'DFW';
const destination = process.env.SABRE_BOOKING_DESTINATION ?? 'LAX';

const search = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: { Source: [{ PseudoCityCode: pcc, RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
    OriginDestinationInformation: [
      { DepartureDateTime: day(30), OriginLocation: { LocationCode: origin }, DestinationLocation: { LocationCode: destination } },
    ],
    TravelPreferences: { MaxStopsQuantity: 0 },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  },
};

// Captura los bodies crudos (el SDK devuelve respuestas ya procesadas).
const captured = {};
const recordingFetch = async (input, init) => {
  const response = await fetch(input, init);
  const url = String(input);
  const key = url.includes('/v5/shop/flights/revalidate')
    ? 'revalidate'
    : url.includes('/v1/trip/orders/createBooking')
      ? 'booking'
      : undefined;
  if (key !== undefined) captured[key] = { status: response.status, body: await response.clone().text() };
  return response;
};

const sabre = new Sabre({ environment: 'sandbox', authVersion, credentials, fetch: recordingFetch, retry: { maxRetries: 0 } });

const found = await sabre.air.bargainFinderMax(search);
const first = found.itineraryGroups.flatMap((group) => group.itineraries.map((itinerary) => ({ group, itinerary })))[0];
if (first === undefined) {
  console.error('BFM no devolvió itinerarios');
  process.exit(1);
}
const revalidateRequest = buildRevalidateItineraryRequest({ search, ...first });
const revalidated = await sabre.air.revalidateItinerary(revalidateRequest);
const group = revalidated.itineraryGroups[0];
const itinerary = group?.itineraries[0];
if (itinerary === undefined) {
  console.error('Revalidate no devolvió el itinerario');
  process.exit(1);
}
const fare = itinerary.pricingInformation[0]?.fare.totalFare;
console.log(
  `revalidado: ${itinerary.legs
    .flatMap((leg) => leg.schedules.map((s) => `${s.carrier.marketing}${s.carrier.marketingFlightNumber} ${s.departure.airport}→${s.arrival.airport}`))
    .join(' / ')} · ${fare?.totalPrice} ${fare?.currency}`,
);

const request = {
  flightDetails: buildBookingFlightDetails({ group, itinerary }),
  travelers: [
    {
      givenName: 'TEST',
      surname: 'PASSENGER',
      passengerCode: 'ADT',
      emails: ['test@example.com'],
      phones: [{ number: '5550000000', label: 'M' }],
    },
  ],
  contactInfo: { emails: ['test@example.com'], phones: ['5550000000'] },
};

let outcome;
try {
  const booking = await sabre.booking.create(request);
  const list = (items) => items.map((item) => item.code).join(', ') || '-';
  outcome = `ok: confirmationId ${booking.confirmationId}; warnings ${list(booking.warnings)}; errors ${list(booking.errors)}`;
} catch (error) {
  if (!(error instanceof SabreError)) throw error;
  const warnings = error instanceof SabreBusinessError ? error.warnings.map((w) => w.code).join(', ') : '-';
  outcome = `${error.name}: ${error.message} (code ${error.code ?? '-'}, status ${error.status ?? '-'}, warnings ${warnings || '-'})`;
}
console.log(outcome);
if (captured.booking === undefined) {
  console.error('no se capturó la respuesta de Create Booking');
  process.exit(1);
}
console.log(`HTTP ${captured.booking.status} de createBooking`);
if (captured.booking.body.includes('UNABLE_TO_ADD_TRAVELER_PASSENGER_TYPE_NOT_ENABLED')) {
  console.log('TJR: "Store Passenger Type In PNR" NO está activo en este PCC');
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

// Claves con datos de persona o de contacto: su contenido se reemplaza por valores fijos.
const PERSONAL = new Map([
  ['givenname', 'TEST'],
  ['middlename', 'TEST'],
  ['surname', 'PASSENGER'],
  ['birthdate', '1980-01-01'],
  ['email', 'test@example.com'],
  ['emails', 'test@example.com'],
  ['phone', '5550000000'],
  ['phones', '5550000000'],
  ['faxes', '5550000000'],
  ['emergencyphones', '5550000000'],
  ['documentnumber', 'X0000000'],
  ['street', 'TEST STREET'],
  ['postalcode', '00000'],
]);
const secrets = [username, user, pcc].filter((value) => value.length >= 3);

function redact(value, key = '', inPhones = false) {
  const lower = key.toLowerCase();
  if (typeof value === 'string') {
    if (PERSONAL.has(lower)) return PERSONAL.get(lower);
    // `number` es dato personal solo dentro de phones[] (en flights[] es el número de vuelo).
    if (lower === 'number' && inPhones) return '5550000000';
    return secrets.reduce((text, secret) => text.split(secret).join('XXXX'), value);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, key, inPhones));
  if (value !== null && typeof value === 'object') {
    const phones = inPhones || lower === 'phones' || lower === 'phone';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, phones)]));
  }
  return value;
}

const fixture = redact({
  recordedAt: new Date().toISOString().slice(0, 10),
  environment: 'sandbox',
  outcome,
  revalidate: { request: revalidateRequest, response: { status: captured.revalidate.status, body: parse(captured.revalidate.body) } },
  request,
  response: { status: captured.booking.status, body: parse(captured.booking.body) },
});

const name = outcome.startsWith('ok:') ? 'ok' : 'error';
const file = new URL(`../test/fixtures/create-booking.sandbox-${name}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`fixture guardada en ${file.pathname} (revisa que no quede PII antes de commitear)`);
