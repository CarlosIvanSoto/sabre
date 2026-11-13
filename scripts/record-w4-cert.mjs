#!/usr/bin/env node
// W4 en CERT (#231, F1.1 de plan-flujos-f1-w4): reserva, emite con Fulfill Flight Tickets, verifica,
// anula por Cancel Booking con VOID y verifica otra vez. Graba cada paso como fixture y responde lo
// que ADR-031 dejó como supuesto. **Emite un boleto real en CERT.** Nunca producción: el entorno
// está fijo en `sandbox` y no se puede cambiar. Lo corre el usuario, o el agente con su
// confirmación en cada corrida; nunca la CI. Necesita `npm run build` antes.
//
//   SABRE_W4_CONFIRM=emitir-y-anular-en-cert node --env-file=.env scripts/record-w4-cert.mjs
//
// Variables: las de scripts/record-booking.mjs (credenciales, SABRE_TARGET_PCC,
// SABRE_AGENCY_CUSTOMER_NUMBER, SABRE_BOOKING_ORIGIN/DESTINATION), más SABRE_TICKET_COUNTRY
// (`designatePrinters[].ticket.countryCode`; US por defecto), SABRE_W4_CONFIRM, que tiene que
// valer exactamente `emitir-y-anular-en-cert`, SABRE_W4_ISSUER=enhanced (plan B: emite con
// Enhanced Air Ticket REST 1.3.0 en vez de Fulfill), SABRE_W4_Q114=1 (corre el paso 10),
// SABRE_W4_COMMISSION_PERCENT (`ticketingQualifiers.commissionPercentage`), SABRE_W4_REPEAT=1
// (segundo Fulfill), SABRE_W4_LABEL (prefijo de las fixtures) y SABRE_W4_PRINTER_PROFILE
// (`designatePrinters: [{ profileNumber }]`, en lugar de `ticket.countryCode`) y
// SABRE_W4_SECURE_FLIGHT=1 (birthDate y SECURE_FLIGHT_PASSENGER_DATA sintéticos en el traveler) y
// SABRE_W4_VOID=cancel (anula por Cancel Booking con VOID, el camino de W4).
//
// Corridas del 2026-11-12: Fulfill con US y con MX, y Enhanced Air Ticket con MX, fallan en
// DesignatePrinterLLSRQ (`INVALID TICKET STOCK-0001`/`-0096`, «No printer designated»): el PCC de
// CERT no tiene impresora ni stock de boleto electrónico. No se emitió nada. En el PCC IATA de
// CERT emitió con perfil 01, comisión 0.00 %, DK sintético y Secure Flight, y el void anuló.
//
// Recorrido:
//  1. BFM + Revalidate, como record-booking.
//  2. Create Booking con `ticketingPolicy: TODAY` (W4) y `isMarriageGroup: false` en cada vuelo.
//     El localizador va a .sabre-sandbox-pnr.json; si ese archivo ya existe, el script no corre.
//  3. Get Booking antes de emitir (`knownTickets`).
//  4. Fulfill por `fetch` directo (el SDK todavía no lo tiene): CASH, `designatePrinters` con
//     `ticket.countryCode`, `acceptPriceChanges: false`, `priceQuoteExpirationMethod: Quit`.
//     **Sin reintento**: con una respuesta dudosa, el script solo lee la reserva.
//  5. Get Booking hasta que aparezcan los boletos (0, 2, 5, 10, 20 y 40 s): cuánto tarda.
//  6. Si el paso 4 emitió y el 5 los ve: un segundo Fulfill sobre la misma reserva, para ver la
//     forma de BOOKING_FULFILLED. Si emitiera de nuevo, el paso 7 anula también ese boleto.
//  7. Cancel Booking `cancelAll` + `flightTicketOperation: VOID` + `retrieveBooking` (SDK). Corre
//     siempre que haya PNR, aunque algo anterior falle.
//  8. Get Booking: el estado de los boletos anulados.
//  9. Otro Cancel con VOID sobre la reserva ya vacía: el error de un void repetido.
// 10. Q-114: otra reserva con `marriageGroup: false` (el nombre de la colección Bruno), sin
//     emitir, y Cancel. Se comparan los ecos de `request` de los dos Create.
//
// Fixtures en test/fixtures/w4.sandbox-*.json. Pasajero sintético (TEST/PASSENGER). Se redactan
// PCC, usuario EPR, número DK, datos de contacto y nombres; los números de boleto pasan a
// `<aerolínea>` + consecutivo. El localizador de CERT se deja, como en las demás fixtures de
// sandbox. El resumen que imprime trae solo códigos, tiempos y conteos.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { buildBookingFlightDetails, buildRevalidateItineraryRequest, Sabre, SabreBusinessError, SabreError } from '../dist/index.js';
import { fileTokenStore } from './file-token-store.mjs';
import { envCredentials } from './lib/env-credentials.mjs';

