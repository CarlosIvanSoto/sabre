#!/usr/bin/env node
// Graba fixtures de Booking Management contra sandbox (cert): busca con BFM, revalida el primer
// itinerario, lo reserva por flightDetails (ATPCO) con un pasajero sintético y, si hay
// localizador, corre Get → Cancel → Get para no dejar el PNR vivo (#34, #42).
// Lo corre el usuario; nunca la CI. Necesita `npm run build` antes. Crea un PNR real en cert.
//
//   node --env-file=.env scripts/record-booking.mjs
//   SABRE_TARGET_PCC=XXXX SABRE_AGENCY_CUSTOMER_NUMBER=0000000000 \
//     node --env-file=.env scripts/record-booking.mjs
//
// Variables: las mismas que scripts/record-bfm.mjs. Opcionales: SABRE_AUTH_VERSION (v3 por
// defecto), SABRE_BOOKING_ORIGIN / SABRE_BOOKING_DESTINATION (DFW–LAX por defecto, solo ida),
// SABRE_TARGET_PCC (PCC donde se busca y reserva; sin él, el de las credenciales) y
// SABRE_AGENCY_CUSTOMER_NUMBER (número DK). Ver configuracion-de-agencia en el wiki: el PCC de
// las credenciales puede no tener el TJR "Store Passenger Type In PNR".
//
// Create va con FUTURE_TICKETING (emisión mañana, en el PCC de reserva) y sin pago. El
// localizador se escribe en .sabre-sandbox-pnr.json antes de cancelar; si la corrida se corta,
// ahí queda para cancelarlo a mano. Al cancelar bien, el archivo se borra.
//
// Fixtures:
// - con localizador: create-booking.sandbox-ok.json, get-booking.sandbox-atpco.json y
//   cancel-booking.sandbox-ok.json (Cancel y el Get posterior);
// - sin localizador: create-booking.sandbox-error.json.
//
// El pasajero ya es sintético (TEST/PASSENGER, test@example.com). Antes de guardar se redactan
// además los PCC, el usuario EPR, el número DK y cualquier dato de contacto o de persona que
// devuelva Sabre (ver "Datos de pasajero en fixtures grabadas" en
// sabre-wiki/wiki/sdk/estrategia-de-testing.md).
import { rmSync, writeFileSync } from 'node:fs';
import {
  buildBookingFlightDetails,
  buildRevalidateItineraryRequest,
  Sabre,
  SabreBusinessError,
  SabreError,
} from '../dist/index.js';
import { futureTicketing } from '../examples/booking-lifecycle.mjs';
import { fileTokenStore } from './file-token-store.mjs';
import { envCredentials } from './lib/env-credentials.mjs';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`falta la variable de entorno ${name}`);
    process.exit(2);
  }
  return value;
};

const { credentials, user, pcc } = envCredentials();
const { username } = credentials;

const bookingPcc = process.env.SABRE_TARGET_PCC || pcc;
if (!/^[A-Z0-9]{3,4}$/.test(bookingPcc)) {
  console.error(`SABRE_TARGET_PCC debe tener 3 o 4 letras mayúsculas o dígitos (recibido: ${bookingPcc})`);
  process.exit(2);
}
const targetPcc = bookingPcc === pcc ? undefined : bookingPcc;
const context = targetPcc === undefined ? {} : { targetPcc };
const agencyCustomerNumber = process.env.SABRE_AGENCY_CUSTOMER_NUMBER || undefined;

