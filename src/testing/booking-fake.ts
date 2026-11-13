// La parte REST del fake de `sabre-client/testing` (F3.1, #242): token, Create, Get y Cancel
// Booking y Fulfill Flight Tickets, con los desenlaces de ADR-031. Lo usa `createQueueFake`: el
// mismo `fetch` atiende SOAP y REST, y comparte el reloj y el registro de llamadas.
import type { SabreUncertainOutcomeReason } from '../errors/index.js';

/** Un boleto sembrado o emitido por el fake. */
export interface QueueFakeTicket {
  number: string;
  /** `TE` vigente (por defecto) o `TV` anulado. */
  ticketStatusCode?: 'TE' | 'TV';
  /** `YYYY-MM-DD`; por defecto, el día de `now()`. */
  date?: string;
}

/** Una reserva sembrada para Get, Cancel y Fulfill sin pasar por Create. */
export interface QueueFakeBooking {
  /** Cuántos vuelos tiene; 1 por defecto. */
  flights?: number;
  tickets?: readonly QueueFakeTicket[];
}

/** Los rechazos de configuración del PCC vistos en CERT (2026-11-12), como `DOWNLINE_SERVICE_ERROR`. */
export type QueueFakeDownlineCause = 'INVALID_TICKET_STOCK' | 'COMMISSION_REQUIRED' | 'HARDCOPY_PRINTER' | 'SECURE_FLIGHT';

/**
 * El desenlace del siguiente `tickets.fulfill`. Sin forzar, emite un boleto `TE` por pasajero
 * (uno por reserva en el fake), o responde `BOOKING_FULFILLED` si la reserva ya tiene boletos
 * vigentes.
 */
export type QueueFakeFulfillOutcome =
  | 'issued'
  /** Emite y avisa `PARTIAL_FULFILLMENT`. */
  | 'partial'
  /**
   * Fuerza un incierto. `issued` dice si la reserva queda emitida de verdad, para probar la
   * verificación. Por defecto: sí con `UNABLE_TO_RETRIEVE_TICKETS`, `INTERNAL_SERVER_TIMEOUT`,
   * `NOT_COMMITTED` (el boleto existe pero no aparece en el PNR), `TRANSPORT`, `GATEWAY_5XX`,
   * `UNPARSEABLE` y `ABORTED`; no con `FULFILLMENT_NOT_CONFIRMED`, `DOWNLINE_SERVICE_ERROR` y
   * `PAYMENT_CARD_ISSUE`.
   */
  | { uncertain: Exclude<SabreUncertainOutcomeReason, 'END_TRANSACTION_PROBLEM'>; issued?: boolean }
  /** Un `DOWNLINE_SERVICE_ERROR` de CERT, con su texto real. No emite. */
  | { downline: QueueFakeDownlineCause }
  /** Un error del catálogo de Fulfill que no emite (p. ej. `PRICE_MISMATCH`). */
  | { error: string; description?: string };

/** El desenlace del siguiente `booking.cancel` con `VOID`. */
export type QueueFakeVoidOutcome =
  | 'voided'
  /** Fuerza un incierto. `voided` dice si el void se hizo de verdad; por defecto, sí. */
  | { uncertain: 'END_TRANSACTION_PROBLEM' | 'TRANSPORT' | 'GATEWAY_5XX' | 'UNPARSEABLE' | 'ABORTED'; voided?: boolean };

/** Desenlaces forzados, en orden: cada llamada consume el primero que quede. */
export interface QueueFakeTicketing {
  fulfill?: readonly QueueFakeFulfillOutcome[];
  void?: readonly QueueFakeVoidOutcome[];
}

/** Lo que la parte REST registra en `calls`. */
export type BookingFakeCommand = 'token' | 'createBooking' | 'getBooking' | 'cancelBooking' | 'fulfill';

interface Ticket {
  number: string;
  ticketStatusCode: 'TE' | 'TV';
  date: string;
  /** `false`: emitido pero sin guardar en el PNR (*ghost ticket*); Get Booking no lo muestra. */
  committed: boolean;
}

interface Booking {
  flights: number;
  tickets: Ticket[];
}

