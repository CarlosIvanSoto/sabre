#!/usr/bin/env node
// Graba la fixture de Get Seats `byPnrLocator` contra sandbox (cert), con un PNR del PCC de la
// auth (#127): BFM → Revalidate → Get Seats por payload → Create con asiento (sin targetPcc) →
// Get → Get Seats byPnrLocator → Cancel → Get.
// Lo corre el usuario; nunca la CI. Necesita `npm run build` antes. Crea un PNR real en cert.
//
//   node --env-file=.env scripts/record-get-seats-pnr.mjs
//   SABRE_SEAT=21A node --env-file=.env scripts/record-get-seats-pnr.mjs
//
// El PNR tiene que vivir en el PCC de la auth: el request de byPnrLocator no tiene targetPcc y,
// con un PNR de otro PCC, Sabre responde 502 "Viewership is restricted for the PNR" (700102).
// Por eso SABRE_TARGET_PCC no se acepta aquí. El PCC de la auth necesita el TJR "Store Passenger
// Type In PNR" (ver configuracion-de-agencia en el wiki).
//
// Variables: las mismas que scripts/record-bfm.mjs. Opcionales: SABRE_AUTH_VERSION (v3 por
// defecto), SABRE_BOOKING_ORIGIN / SABRE_BOOKING_DESTINATION (DFW–LAX, solo ida, sin escalas),
// SABRE_AGENCY_CUSTOMER_NUMBER (número DK) y SABRE_SEAT (asiento del primer vuelo; sin él, el
// último libre sin cargo del mapa por payload). En CERT, byReservationPayload no refleja la
// ocupación (wiki/entities/get-seats.md), así que el asiento elegido puede estar tomado.
//
// El localizador se escribe en .sabre-sandbox-pnr.json antes de seguir; Cancel va en un finally
// y, si el PNR queda sin vuelos, el archivo se borra. Antes de guardar se redactan los PCC, el
// usuario EPR, el número DK y los datos de persona o contacto (el pasajero ya es sintético).
import { rmSync, writeFileSync } from 'node:fs';
import {
  buildBookingFlightDetails,
  buildRevalidateItineraryRequest,
  buildSeatAvailabilityRequest,
  Sabre,
  SabreBusinessError,
  SabreError,
} from '../dist/index.js';
import { futureTicketing } from '../examples/booking-lifecycle.mjs';
import { fileTokenStore } from './file-token-store.mjs';

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`falta la variable de entorno ${name}`);
    process.exit(2);
  }
  return value;
};

if (process.env.SABRE_TARGET_PCC) {
  console.error('SABRE_TARGET_PCC no aplica: byPnrLocator solo lee PNR del PCC de la auth');
  process.exit(2);
}
const seatOverride = process.env.SABRE_SEAT || undefined;
if (seatOverride !== undefined && !/^[0-9]+[A-Z]$/.test(seatOverride)) {
  console.error(`SABRE_SEAT debe ser como 21A (recibido: ${seatOverride})`);
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
const agencyCustomerNumber = process.env.SABRE_AGENCY_CUSTOMER_NUMBER || undefined;

const day = (offset) => `${new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)}T10:00:00`;
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

// Bodies crudos, en orden de llamada.
const SERVICES = [
  ['/v5/shop/flights/revalidate', 'revalidate'],
  ['/v3/offers/getseats/byReservationPayload', 'seatsPayload'],
  ['/v3/offers/getseats/byPnrLocator', 'seatsPnr'],
  ['/v1/trip/orders/createBooking', 'create'],
  ['/v1/trip/orders/getBooking', 'get'],
  ['/v1/trip/orders/cancelBooking', 'cancel'],
];
const captured = Object.fromEntries(SERVICES.map(([, key]) => [key, []]));
const recordingFetch = async (input, init) => {
  const response = await fetch(input, init);
  const key = SERVICES.find(([path]) => String(input).includes(path))?.[1];
  if (key !== undefined) captured[key].push({ status: response.status, body: await response.clone().text() });
  return response;
};

const sabre = new Sabre({
  environment: 'sandbox',
  authVersion,
  credentials,
  fetch: recordingFetch,
  retry: { maxRetries: 0 },
  tokenStore: fileTokenStore,
});

const list = (items) => items.map((item) => item.code).join(', ') || '-';
const describe = (error) => {
  const warnings = error instanceof SabreBusinessError ? error.warnings.map((w) => w.code).join(', ') : '-';
  return `${error.name}: ${error.message} (code ${error.code ?? '-'}, status ${error.status ?? '-'}, warnings ${warnings || '-'})`;
};

console.log(`sandbox · ${origin}→${destination} · todo en el PCC de la auth`);
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
const flight = itinerary.legs[0].schedules[0];
console.log(`revalidado: ${flight.carrier.marketing}${flight.carrier.marketingFlightNumber} ${flight.departure.airport}→${flight.arrival.airport}`);

const payloadRequest = buildSeatAvailabilityRequest({ group, itinerary });
const seatMap = await sabre.air.getSeats(payloadRequest);
const freeSeats = seatMap.response.seatMaps
  .filter((map) => map.segmentRef === 'S1')
  .flatMap((map) => map.cabinCompartments ?? [])
  .flatMap((cabin) => cabin.seatRows ?? [])
  .flatMap((row) => row.seats.map((s) => ({ number: `${row.row}${s.column}`, ...s })))
  .filter((s) => s.occupationStatusCode === 'F' && (s.offerItemRefIds ?? []).length === 0);
const seat = seatOverride ?? freeSeats.at(-1)?.number;
if (seat === undefined) {
  console.error('el mapa por payload no tiene asientos libres sin cargo en S1; pasa SABRE_SEAT');
  process.exit(1);
}
console.log(`asiento: ${seat}${seatOverride === undefined ? ` (último libre sin cargo de ${freeSeats.length})` : ' (SABRE_SEAT)'}`);

const createRequest = {
  flightDetails: buildBookingFlightDetails({
    group,
    itinerary,
    seats: [{ segmentIndex: 1, travelerIndex: 1, number: seat }],
    seatAvailability: seatMap,
  }),
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
    ...futureTicketing({ ticketingPcc: pcc, now: new Date() }),
    ...(agencyCustomerNumber === undefined ? {} : { agencyCustomerNumber }),
  },
};