if (process.env.SABRE_W4_CONFIRM !== 'emitir-y-anular-en-cert') {
  console.error('este script emite un boleto en CERT: pon SABRE_W4_CONFIRM=emitir-y-anular-en-cert para correrlo');
  process.exit(2);
}
const ENVIRONMENT = 'sandbox';
const PNR_FILE = new URL('../.sabre-sandbox-pnr.json', import.meta.url);
if (existsSync(PNR_FILE)) {
  console.error(`hay un PNR pendiente en ${PNR_FILE.pathname}: cancélalo antes de volver a correr`);
  process.exit(2);
}

const { credentials, user, pcc } = envCredentials();
const bookingPcc = process.env.SABRE_TARGET_PCC || pcc;
if (!/^[A-Z0-9]{3,4}$/.test(bookingPcc)) {
  console.error('SABRE_TARGET_PCC debe tener 3 o 4 letras mayúsculas o dígitos');
  process.exit(2);
}
const targetPcc = bookingPcc === pcc ? undefined : bookingPcc;
const context = targetPcc === undefined ? {} : { targetPcc };
const agencyCustomerNumber = process.env.SABRE_AGENCY_CUSTOMER_NUMBER || undefined;
const ticketCountry = process.env.SABRE_TICKET_COUNTRY ?? 'US';
// SABRE_W4_PRINTER_PROFILE: número de perfil de impresoras (PP*) del PCC de emisión, 1 a 99.
const printerProfile = process.env.SABRE_W4_PRINTER_PROFILE === undefined ? undefined : Number(process.env.SABRE_W4_PRINTER_PROFILE);
if (printerProfile !== undefined && !(Number.isInteger(printerProfile) && printerProfile >= 1 && printerProfile <= 99)) {
  console.error('SABRE_W4_PRINTER_PROFILE debe ser un entero de 1 a 99');
  process.exit(2);
}
const origin = process.env.SABRE_BOOKING_ORIGIN ?? 'DFW';
const destination = process.env.SABRE_BOOKING_DESTINATION ?? 'LAX';

// --- captura: bodies crudos por servicio y el último Authorization que mandó el SDK ---
const SERVICES = [
  ['/v5/offers/shop', 'shop'],
  ['/v5/shop/flights/revalidate', 'revalidate'],
  ['/v1/trip/orders/createBooking', 'create'],
  ['/v1/trip/orders/getBooking', 'get'],
  ['/v1/trip/orders/cancelBooking', 'cancel'],
];
const captured = { shop: [], revalidate: [], create: [], get: [], cancel: [] };
let authorization;
const recordingFetch = async (input, init) => {
  const header = new Headers(init?.headers).get('Authorization');
  if (header?.startsWith('Bearer ')) authorization = header;
  const response = await fetch(input, init);
  const key = SERVICES.find(([path]) => String(input).includes(path))?.[1];
  if (key !== undefined) captured[key].push({ status: response.status, body: await response.clone().text() });
  return response;
};
const sabre = new Sabre({ environment: ENVIRONMENT, credentials, fetch: recordingFetch, retry: { maxRetries: 0 }, tokenStore: fileTokenStore });
const REST = 'https://api.cert.platform.sabre.com';

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
const codes = (body) => (Array.isArray(body?.errors) ? body.errors.map((e) => `${e.category ?? '?'}:${e.type ?? e.code ?? '?'}`) : []);
const describe = (error) =>
  error instanceof SabreError
    ? { name: error.name, code: error.code ?? null, status: error.status ?? null, warnings: error instanceof SabreBusinessError ? error.warnings.map((w) => w.code) : [], message: error.message }
    : { name: error?.name, message: String(error?.message ?? error) };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = { environment: ENVIRONMENT, steps: {} };