const LOCATOR = /^[A-Z0-9]{6}$/;
const FULFILL_REASONS = new Set<string>([
  'UNABLE_TO_RETRIEVE_TICKETS',
  'FULFILLMENT_NOT_CONFIRMED',
  'INTERNAL_SERVER_TIMEOUT',
  'DOWNLINE_SERVICE_ERROR',
  'PAYMENT_CARD_ISSUE',
  'NOT_COMMITTED',
  'TRANSPORT',
  'GATEWAY_5XX',
  'UNPARSEABLE',
  'ABORTED',
]);
const ISSUES_BY_DEFAULT = new Set(['UNABLE_TO_RETRIEVE_TICKETS', 'INTERNAL_SERVER_TIMEOUT', 'NOT_COMMITTED', 'TRANSPORT', 'GATEWAY_5XX', 'UNPARSEABLE', 'ABORTED']);
const VOID_REASONS = new Set<string>(['END_TRANSACTION_PROBLEM', 'TRANSPORT', 'GATEWAY_5XX', 'UNPARSEABLE', 'ABORTED']);
const DOWNLINE_TEXT: Readonly<Record<QueueFakeDownlineCause, string>> = {
  INVALID_TICKET_STOCK: 'The AirTicketRQ service returned an error: (DesignatePrinterLLSRQ: INVALID TICKET STOCK-0096).',
  COMMISSION_REQUIRED:
    'The AirTicketRQ service returned an error: (AirTicketLLS failed for /Ticketing[1] with Cause: AirTicketLLSRQ: COMMISSION REQUIRED-0260, TicketingDocumentServicesRQ: No new tickets have been issued).',
  HARDCOPY_PRINTER:
    'The AirTicketRQ service returned an error: (AirTicketLLS failed for /Ticketing[1] with Cause: AirTicketLLSRQ: ASSIGN HARDCOPY PRINTER FOR ETR DOCUMENTS-USE PTR/-0052, TicketingDocumentServicesRQ: No new tickets have been issued).',
  SECURE_FLIGHT:
    'The AirTicketRQ service returned an error: (AirTicketLLS failed for /Ticketing[1] with Cause: AirTicketLLSRQ: PASSENGER SECURITY DATA REQUIRED PLEASE UPDATE AND RETRY-1829, TicketingDocumentServicesRQ: No new tickets have been issued).',
};
const UNCERTAIN_TEXT: Readonly<Record<string, [category: string, description: string]>> = {
  UNABLE_TO_RETRIEVE_TICKETS: ['APPLICATION_ERROR', 'Tickets might have been issued successfully but application could not retrieve them. Verify booking details and/or audit trail reports (DQB).'],
  FULFILLMENT_NOT_CONFIRMED: ['WARNING', 'The fulfillment operation cannot be confirmed. No new tickets were found in the booking.'],
  INTERNAL_SERVER_TIMEOUT: ['APPLICATION_ERROR', 'The downline ticketing service exceeded its processing time and the request timed out. Please retry the fulfillment attempt.'],
  DOWNLINE_SERVICE_ERROR: ['APPLICATION_ERROR', 'The AirTicketRQ service returned an error: (AirTicketLLSRQ: UNABLE TO PROCESS).'],
  PAYMENT_CARD_ISSUE: ['APPLICATION_ERROR', 'At least one fulfillment operation was not processed correctly. The transaction was declined due to an invalid card number.'],
};