const day = (offset) => {
  const date = new Date(Date.now() + offset * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T10:00:00`;
};

const origin = process.env.SABRE_BOOKING_ORIGIN ?? 'DFW';
const destination = process.env.SABRE_BOOKING_DESTINATION ?? 'LAX';

const search = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: { Source: [{ PseudoCityCode: bookingPcc, RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
    OriginDestinationInformation: [
      { DepartureDateTime: day(30), OriginLocation: { LocationCode: origin }, DestinationLocation: { LocationCode: destination } },
    ],
    TravelPreferences: { MaxStopsQuantity: 0 },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  },
};

// Captura los bodies crudos (el SDK devuelve respuestas ya procesadas), en orden de llamada.
const SERVICES = [
  ['/v5/shop/flights/revalidate', 'revalidate'],
  ['/v1/trip/orders/createBooking', 'create'],
  ['/v1/trip/orders/getBooking', 'get'],
  ['/v1/trip/orders/cancelBooking', 'cancel'],
];
const captured = { revalidate: [], create: [], get: [], cancel: [] };
const recordingFetch = async (input, init) => {
  const response = await fetch(input, init);
  const key = SERVICES.find(([path]) => String(input).includes(path))?.[1];
  if (key !== undefined) captured[key].push({ status: response.status, body: await response.clone().text() });
  return response;
};

const sabre = new Sabre({ environment: 'sandbox', credentials, fetch: recordingFetch, retry: { maxRetries: 0 }, tokenStore: fileTokenStore });

console.log(`PCC de auth XXXX · PCC de búsqueda y reserva ${targetPcc === undefined ? 'el mismo' : 'otro (targetPcc)'}`);
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
  ...context,
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
  agency: {
    ...futureTicketing({ ticketingPcc: bookingPcc, now: new Date() }),
    ...(agencyCustomerNumber === undefined ? {} : { agencyCustomerNumber }),
  },
};

const list = (items) => items.map((item) => item.code).join(', ') || '-';
const describe = (error) => {
  const warnings = error instanceof SabreBusinessError ? error.warnings.map((w) => w.code).join(', ') : '-';
  return `${error.name}: ${error.message} (code ${error.code ?? '-'}, status ${error.status ?? '-'}, warnings ${warnings || '-'})`;
};

let outcome;
let confirmationId;
try {
  const booking = await sabre.booking.create(request);
  confirmationId = booking.confirmationId;
  outcome = `ok: confirmationId ${confirmationId}; warnings ${list(booking.warnings)}; errors ${list(booking.errors)}`;
} catch (error) {
  if (!(error instanceof SabreError)) throw error;
  outcome = describe(error);
}
console.log(outcome);
if (captured.create.length === 0) {
  console.error('no se capturó la respuesta de Create Booking');
  process.exit(1);
}
console.log(`HTTP ${captured.create[0].status} de createBooking`);
if (captured.create[0].body.includes('UNABLE_TO_ADD_TRAVELER_PASSENGER_TYPE_NOT_ENABLED')) {
  console.log('TJR: "Store Passenger Type In PNR" NO está activo en el PCC de reserva');
}

// Get → Cancel → Get. Cancel va en un finally: el PNR no queda vivo aunque falle el Get.
const PNR_FILE = new URL('../.sabre-sandbox-pnr.json', import.meta.url);
const getRequest = { confirmationId, ...context };
const cancelRequest = { confirmationId, ...context, cancelAll: true };
const finalRequest = { confirmationId, ...context, returnOnly: ['FLIGHTS'] };
const lifecycle = {};
if (confirmationId !== undefined) {
  writeFileSync(PNR_FILE, `${JSON.stringify({ environment: 'sandbox', confirmationId, ...context }, null, 2)}\n`, { mode: 0o600 });
  try {
    const booking = await sabre.booking.get(getRequest);
    lifecycle.get = (booking.flights ?? []).map((f) => `${f.airlineCode}${f.flightNumber} ${f.flightStatusCode}`).join(' / ');
    console.log(`get: ${lifecycle.get}; passengerCodes ${(booking.travelers ?? []).map((t) => t.passengerCode).join(', ')}`);
  } catch (error) {
    if (!(error instanceof SabreError)) throw error;
    lifecycle.get = describe(error);
    console.log(`get falló: ${lifecycle.get}`);
  } finally {
    const cancelled = await sabre.booking.cancel(cancelRequest);
    lifecycle.cancel = `ok; warnings ${list(cancelled.warnings)}`;
    console.log(`cancel: ${lifecycle.cancel}`);
    const after = await sabre.booking.get(finalRequest);
    lifecycle.final = `flights ${(after.flights ?? []).length}`;
    console.log(`get final: ${lifecycle.final}`);
    if ((after.flights ?? []).length === 0) rmSync(PNR_FILE, { force: true });
    else console.error(`el PNR sigue con vuelos: revísalo (${PNR_FILE.pathname})`);
  }
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
  // Firma opaca de la reserva (la usa Modify Booking): no aporta al test y puede llevar datos.
  ['bookingsignature', 'XXXX'],
]);
const secrets = [username, user, pcc, bookingPcc, agencyCustomerNumber].filter(
  (value) => value !== undefined && value.length >= 3,
);

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

const recordedAt = new Date().toISOString().slice(0, 10);
const exchange = (entry) => ({ status: entry.status, body: parse(entry.body) });
const save = (name, content) => {
  const file = new URL(`../test/fixtures/${name}`, import.meta.url);
  writeFileSync(file, `${JSON.stringify(redact({ recordedAt, environment: 'sandbox', ...content }), null, 2)}\n`);
  console.log(`fixture guardada en ${file.pathname}`);
};

const revalidateEntry = captured.revalidate.at(-1);
save(`create-booking.sandbox-${confirmationId === undefined ? 'error' : 'ok'}.json`, {
  outcome,
  revalidate: { request: revalidateRequest, response: exchange(revalidateEntry) },
  request,
  response: exchange(captured.create[0]),
});
if (confirmationId !== undefined && captured.get.length > 0) {
  const [verify, final] = captured.get.length > 1 ? captured.get : [undefined, captured.get[0]];
  if (verify !== undefined) save('get-booking.sandbox-atpco.json', { outcome: lifecycle.get, request: getRequest, response: exchange(verify) });
  if (captured.cancel.length > 0) {
    save('cancel-booking.sandbox-ok.json', {
      outcome: `${lifecycle.cancel}; get final ${lifecycle.final}`,
      request: cancelRequest,
      response: exchange(captured.cancel[0]),
      after: { request: finalRequest, response: exchange(final) },
    });
  }
}
console.log('revisa que no quede PII antes de commitear');