const step = (name, value) => {
  summary.steps[name] = value;
  console.log(`${name}: ${JSON.stringify(value)}`);
};
const exchanges = {};

// --- 1. BFM + Revalidate ---
const day = (offset) => `${new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)}T10:00:00`;
const search = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: { Source: [{ PseudoCityCode: bookingPcc, RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
    OriginDestinationInformation: [{ DepartureDateTime: day(30), OriginLocation: { LocationCode: origin }, DestinationLocation: { LocationCode: destination } }],
    TravelPreferences: { MaxStopsQuantity: 0 },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  },
};
const found = await sabre.air.bargainFinderMax(search);
const first = found.itineraryGroups.flatMap((group) => group.itineraries.map((itinerary) => ({ group, itinerary })))[0];
if (first === undefined) {
  console.error('BFM no devolvió itinerarios');
  process.exit(1);
}
const revalidated = await sabre.air.revalidateItinerary(buildRevalidateItineraryRequest({ search, ...first }));
const group = revalidated.itineraryGroups[0];
const itinerary = group?.itineraries[0];
if (itinerary === undefined) {
  console.error('Revalidate no devolvió el itinerario');
  process.exit(1);
}
step('1.itinerario', {
  segments: itinerary.legs.flatMap((leg) => leg.schedules.map((s) => `${s.carrier.marketing}${s.carrier.marketingFlightNumber} ${s.departure.airport}-${s.arrival.airport}`)),
  currency: itinerary.pricingInformation[0]?.fare.totalFare.currency,
});

const bookingRequest = (marriageField) => {
  const flightDetails = buildBookingFlightDetails({ group, itinerary });
  return {
    ...context,
    flightDetails: { ...flightDetails, flights: flightDetails.flights.map((flight) => ({ ...flight, [marriageField]: false })) },
    travelers: [
      {
        givenName: 'TEST',
        surname: 'PASSENGER',
        passengerCode: 'ADT',
        emails: ['test@example.com'],
        phones: [{ number: '5550000000', label: 'M' }],
        // Secure Flight (vuelos de EE. UU.): sin esto, AirTicketLLSRQ responde PASSENGER SECURITY DATA
        // REQUIRED-1829 (CERT, 2026-11-12). Datos sintéticos; el nombre coincide con el del traveler.
        ...(process.env.SABRE_W4_SECURE_FLIGHT === '1'
          ? {
              birthDate: '1980-01-01',
              identityDocuments: [{ documentType: 'SECURE_FLIGHT_PASSENGER_DATA', givenName: 'TEST', surname: 'PASSENGER', birthDate: '1980-01-01', gender: 'MALE' }],
            }
          : {}),
      },
    ],
    contactInfo: { emails: ['test@example.com'], phones: ['5550000000'] },
    agency: { ticketingPolicy: 'TODAY', ...(agencyCustomerNumber === undefined ? {} : { agencyCustomerNumber }) },
  };
};
const echoedMarriage = (index) => {
  const flights = parse(captured.create[index]?.body ?? '')?.request?.flightDetails?.flights ?? [];
  return flights.map((f) => ({ isMarriageGroup: f.isMarriageGroup ?? '(ausente)', marriageGroup: f.marriageGroup ?? '(ausente)' }));
};

// --- 2. Create ---
const createRequest = bookingRequest('isMarriageGroup');
let confirmationId;
try {
  const booking = await sabre.booking.create(createRequest);
  confirmationId = booking.confirmationId;
  step('2.create', { ok: true, warnings: booking.warnings.map((w) => w.code), errors: booking.errors.map((e) => e.code), echo: echoedMarriage(0) });
} catch (error) {
  step('2.create', { ok: false, error: describe(error) });
}
exchanges.create = { request: createRequest, response: captured.create[0] };
if (confirmationId === undefined) {
  save();
  process.exit(1);
}
writeFileSync(PNR_FILE, `${JSON.stringify({ environment: ENVIRONMENT, confirmationId, ...context, ticketed: 'quizá' }, null, 2)}\n`, { mode: 0o600 });

const ticketsOf = (booking) => (booking.flightTickets ?? []).map((t) => ({ number: t.number, ticketStatusCode: t.ticketStatusCode ?? null, ticketStatusName: t.ticketStatusName ?? null }));
const getRequest = { confirmationId, ...context };
let issuedNumbers = [];
let fulfillUncertain = false;
try {
  // --- 3. Get antes de emitir ---
  const before = await sabre.booking.get(getRequest);
  const knownTickets = ticketsOf(before).map((t) => t.number);
  step('3.get-antes', { isTicketed: before.isTicketed ?? null, tickets: knownTickets.length });
  exchanges.getBefore = { request: getRequest, response: captured.get.at(-1) };

  // --- 4. Fulfill, sin reintento ---
  // Plan B de #231: con SABRE_W4_ISSUER=enhanced emite con Enhanced Air Ticket REST 1.3.0 y el
  // payload de W4 (Bruno), para saber si el problema es Fulfill o el PCC.
  const enhanced = process.env.SABRE_W4_ISSUER === 'enhanced';
  const fulfill = async () => {
    const body = enhanced
      ? {
          AirTicketRQ: {
            DesignatePrinter: { Printers: { Ticket: { CountryCode: ticketCountry } } },
            Itinerary: { ID: confirmationId },
            Ticketing: [{ FOP_Qualifiers: { BasicFOP: { Type: 'CA' } } }],
            PostProcessing: { EndTransaction: { Source: { ReceivedFrom: 'SABRE CLIENT W4' } } },
          },
        }
      : {
          confirmationId,
          ...context,
          fulfillments: [
            {
              payment: { primaryFormOfPayment: 1 },
              // COMMISSION REQUIRED-0260 en el PCC IATA de CERT (2026-11-12) sin comisión.
              ...(process.env.SABRE_W4_COMMISSION_PERCENT ? { ticketingQualifiers: { commissionPercentage: process.env.SABRE_W4_COMMISSION_PERCENT } } : {}),
            },
          ],
          formsOfPayment: [{ type: 'CASH' }],
          // Spec v1.33: un perfil va solo, en un único PrinterAddress; no se mezcla con ticket/hardcopy.
          designatePrinters: printerProfile === undefined ? [{ ticket: { countryCode: ticketCountry } }] : [{ profileNumber: printerProfile }],
          acceptPriceChanges: false,
          priceQuoteExpirationMethod: 'Quit',
        };
    const startedAt = Date.now();
    try {
      const response = await fetch(`${REST}${enhanced ? '/v1.3.0/air/ticket' : '/v1/trip/orders/fulfillFlightTickets'}`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      const text = await response.text();
      return { request: body, response: { status: response.status, body: text }, ms: Date.now() - startedAt };
    } catch (error) {
      return { request: body, transportError: describe(error), ms: Date.now() - startedAt };
    }
  };
  const view = (result) => {
    const parsed = parse(result.response?.body ?? '');
    if (enhanced) {
      const rs = parsed?.AirTicketRS ?? {};
      const results = rs.ApplicationResults ?? {};
      const messages = ['Error', 'Warning'].flatMap((kind) =>
        (results[kind] ?? []).flatMap((e) => (e.SystemSpecificResults ?? []).flatMap((s) => (s.Message ?? []).map((m) => `${kind}: ${m.content ?? m.code ?? JSON.stringify(m)}`))),
      );
      const summaries = Array.isArray(rs.Summary) ? rs.Summary : [];
      return {
        parsed,
        out: { httpStatus: result.response?.status ?? null, ms: result.ms, transportError: result.transportError ?? null, status: results.status ?? null, documents: summaries.length, messages: messages.map((m) => m.replace(/\b\d{13}\b/g, '<boleto>')) },
        numbers: summaries.map((s) => s.DocumentNumber).filter(Boolean),
      };
    }
    const tickets = Array.isArray(parsed?.tickets) ? parsed.tickets : [];
    return {
      parsed,
      out: {
        httpStatus: result.response?.status ?? null,
        ms: result.ms,
        transportError: result.transportError ?? null,
        tickets: tickets.map((t) => ({ ticket: t.number ? `…${String(t.number).slice(-4)}` : null, ticketStatusCode: t.ticketStatusCode ?? null, ticketStatusName: t.ticketStatusName ?? null, isCommitted: t.isCommitted ?? null, fields: Object.keys(t).sort() })),
        responseFields: parsed && typeof parsed === 'object' ? Object.keys(parsed).sort() : null,
        errors: codes(parsed),
        errorDescriptions: Array.isArray(parsed?.errors) ? parsed.errors.map((e) => e.description ?? e.descriptionText ?? null) : [],
        requestEcho: parsed?.request
          ? { acceptPriceChanges: parsed.request.acceptPriceChanges, priceQuoteExpirationMethod: parsed.request.priceQuoteExpirationMethod, errorHandlingPolicy: parsed.request.errorHandlingPolicy ?? null }
          : null,
      },
      numbers: tickets.map((t) => t.number).filter(Boolean),
    };
  };
  const firstFulfill = await fulfill();
  const firstView = view(firstFulfill);
  issuedNumbers = firstView.numbers;
  fulfillUncertain = firstFulfill.response === undefined || firstFulfill.response.status >= 500 || (issuedNumbers.length === 0 && (firstView.out.errors ?? []).some((c) => /UNABLE_TO_RETRIEVE|NOT_CONFIRMED|TIMEOUT|DOWNLINE/.test(c)));
  step('4.fulfill', { ...firstView.out, uncertain: fulfillUncertain });
  exchanges.fulfill = firstFulfill;

  // --- 5. Get hasta ver los boletos ---
  const issuedAt = Date.now();
  const polls = [];
  let seen = [];
  for (const waitSeconds of [0, 2, 5, 10, 20, 40]) {
    const target = issuedAt + waitSeconds * 1000;
    if (Date.now() < target) await sleep(target - Date.now());
    const after = await sabre.booking.get(getRequest);
    seen = ticketsOf(after).filter((t) => !knownTickets.includes(t.number));
    polls.push({ afterSeconds: Math.round((Date.now() - issuedAt) / 1000), isTicketed: after.isTicketed ?? null, newTickets: seen.length, codes: seen.map((t) => t.ticketStatusCode) });
    const expected = issuedNumbers.length > 0 ? issuedNumbers.every((n) => seen.some((t) => t.number === n)) : seen.length > 0;
    if (expected) break;
  }
  if (seen.length > 0) issuedNumbers = [...new Set([...issuedNumbers, ...seen.map((t) => t.number)])];
  step('5.get-despues', { polls, sameAsFulfill: firstView.numbers.length > 0 && firstView.numbers.every((n) => seen.some((t) => t.number === n)) });
  exchanges.getAfter = { request: getRequest, response: captured.get.at(-1) };

  // --- 6. Segundo Fulfill: BOOKING_FULFILLED (solo con SABRE_W4_REPEAT=1: puede emitir otro boleto) ---
  if (process.env.SABRE_W4_REPEAT !== '1') {
    step('6.fulfill-repetido', { omitido: 'un solo intento de emisión (SABRE_W4_REPEAT no es 1)' });
  } else if (enhanced) {
    step('6.fulfill-repetido', { omitido: 'Enhanced Air Ticket no tiene BOOKING_FULFILLED: emitiría otro boleto' });
  } else if (firstView.numbers.length > 0 && seen.length > 0) {
    const second = await fulfill();
    const secondView = view(second);
    if (secondView.numbers.length > 0) issuedNumbers = [...new Set([...issuedNumbers, ...secondView.numbers])];
    step('6.fulfill-repetido', { ...secondView.out, emitioOtraVez: secondView.numbers.length > 0 });
    exchanges.fulfillAgain = second;
  } else {
    step('6.fulfill-repetido', { omitido: 'el primer Fulfill no dejó boletos visibles' });
  }
} catch (error) {
  step('error', describe(error));
} finally {
  const mask = (number) => `…${String(number).slice(-4)}`;
  // --- 7. Void, solo si hay boletos. Con SABRE_W4_VOID=cancel, por Cancel Booking (cancelAll +
  // flightTicketOperation VOID), el camino de W4 y del SDK; si falla no se reintenta: se lee la
  // reserva y, si el boleto sigue en TE, se anula con Void Flight Tickets. Sin SABRE_W4_VOID, directo
  // con Void Flight Tickets. Si el void falla, el script para sin cancelar: el PNR queda vivo (y en
  // .sabre-sandbox-pnr.json) para no perder el boleto sin anular ---
  const voidByTickets = async (numbers, name) => {
    // Sin confirmationId: con tickets da INVALID_FLAGS_COMBINATION y no anula nada (CERT, 2026-11-12).
    const body = { ...context, tickets: numbers, receivedFrom: 'SABRE CLIENT W4' };
    const startedAt = Date.now();
    let result;
    try {
      const response = await fetch(`${REST}/v1/trip/orders/voidFlightTickets`, {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      result = { request: body, response: { status: response.status, body: await response.text() }, ms: Date.now() - startedAt };
    } catch (error) {
      result = { request: body, transportError: describe(error), ms: Date.now() - startedAt };
    }
    const parsed = parse(result.response?.body ?? '');
    const voided = Array.isArray(parsed?.voidedTickets) ? parsed.voidedTickets : [];
    const ok = numbers.every((n) => voided.includes(n));
    step(name, {
      httpStatus: result.response?.status ?? null,
      ms: result.ms,
      transportError: result.transportError ?? null,
      voidedTickets: voided.map(mask),
      errors: codes(parsed),
      errorDescriptions: Array.isArray(parsed?.errors) ? parsed.errors.map((e) => String(e.description ?? e.descriptionText ?? '').replace(/\d{13}/g, mask)) : [],
      ok,
    });
    exchanges.voidTickets = result;
    return ok;
  };
  let voidOk = issuedNumbers.length === 0;
  if (issuedNumbers.length > 0 && process.env.SABRE_W4_VOID === 'cancel') {
    const cancelVoidRequest = { confirmationId, ...context, cancelAll: true, flightTicketOperation: 'VOID', retrieveBooking: true };
    const cancelIndex = captured.cancel.length;
    const startedAt = Date.now();
    try {
      const cancelled = await sabre.booking.cancel(cancelVoidRequest);
      const raw = parse(captured.cancel[cancelIndex]?.body ?? '');
      step('7.cancel-void', {
        ok: true,
        ms: Date.now() - startedAt,
        voidedTickets: (cancelled.voidedTickets ?? []).map(mask),
        voidedTicketsShape: Array.isArray(raw?.voidedTickets) ? raw.voidedTickets.map((v) => typeof v) : null,
        tickets: Array.isArray(raw?.tickets) ? raw.tickets.map((t) => ({ fields: Object.keys(t).sort(), ticketStatusCode: t.ticketStatusCode ?? null })) : null,
        responseFields: raw && typeof raw === 'object' ? Object.keys(raw).sort() : null,
        bookingFlightsAfter: Array.isArray(raw?.booking?.flights) ? raw.booking.flights.length : null,
        bookingTicketsAfter: Array.isArray(raw?.booking?.flightTickets) ? raw.booking.flightTickets.map((t) => t.ticketStatusCode ?? null) : null,
        warnings: cancelled.warnings.map((w) => w.code),
        echo: { errorHandlingPolicy: cancelled.request?.errorHandlingPolicy ?? null },
      });
    } catch (error) {
      step('7.cancel-void', { ok: false, ms: Date.now() - startedAt, error: describe(error), errors: codes(parse(captured.cancel[cancelIndex]?.body ?? '')) });
    }
    exchanges.cancelVoid = { request: cancelVoidRequest, response: captured.cancel[cancelIndex] };
    // Sin reintentar el Cancel: se lee la reserva y, si queda un boleto en TE, plan B por tickets.
    const check = await sabre.booking.get(getRequest);
    const stillLive = ticketsOf(check).filter((t) => issuedNumbers.includes(t.number) && t.ticketStatusCode === 'TE').map((t) => t.number);
    step('7.get-despues-del-cancel', { flights: (check.flights ?? []).length, isTicketed: check.isTicketed ?? null, tickets: ticketsOf(check).map((t) => ({ ticket: mask(t.number), code: t.ticketStatusCode, name: t.ticketStatusName })) });
    exchanges.getAfterCancelVoid = { request: getRequest, response: captured.get.at(-1) };
    voidOk = stillLive.length === 0 ? true : await voidByTickets(stillLive, '7.void-flight-tickets-plan-b');
  } else if (issuedNumbers.length > 0) {
    voidOk = await voidByTickets(issuedNumbers, '7.void-flight-tickets');
  } else {
    step('7.void', { omitido: 'no hubo boletos' });
  }

  // --- 8. Get: isTicketed y estado de los boletos después del void ---
  try {
    const after = await sabre.booking.get(getRequest);
    step('8.get-despues-del-void', {
      flights: (after.flights ?? []).length,
      isTicketed: after.isTicketed ?? null,
      tickets: ticketsOf(after).map((t) => ({ ticket: mask(t.number), code: t.ticketStatusCode, name: t.ticketStatusName })),
    });
    exchanges.getAfterVoid = { request: getRequest, response: captured.get.at(-1) };
  } catch (error) {
    step('8.get-despues-del-void', { error: describe(error) });
  }

  // --- 9. Cancel del PNR, sin VOID (ya se anuló, o no hubo boletos). No corre si el void falló ---
  if (!voidOk) {
    step('9.cancel', { omitido: 'el void falló: el PNR queda vivo para revisarlo, sin reintentar' });
  } else {
    const current = await sabre.booking.get(getRequest);
    if ((current.flights ?? []).length === 0) {
      step('9.cancel', { omitido: 'la reserva ya no tiene vuelos' });
    } else {
      const cancelRequest = { confirmationId, ...context, cancelAll: true, retrieveBooking: true };
      const cancelIndex = captured.cancel.length;
      try {
        const cancelled = await sabre.booking.cancel(cancelRequest);
        step('9.cancel', { ok: true, warnings: cancelled.warnings.map((w) => w.code) });
      } catch (error) {
        step('9.cancel', { ok: false, error: describe(error), errors: codes(parse(captured.cancel[cancelIndex]?.body ?? '')) });
      }
      exchanges.cancel = { request: cancelRequest, response: captured.cancel[cancelIndex] };
    }
    try {
      const final = await sabre.booking.get(getRequest);
      step('9.get-final', { flights: (final.flights ?? []).length, isTicketed: final.isTicketed ?? null, tickets: ticketsOf(final).map((t) => ({ code: t.ticketStatusCode, name: t.ticketStatusName })) });
      exchanges.getFinal = { request: getRequest, response: captured.get.at(-1) };
      if ((final.flights ?? []).length === 0) rmSync(PNR_FILE, { force: true });
      else console.error(`revisa el PNR a mano: ${PNR_FILE.pathname}`);
    } catch (error) {
      step('9.get-final', { error: describe(error) });
    }
  }
}

// --- 10. Q-114: marriageGroup, sin emitir (solo con SABRE_W4_Q114=1) ---
if (process.env.SABRE_W4_Q114 === '1') {
  const index = captured.create.length;
  const request = bookingRequest('marriageGroup');
  let otherId;
  try {
    const booking = await sabre.booking.create(request);
    otherId = booking.confirmationId;
    step('10.create-marriageGroup', { ok: true, warnings: booking.warnings.map((w) => w.code), errors: booking.errors.map((e) => e.code), echo: echoedMarriage(index), echoIsMarriageGroupRun: echoedMarriage(0) });
  } catch (error) {
    step('10.create-marriageGroup', { ok: false, error: describe(error), errors: codes(parse(captured.create[index]?.body ?? '')) });
  }
  exchanges.createMarriageGroup = { request, response: captured.create[index] };
  if (otherId !== undefined) {
    try {
      const cancelled = await sabre.booking.cancel({ confirmationId: otherId, ...context, cancelAll: true });
      step('10.cancel', { ok: true, warnings: cancelled.warnings.map((w) => w.code) });
    } catch (error) {
      step('10.cancel', { ok: false, error: describe(error), pendiente: 'cancelar a mano el segundo PNR' });
    }
  }
}

save();

// --- fixtures ---
function save() {
  const PERSONAL = new Map([
    ['givenname', 'TEST'],
    ['middlename', 'TEST'],
    ['surname', 'PASSENGER'],
    ['travelergivenname', 'TEST'],
    ['travelersurname', 'PASSENGER'],
    ['birthdate', '1980-01-01'],
    ['email', 'test@example.com'],
    ['emails', 'test@example.com'],
    ['phone', '5550000000'],
    ['phones', '5550000000'],
    ['documentnumber', 'X0000000'],
    ['street', 'TEST STREET'],
    ['postalcode', '00000'],
    ['bookingsignature', 'XXXX'],
    // Del PCC IATA: número de agencia y firma del agente.
    ['agencyiatanumber', '00000000'],
    ['creationusersine', 'AAA'],
  ]);
  const secrets = [credentials.username, user, pcc, bookingPcc, agencyCustomerNumber].filter((v) => v !== undefined && v.length >= 3).sort((a, b) => b.length - a.length);
  const ticketAliases = new Map();
  const ticketAlias = (number) => {
    if (!ticketAliases.has(number)) ticketAliases.set(number, `${number.slice(0, 3)}${String(ticketAliases.size + 1).padStart(10, '0')}`);
    return ticketAliases.get(number);
  };
  // El número de boleto aparece también pegado a otro texto (SSR TKNE `/<13 dígitos>C1`) y sin el
  // prefijo de la aerolínea en la línea contable (`DL$<10 dígitos>`): por eso no basta con \b.
  const redactText = (text) =>
    secrets
      .reduce((t, s) => t.split(s).join('XXXX'), text)
      .replace(/(?<!\d)\d{13}(?!\d)/g, ticketAlias)
      .replace(/\$(\d{10})(?!\d)/g, (_, digits) => `$${ticketAlias(`000${digits}`).slice(3)}`);
  const redact = (value, key = '', inPhones = false) => {
    const lower = key.toLowerCase();
    if (typeof value === 'string') {
      if (PERSONAL.has(lower)) return PERSONAL.get(lower);
      if (lower === 'number' && inPhones) return '5550000000';
      return redactText(value);
    }
    if (Array.isArray(value)) return value.map((item) => redact(item, key, inPhones));
    if (value !== null && typeof value === 'object') {
      const phones = inPhones || lower === 'phones' || lower === 'phone';
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, phones)]));
    }
    return value;
  };
  const recordedAt = new Date().toISOString().slice(0, 10);
  // Un intercambio es { request, response: { status, body: texto }, ms?, transportError? }: el body se parsea.
  const shape = (value) => {
    if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
    if ('response' in value || 'transportError' in value) {
      const { response, ...rest } = value;
      return { ...rest, response: response === undefined ? null : { status: response.status, body: parse(response.body) } };
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  };
  // SABRE_W4_LABEL separa las fixtures de una corrida (p. ej. `issued`): w4.sandbox-<label>-*.json.
  const label = process.env.SABRE_W4_LABEL ? `${process.env.SABRE_W4_LABEL}-` : '';
  const toSave = {
    [`w4.sandbox-${label}shop.json`]: captured.shop[0] && { search: { request: search, response: captured.shop[0] }, revalidate: { response: captured.revalidate.at(-1) } },
    [`w4.sandbox-${label}create.json`]: exchanges.create,
    [`w4.sandbox-${label}${process.env.SABRE_W4_ISSUER === 'enhanced' ? 'enhanced-air-ticket' : 'fulfill'}.json`]: exchanges.fulfill && { first: exchanges.fulfill, again: exchanges.fulfillAgain },
    [`w4.sandbox-${label}get-booking.json`]: exchanges.getBefore && { before: exchanges.getBefore, afterFulfill: exchanges.getAfter, afterVoid: exchanges.getAfterVoid, final: exchanges.getFinal },
    [`w4.sandbox-${label}void-flight-tickets.json`]: exchanges.voidTickets,
    [`w4.sandbox-${label}cancel-void.json`]: exchanges.cancelVoid && { cancelVoid: exchanges.cancelVoid, getAfter: exchanges.getAfterCancelVoid },
    [`w4.sandbox-${label}cancel.json`]: exchanges.cancel,
    'w4.sandbox-create-marriage-group.json': exchanges.createMarriageGroup,
  };
  const written = [];
  for (const [name, content] of Object.entries(toSave)) {
    if (content === undefined) continue;
    const text = `${JSON.stringify(redact({ recordedAt, environment: ENVIRONMENT, steps: summary.steps, ...shape(content) }), null, 2)}\n`;
    const leaks = secrets.filter((s) => text.includes(s));
    if (leaks.length > 0) {
      console.error(`${name}: quedó un secreto, no se escribe`);
      continue;
    }
    writeFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), text);
    written.push(name);
  }
  console.log(`fixtures: ${written.join(', ') || 'ninguna'}`);
  console.log(`localizador pendiente: ${existsSync(PNR_FILE) ? 'sí, revisa .sabre-sandbox-pnr.json' : 'no'}`);
}