function fail(message: string): never {
  throw new TypeError(`sabre-client/testing: ${message}`);
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const appError = (type: string, description: string, category = 'APPLICATION_ERROR') => ({ category, type, description });

function toTicket(value: unknown, label: string, today: string): Ticket {
  if (typeof value !== 'object' || value === null) fail(`${label} debe ser un objeto`);
  const ticket = value as QueueFakeTicket;
  if (typeof ticket.number !== 'string' || !/^[0-9A-Z]{13}$/.test(ticket.number)) fail(`${label}.number debe ser un número de boleto de 13 caracteres`);
  if (ticket.ticketStatusCode !== undefined && ticket.ticketStatusCode !== 'TE' && ticket.ticketStatusCode !== 'TV') fail(`${label}.ticketStatusCode debe ser TE o TV`);
  return { number: ticket.number, ticketStatusCode: ticket.ticketStatusCode ?? 'TE', date: ticket.date ?? today, committed: true };
}

function validateFulfillOutcome(value: unknown, label: string): QueueFakeFulfillOutcome {
  if (value === 'issued' || value === 'partial') return value;
  if (typeof value !== 'object' || value === null) fail(`${label} debe ser 'issued', 'partial' o un objeto`);
  const outcome = value as Record<string, unknown>;
  if ('uncertain' in outcome) {
    if (!FULFILL_REASONS.has(String(outcome.uncertain))) fail(`${label}.uncertain no es una reason de tickets.fulfill`);
  } else if ('downline' in outcome) {
    if (!(String(outcome.downline) in DOWNLINE_TEXT)) fail(`${label}.downline debe ser ${Object.keys(DOWNLINE_TEXT).join(', ')}`);
  } else if (typeof outcome.error !== 'string' || outcome.error === '') {
    fail(`${label} debe tener uncertain, downline o error`);
  }
  return value as QueueFakeFulfillOutcome;
}

function validateVoidOutcome(value: unknown, label: string): QueueFakeVoidOutcome {
  if (value === 'voided') return value;
  if (typeof value !== 'object' || value === null || !VOID_REASONS.has(String((value as { uncertain?: unknown }).uncertain))) {
    fail(`${label} debe ser 'voided' o { uncertain: ${[...VOID_REASONS].join(' | ')} }`);
  }
  return value as QueueFakeVoidOutcome;
}

/** El despachador REST del fake. Devuelve `undefined` si la URL no es REST. */
export function createBookingHandler(
  options: { bookings?: Readonly<Record<string, QueueFakeBooking>>; ticketing?: QueueFakeTicketing },
  now: () => Date,
  record: (command: BookingFakeCommand, locator?: string) => void,
): (url: string, body: string) => Response | 'transport' | 'abort' | undefined {
  const today = () => now().toISOString().slice(0, 10);
  const bookings = new Map<string, Booking>();
  for (const [locator, seed] of Object.entries(options.bookings ?? {})) {
    if (!LOCATOR.test(locator)) fail(`bookings['${locator}']: la clave debe ser un localizador de 6 caracteres alfanuméricos en mayúscula`);
    if (typeof seed !== 'object' || seed === null) fail(`bookings['${locator}'] debe ser un objeto`);
    if (seed.flights !== undefined && (!Number.isInteger(seed.flights) || seed.flights < 0)) fail(`bookings['${locator}'].flights debe ser un entero >= 0`);
    if (seed.tickets !== undefined && !Array.isArray(seed.tickets)) fail(`bookings['${locator}'].tickets debe ser una lista`);
    bookings.set(locator, {
      flights: seed.flights ?? 1,
      tickets: (seed.tickets ?? []).map((ticket, index) => toTicket(ticket, `bookings['${locator}'].tickets[${index}]`, today())),
    });
  }
  const ticketing = options.ticketing ?? {};
  if (typeof ticketing !== 'object' || ticketing === null) fail('ticketing debe ser un objeto');
  if (ticketing.fulfill !== undefined && !Array.isArray(ticketing.fulfill)) fail('ticketing.fulfill debe ser una lista');
  if (ticketing.void !== undefined && !Array.isArray(ticketing.void)) fail('ticketing.void debe ser una lista');
  const fulfillQueue = (ticketing.fulfill ?? []).map((outcome, index) => validateFulfillOutcome(outcome, `ticketing.fulfill[${index}]`));
  const voidQueue = (ticketing.void ?? []).map((outcome, index) => validateVoidOutcome(outcome, `ticketing.void[${index}]`));

  let created = 0;
  let issuedCount = 0;
  const nextLocator = () => {
    let locator: string;
    do {
      created += 1;
      locator = `FAKE${String.fromCharCode(64 + Math.ceil(created / 26))}${String.fromCharCode(64 + (((created - 1) % 26) + 1))}`;
    } while (bookings.has(locator));
    return locator;
  };
  const nextTicket = (): Ticket => {
    issuedCount += 1;
    return { number: `999${String(issuedCount).padStart(10, '0')}`, ticketStatusCode: 'TE', date: today(), committed: true };
  };
  const ticketJson = (ticket: Ticket) => ({
    number: ticket.number,
    date: ticket.date,
    airlineCode: 'XX',
    travelerIndex: 1,
    flightCoupons: [],
    payment: { total: '100.00', currencyCode: 'USD' },
    ticketStatusName: ticket.ticketStatusCode === 'TE' ? 'Issued' : 'Voided',
    ticketStatusCode: ticket.ticketStatusCode,
  });
  const bookingJson = (locator: string, booking: Booking) => ({
    bookingId: locator,
    startDate: today(),
    isTicketed: booking.tickets.some((ticket) => ticket.committed),
    flights: Array.from({ length: booking.flights }, (_, index) => ({ itemId: String(index + 1), flightNumber: 100 + index, airlineCode: 'XX' })),
    travelers: [{ givenName: 'TEST', surname: 'PASSENGER' }],
    flightTickets: booking.tickets.filter((ticket) => ticket.committed).map(ticketJson),
  });
  const notFound = () => json(200, { errors: [appError('BOOKING_NOT_FOUND', 'Booking cannot be found.', 'RESOURCE_NOT_FOUND')] });
  const parse = (body: string): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(body);
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  const fulfill = (request: Record<string, unknown>): Response | 'transport' | 'abort' => {
    const locator = String(request.confirmationId ?? '');
    record('fulfill', locator);
    const booking = bookings.get(locator);
    if (booking === undefined) return notFound();
    const outcome = fulfillQueue.shift() ?? 'issued';
    const echo = { ...request };
    const issue = (committed = true): Ticket[] => {
      const ticket = { ...nextTicket(), committed };
      booking.tickets.push(ticket);
      return [ticket];
    };
    const ticketsOut = (tickets: Ticket[]) =>
      tickets.map((ticket) => ({ ...ticketJson(ticket), isCommitted: ticket.committed, travelerGivenName: 'TEST', travelerSurname: 'PASSENGER' }));

    if (typeof outcome === 'object' && 'error' in outcome) {
      return json(200, { request: echo, errors: [appError(outcome.error, outcome.description ?? `No new tickets have been issued (${outcome.error}).`)] });
    }
    if (typeof outcome === 'object' && 'downline' in outcome) {
      return json(200, { request: echo, errors: [appError('DOWNLINE_SERVICE_ERROR', DOWNLINE_TEXT[outcome.downline])] });
    }
    if (outcome === 'issued' || outcome === 'partial') {
      if (booking.tickets.some((ticket) => ticket.ticketStatusCode === 'TE')) {
        return json(200, { request: echo, errors: [appError('BOOKING_FULFILLED', 'The fulfillment operation cannot be processed. The booking is already fulfilled.')] });
      }
      const tickets = issue();
      return json(200, {
        timestamp: now().toISOString().slice(0, 19),
        tickets: ticketsOut(tickets),
        request: echo,
        ...(outcome === 'partial'
          ? { warnings: [appError('PARTIAL_FULFILLMENT', 'At least one fulfillment operation was not processed correctly. Ticket issuance was unsuccessful due to a missing form of identification (FOID).', 'WARNING')] }
          : {}),
      });
    }
    const { uncertain: reason } = outcome;
    const issues = outcome.issued ?? ISSUES_BY_DEFAULT.has(reason);
    const tickets = issues ? issue(reason !== 'NOT_COMMITTED') : [];
    switch (reason) {
      case 'TRANSPORT':
        return 'transport';
      case 'ABORTED':
        return 'abort';
      case 'GATEWAY_5XX':
        return json(503, { errorCode: 'ERR.2SG.PROVIDER.ERROR', message: 'sabre-client/testing: 503 forzado' });
      case 'UNPARSEABLE':
        return new Response('<html>sabre-client/testing: cuerpo ilegible forzado</html>', { status: 200 });
      case 'NOT_COMMITTED':
        return json(200, { timestamp: now().toISOString().slice(0, 19), tickets: ticketsOut(tickets), request: echo });
      default: {
        const [category, description] = UNCERTAIN_TEXT[reason]!;
        const item = appError(reason, description, category);
        return json(200, { request: echo, ...(tickets.length > 0 ? { tickets: ticketsOut(tickets) } : {}), ...(category === 'WARNING' ? { warnings: [item] } : { errors: [item] }) });
      }
    }
  };

  const cancel = (request: Record<string, unknown>): Response | 'transport' | 'abort' => {
    const locator = String(request.confirmationId ?? '');
    record('cancelBooking', locator);
    const booking = bookings.get(locator);
    if (booking === undefined) return notFound();
    const echo = { errorHandlingPolicy: 'HALT_ON_ERROR', ...request };
    const live = booking.tickets.filter((ticket) => ticket.ticketStatusCode === 'TE');
    if (request.flightTicketOperation === 'VOID') {
      if (live.length === 0) {
        return json(200, {
          request: echo,
          errors: [
            appError('NO_ITEMS_CANCELLED', 'Nothing was cancelled - cancellation was interrupted due to errors', 'WARNING'),
            appError('UNABLE_TO_VOID_TICKET', 'Unable to void ticket.', 'CANCELLATION_ERROR'),
          ],
        });
      }
      const outcome = voidQueue.shift() ?? 'voided';
      const voids = outcome === 'voided' || outcome.voided !== false;
      if (voids) {
        for (const ticket of live) ticket.ticketStatusCode = 'TV';
        if (request.cancelAll === true) booking.flights = 0;
      }
      const voidedTickets = voids ? live.map((ticket) => ticket.number) : [];
      if (outcome !== 'voided') {
        switch (outcome.uncertain) {
          case 'TRANSPORT':
            return 'transport';
          case 'ABORTED':
            return 'abort';
          case 'GATEWAY_5XX':
            return json(503, { errorCode: 'ERR.2SG.PROVIDER.ERROR', message: 'sabre-client/testing: 503 forzado' });
          case 'UNPARSEABLE':
            return new Response('<html>sabre-client/testing: cuerpo ilegible forzado</html>', { status: 200 });
          case 'END_TRANSACTION_PROBLEM':
            return json(200, { request: echo, voidedTickets, errors: [appError('END_TRANSACTION_PROBLEM', 'Confirmation is pending. Redisplay the booking', 'WARNING')] });
        }
      }
      return json(200, {
        timestamp: now().toISOString().slice(0, 19),
        request: echo,
        voidedTickets,
        ...(request.retrieveBooking === true ? { booking: bookingJson(locator, booking) } : {}),
      });
    }
    if (request.cancelAll === true) booking.flights = 0;
    return json(200, { timestamp: now().toISOString().slice(0, 19), request: echo, ...(request.retrieveBooking === true ? { booking: bookingJson(locator, booking) } : {}) });
  };

  return (url, body) => {
    const path = new URL(url, 'https://fake.invalid').pathname;
    if (path.endsWith('/auth/token')) {
      record('token');
      return json(200, { access_token: 'FAKE-TOKEN', token_type: 'bearer', expires_in: 604800 });
    }
    if (!path.startsWith('/v1/trip/orders/')) return undefined;
    const request = parse(body);
    switch (path.slice('/v1/trip/orders/'.length)) {
      case 'createBooking': {
        const locator = nextLocator();
        record('createBooking', locator);
        const flights = ((request.flightDetails as { flights?: unknown[] } | undefined)?.flights ?? []).length;
        bookings.set(locator, { flights: flights > 0 ? flights : 1, tickets: [] });
        return json(200, { timestamp: now().toISOString().slice(0, 19), confirmationId: locator, request });
      }
      case 'getBooking': {
        const locator = String(request.confirmationId ?? '');
        record('getBooking', locator);
        const booking = bookings.get(locator);
        return booking === undefined ? notFound() : json(200, bookingJson(locator, booking));
      }
      case 'cancelBooking':
        return cancel(request);
      case 'fulfillFlightTickets':
        return fulfill(request);
      default:
        return json(404, { errorCode: 'ERR.2SG.NOT_FOUND', message: `sabre-client/testing: ${path} no está simulado` });
    }
  };
}