const outcome = {};
let confirmationId;
try {
  const booking = await sabre.booking.create(createRequest);
  confirmationId = booking.confirmationId;
  outcome.create = `ok: confirmationId ${confirmationId}; warnings ${list(booking.warnings)}; errors ${list(booking.errors)}`;
} catch (error) {
  if (!(error instanceof SabreError)) throw error;
  outcome.create = describe(error);
}
console.log(`create: ${outcome.create}`);
if (captured.create[0]?.body.includes('UNABLE_TO_ADD_TRAVELER_PASSENGER_TYPE_NOT_ENABLED')) {
  console.log('TJR: "Store Passenger Type In PNR" NO está activo en el PCC de la auth');
}

const PNR_FILE = new URL('../.sabre-sandbox-pnr.json', import.meta.url);
const getRequest = { confirmationId };
const pnrRequest = { pnrLocator: confirmationId };
const cancelRequest = { confirmationId, cancelAll: true };
const finalRequest = { confirmationId, returnOnly: ['FLIGHTS'] };
if (confirmationId !== undefined) {
  writeFileSync(PNR_FILE, `${JSON.stringify({ environment: 'sandbox', confirmationId }, null, 2)}\n`, { mode: 0o600 });
  try {
    try {
      const booking = await sabre.booking.get(getRequest);
      const seats = (booking.flights ?? []).map((f) => `${f.airlineCode}${f.flightNumber} ${JSON.stringify(f.seats ?? [])}`);
      outcome.get = `seats ${seats.join(' / ') || '-'}`;
    } catch (error) {
      if (!(error instanceof SabreError)) throw error;
      outcome.get = describe(error);
    }
    console.log(`get: ${outcome.get}`);

    try {
      const pnrSeats = await sabre.air.getSeats(pnrRequest);
      const booked = pnrSeats.response.seatMaps
        .flatMap((map) => map.cabinCompartments ?? [])
        .flatMap((cabin) => cabin.seatRows ?? [])
        .flatMap((row) => row.seats.map((s) => ({ number: `${row.row}${s.column}`, ...s })))
        .find((s) => s.number === seat);
      outcome.seatsPnr =
        `ok: mapas ${pnrSeats.response.seatMaps.length}; asiento ${seat} ${booked === undefined ? 'no está en el mapa' : `occupationStatusCode ${booked.occupationStatusCode}`}` +
        `; warnings ${list(pnrSeats.warnings)}; errors ${list(pnrSeats.errors)}`;
    } catch (error) {
      if (!(error instanceof SabreError)) throw error;
      outcome.seatsPnr = describe(error);
    }
    console.log(`byPnrLocator: ${outcome.seatsPnr}`);
  } finally {
    const cancelled = await sabre.booking.cancel(cancelRequest);
    outcome.cancel = `ok; warnings ${list(cancelled.warnings)}`;
    console.log(`cancel: ${outcome.cancel}`);
    const after = await sabre.booking.get(finalRequest);
    outcome.final = `flights ${(after.flights ?? []).length}`;
    console.log(`get final: ${outcome.final}`);
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
  ['bookingsignature', 'XXXX'],
]);
const secrets = [username, user, pcc, agencyCustomerNumber].filter((value) => value !== undefined && value.length >= 3);

function redact(value, key = '', inPhones = false) {
  const lower = key.toLowerCase();
  if (typeof value === 'string') {
    if (PERSONAL.has(lower)) return PERSONAL.get(lower);
    if (lower === 'number' && inPhones) return '5550000000';
    return secrets.reduce((text, secret) => text.split(secret).join('XXXX'), value);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, key, inPhones));
  if (value !== null && typeof value === 'object') {
    const phones = inPhones || lower === 'phones' || lower === 'phone';
    const copy = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, phones)]));
    if (copy.code === 'TRANSACTIONID' && typeof copy.text === 'string') copy.text = '0';
    return copy;
  }
  return value;
}

const exchange = (entry) => (entry === undefined ? undefined : { status: entry.status, body: parse(entry.body) });
const [verify, final] = captured.get;
const fixture = redact({
  recordedAt: new Date().toISOString().slice(0, 10),
  environment: 'sandbox',
  seat,
  outcome,
  revalidate: { request: revalidateRequest, response: exchange(captured.revalidate.at(-1)) },
  seatsPayload: { request: payloadRequest, response: exchange(captured.seatsPayload[0]) },
  create: { request: createRequest, response: exchange(captured.create[0]) },
  get: verify === undefined ? undefined : { request: getRequest, response: exchange(verify) },
  seatsPnr: captured.seatsPnr[0] === undefined ? undefined : { request: pnrRequest, response: exchange(captured.seatsPnr[0]) },
  cancel: captured.cancel[0] === undefined ? undefined : { request: cancelRequest, response: exchange(captured.cancel[0]) },
  after: final === undefined ? undefined : { request: finalRequest, response: exchange(final) },
});

const file = new URL('../test/fixtures/get-seats.sandbox-pnr-locator.json', import.meta.url);
writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`fixture guardada en ${file.pathname} (revisa que no quede PII antes de commitear)`);
