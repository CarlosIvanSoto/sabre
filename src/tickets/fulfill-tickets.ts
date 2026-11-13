// Fulfill Flight Tickets (`POST /v1/trip/orders/fulfillFlightTickets`), con los desenlaces de
// ADR-031 (sabre-wiki: wiki/proyectos/sabre-client/decisiones/reintentos-y-estados-inciertos-de-la-emision.md).
import {
  type SabreBusinessError,
  SabreError,
  SabreGatewayError,
  SabreUncertainOutcomeError,
  type SabreUncertainOutcomeReason,
  type SabreUncertainTicket,
  type SabreWarning,
} from '../errors/index.js';
import type { BookingTotalValues } from '../booking/booking-types.js';
import { type BookingResponseError, isObject, isWarning, nonEmpty, responseErrors, toBusinessError, toWarning } from '../booking/booking-errors.js';
import type { BookingSource } from '../booking/get-booking.js';
import { rawHooks, type SabreRawRequest, type SabreRawRequestCallback } from '../http/raw-request.js';
import type { SabreRawResponseCallback } from '../http/raw-response.js';
import type { RestTransport } from '../http/rest-transport.js';

export const FULFILL_TICKETS_SERVICE = 'fulfillFlightTickets';
export const FULFILL_TICKETS_OPERATION = 'tickets.fulfill';
const PATH = '/v1/trip/orders/fulfillFlightTickets';
/** El texto con el que Sabre dice que no emitió, en `INTERNAL_SERVER_TIMEOUT` y otros. */
const NO_NEW_TICKETS = /no new tickets have been issued/i;
const GATEWAY_5XX = new Set([500, 502, 503, 504]);

/** `PriceQuoteHandlingMethodEnum` del spec v1.33. */
export type PriceQuoteHandlingMethod = 'Reprice' | 'Override' | 'Quit';

/** `FulfillErrorPolicyEnum` del spec v1.33. Sabre usa `ALLOW_PARTIAL_FULFILLMENT` por defecto. */
export type FulfillErrorPolicy = 'ALLOW_PARTIAL_FULFILLMENT' | 'HALT_ON_INVALID_MINIMUM_CONNECTING_TIME_ERROR';

/** `FormOfPaymentTypeEnum` del spec v1.33 (Fulfill admite un subconjunto según el contenido). */
export type FulfillFormOfPaymentType =
  | 'PAYMENTCARD'
  | 'CASH'
  | 'CHECK'
  | 'MISCELLANEOUS'
  | 'INSTALLMENTS'
  | 'VIRTUAL_CARD'
  | 'AGENCY_NAME'
  | 'AGENCY_IATA'
  | 'CORPORATE'
  | 'COMPANY_NAME'
  | 'VOUCHER'
  | 'DOCKET'
  | 'GOVERNMENT_TRAVEL_REQUEST'
  | 'INVOICE';

/** `FulfillFormOfPayment` del spec v1.33. Los campos de tarjeta y cuotas se envían tal cual. */
export interface FulfillFormOfPayment {
  type: FulfillFormOfPaymentType;
  cardTypeCode?: string;
  cardNumber?: string;
  cardSecurityCode?: string;
  /** `YYYY-MM`. */
  expiryDate?: string;
  extendedPayment?: number;
  miscellaneousCreditCode?: string;
  numberOfInstallments?: number;
  airlinePlanCode?: string;
  installmentAmount?: string;
  manualApprovalCode?: string;
  virtualCardCode?: string;
  [field: string]: unknown;
}

/** `PaymentMethod` del spec: índices desde 1 sobre `formsOfPayment`. */
export interface FulfillPayment {
  primaryFormOfPayment: number;
  secondaryFormOfPayment?: number;
  /** Importe sobre la segunda forma de pago (`^[0-9]+(\.[0-9]{1,3})?$`). */
  amountOnSecondFormOfPayment?: string;
}

/**
 * `FulfillQualifiers` del spec. La comisión va en `commissionAmount` **o** `commissionPercentage`,
 * nunca los dos. Un PCC puede exigirla: sin ella, Sabre responde `COMMISSION REQUIRED`
 * (CERT, 2026-11-12).
 */
export interface FulfillTicketingQualifiers {
  commissionAmount?: string;
  commissionPercentage?: string;
  endorsements?: Record<string, unknown>;
  tourCode?: string;
  priceQuoteRecordIds?: number[];
  travelerIndices?: number[];
  [field: string]: unknown;
}

/** `FulfillmentDetails` del spec: una emisión (boletos y, con `ancillaryIds`, EMD). */
export interface FulfillmentDetails {
  payment?: FulfillPayment;
  ticketingQualifiers?: FulfillTicketingQualifiers;
  /** EMD: los `itemId` de los ancillaries de la reserva. */
  ancillaryIds?: string[];
  /** Solo Canadá. */
  serviceFee?: Record<string, unknown>;
  /** Solo NDC. */
  payer?: Record<string, unknown>;
}

/**
 * `PrinterAddress` del spec v1.33. **Un perfil va solo**, en un único elemento de
 * `designatePrinters`; si no, todos los elementos tienen que ser del mismo tipo de impresora.
 */
export interface FulfillPrinterAddress {
  /** Perfil de impresoras del PCC de emisión (`PP*`). */
  profileNumber?: number;
  /** Impresora de boletos: LNIATA (`address`) o código de stock (`countryCode`, p. ej. `MX`). */
  ticket?: { address?: string; countryCode?: string };
  hardcopy?: { address?: string; spacing?: string };
  invoiceItinerary?: string;
}

/** `FulfillTicketsRequest` del spec v1.33. */
export interface FulfillTicketsRequest {
  /** Localizador del PNR u Order ID (`^[A-Z0-9]{6,}$`). */
  confirmationId: string;
  /** 1 a 99 emisiones. */
  fulfillments: FulfillmentDetails[];
  /** 1 a 10. En ATPCO hace falta al menos una. */
  formsOfPayment?: FulfillFormOfPayment[];
  /** En ATPCO hace falta: ver `FulfillPrinterAddress`. */
  designatePrinters?: FulfillPrinterAddress[];
  /** PCC de emisión (cambio de contexto, `^[A-Z0-9]{3,4}$`). */
  targetPcc?: string;
  bookingSource?: BookingSource;
  errorHandlingPolicy?: FulfillErrorPolicy[];
  retainAccounting?: boolean;
  receivedFrom?: string;
  travelers?: Array<Record<string, unknown>>;
  agency?: Record<string, unknown>;
  generateSingleInvoice?: boolean;
  /** Espera (0 a 10000 ms) de la validación de *ghost ticket*. */
  commitTicketToBookingWaitTime?: number;
  acceptNegotiatedFare?: boolean;
  /**
   * **El SDK manda `false` por defecto** (Sabre usa `true`): una emisión automática nunca paga un
   * precio que nadie vio (ADR-019). Con `false` y un precio nuevo, Sabre responde `PRICE_MISMATCH`.
   */
  acceptPriceChanges?: boolean;
  backDatePriceQuoteMethod?: PriceQuoteHandlingMethod;
  /** **El SDK manda `'Quit'` por defecto** (Sabre usa `Reprice`), por lo mismo que `acceptPriceChanges`. */
  priceQuoteExpirationMethod?: PriceQuoteHandlingMethod;
  notificationEmail?: 'DEFAULT' | 'INVOICE' | 'ETICKET' | 'ETICKET_PDF' | 'ITINERARY' | 'ITINERARY_PDF';
  returnRequest?: boolean;
}

export interface FulfillTicketsOptions {
  /**
   * Abortar **después** de mandar el request no deshace la emisión: lanza
   * `SabreUncertainOutcomeError` con `reason: 'ABORTED'`. Antes de mandarlo, el `AbortError` se
   * propaga tal cual.
   */
  signal?: AbortSignal;
  /** Respuesta cruda del último intento HTTP. El body trae PII: ver `SabreRawResponse`. */
  onRawResponse?: SabreRawResponseCallback;
  /** Request crudo que se mandó, sin `Authorization`. Trae PII: ver `SabreRawRequest`. */
  onRawRequest?: SabreRawRequestCallback;
  /** No se acepta: la emisión nunca se reintenta. Solo `{ maxRetries: 0 }`, o nada. */
  retry?: { maxRetries?: number };
}

/** `FulfillTicket` del spec v1.33. */
export interface FulfilledTicket {
  /** Número del documento. Ej.: `0167489825830`. */
  number: string;
  /** `YYYY-MM-DD`. */
  date: string;
  travelerGivenName?: string;
  travelerSurname?: string;
  payment: BookingTotalValues;
  /** `Issued`, `Voided` o `Refunded/Exchanged`. */
  ticketStatusName?: string;
  /** `TE` (boleto ATPCO), `ME` (EMD), `TO` (NDC); `TV` anulado. */
  ticketStatusCode?: string;
  ticketingPcc?: string;
  /** Solo ATPCO: el número quedó guardado en el PNR. */
  isCommitted?: boolean;
}

/** Lo que devuelve Fulfill tal cual. */
export interface RawFulfillTicketsResponse {
  timestamp?: string;
  tickets?: FulfilledTicket[];
  request?: FulfillTicketsRequest;
  errors?: BookingResponseError[];
  warnings?: BookingResponseError[];
}

/**
 * Emisión con boletos reales. **`partial` no es una emisión completa**: hay boletos emitidos, que
 * hay que guardar, y otros que faltan (por ejemplo, `PARTIAL_FULFILLMENT` por un FOID o una
 * tarjeta). No se vuelve a emitir a ciegas: primero `sabre.tickets.verify`.
 */
export interface FulfillTicketsResponse {
  status: 'issued' | 'partial';
  confirmationId: string;
  tickets: FulfilledTicket[];
  /** `warnings[]` y los elementos `WARNING` de `errors[]`. */
  warnings: SabreWarning[];
  /** Errores que llegaron junto con boletos emitidos (solo en `partial`). */
  errors: SabreBusinessError[];
  /** El `timestamp` de Sabre, tal cual (sin zona). */
  timestamp?: string;
  /** Eco del request con los defaults de Sabre completados. */
  request?: FulfillTicketsRequest;
}

/** `TypeError` sin red ante una forma que Sabre rechazaría seguro, o ante `retry`. */
export function validateFulfillTicketsRequest(request: FulfillTicketsRequest, options: FulfillTicketsOptions): void {
  const fail = (message: string): never => {
    throw new TypeError(`sabre-client: tickets.fulfill ${message}`);
  };
  if (!isObject(request) || !nonEmpty(request.confirmationId)) fail('espera { confirmationId: string, fulfillments: [...] }');
  if (!Array.isArray(request.fulfillments) || request.fulfillments.length === 0 || request.fulfillments.length > 99) {
    fail('necesita fulfillments con 1 a 99 elementos');
  }
  for (const [index, fulfillment] of request.fulfillments.entries()) {
    const qualifiers = isObject(fulfillment) ? (fulfillment as FulfillmentDetails).ticketingQualifiers : undefined;
    if (qualifiers?.commissionAmount !== undefined && qualifiers.commissionPercentage !== undefined) {
      fail(`no combina commissionAmount con commissionPercentage (fulfillments[${index}])`);
    }
  }
  const printers = request.designatePrinters ?? [];
  if (printers.length > 1 && printers.some((printer) => printer.profileNumber !== undefined)) {
    fail('manda un perfil de impresoras solo, en un único elemento de designatePrinters');
  }
  const retries = options.retry?.maxRetries;
  if (retries !== undefined && retries !== 0) fail('no se reintenta nunca: retry.maxRetries solo puede ser 0');
}

/**
 * Fulfill: emite. Nunca se reintenta (ADR-031): ni el transporte ni los errores marcados como
 * temporales. Solo el 401 del gateway se repite una vez con un token nuevo, porque el gateway lo
 * rechaza antes de llegar a Fulfill.
 */
export async function fulfillTickets(
  transport: RestTransport,
  request: FulfillTicketsRequest,
  options: FulfillTicketsOptions = {},
): Promise<FulfillTicketsResponse> {
  validateFulfillTicketsRequest(request, options);
  const { confirmationId } = request;
  const body: FulfillTicketsRequest = { acceptPriceChanges: false, priceQuoteExpirationMethod: 'Quit', ...request };
  let sent = false;
  const userOnRawRequest = options.onRawRequest;
  const hooks = rawHooks(
    {
      onRawResponse: options.onRawResponse,
      // `onRawRequest` llega si algún intento llamó a `fetch`: así se sabe si el request salió.
      onRawRequest: (raw: SabreRawRequest) => {
        sent = true;
        userOnRawRequest?.(raw);
      },
    },
    FULFILL_TICKETS_OPERATION,
  );
  let response: RawFulfillTicketsResponse;
  try {
    response = await transport.request<RawFulfillTicketsResponse>({
      method: 'POST',
      path: PATH,
      service: FULFILL_TICKETS_SERVICE,
      idempotent: false,
      retry: { maxRetries: 0 },
      body,
      classify: (parsed) => classifyFulfillTickets(parsed, confirmationId),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...hooks,
    });
  } catch (error) {
    throw uncertainInFlight(error, sent, confirmationId, FULFILL_TICKETS_OPERATION, FULFILL_TICKETS_SERVICE);
  }
  return toFulfillTicketsResponse(response, confirmationId);
}

/**
 * Lo que pudo haber llegado a Sabre sin una respuesta legible pasa a incierto: un fallo de red,
 * un 5xx del gateway o un abort con el request ya mandado. El resto sale tal cual.
 * @internal Lo usa también el void de `booking.cancel`.
 */
export function uncertainInFlight(error: unknown, sent: boolean, confirmationId: string, operation: string, service: string): unknown {
  if (error instanceof SabreUncertainOutcomeError) return error;
  const make = (reason: SabreUncertainOutcomeReason, detail: string) =>
    new SabreUncertainOutcomeError(`${service}: no se sabe si se hizo (${detail}). Verifica antes de reintentar.`, {
      operation,
      confirmationId,
      reason,
      cause: error,
    });
  if (error instanceof Error && error.name === 'AbortError') return sent ? make('ABORTED', 'abort con el request ya mandado') : error;
  if (error instanceof SabreGatewayError && error.protocol === 'rest') {
    if (error.status === undefined) return make('TRANSPORT', 'fallo de red sin respuesta');
    if (GATEWAY_5XX.has(error.status)) return make('GATEWAY_5XX', `HTTP ${error.status} del gateway`);
  }
  return error;
}

/**
 * Paso 3 del orden de detección, sobre un 2xx. Devuelve el error a lanzar, o `undefined` si hay
 * boletos (`issued` o `partial`). Ver ADR-031, sección 2.
 */
export function classifyFulfillTickets(body: unknown, confirmationId: string): SabreError | undefined {
  if (!isObject(body)) {
    return uncertain('UNPARSEABLE', 'respuesta 2xx sin un objeto JSON', { confirmationId, raw: body });
  }
  const response = body as RawFulfillTicketsResponse;
  const items = allItems(response);
  const warnings = items.filter(isWarning).map((item) => toWarning(FULFILL_TICKETS_SERVICE, item));
  const fatal = items.filter((item) => !isWarning(item));
  const tickets = ticketsOf(response);
  const reported = tickets.map(uncertainTicket);
  const context = { confirmationId, tickets: reported, warnings, raw: body };
  const has = (type: string) => items.find((item) => item.type === type);

  const retrieve = has('UNABLE_TO_RETRIEVE_TICKETS');
  if (retrieve) return uncertain('UNABLE_TO_RETRIEVE_TICKETS', describe(retrieve), context);
  const notConfirmed = has('FULFILLMENT_NOT_CONFIRMED');
  if (notConfirmed) return uncertain('FULFILLMENT_NOT_CONFIRMED', describe(notConfirmed), context);
  const timeout = fatal.find((item) => item.type === 'INTERNAL_SERVER_TIMEOUT' && !NO_NEW_TICKETS.test(item.description ?? ''));
  if (timeout) return uncertain('INTERNAL_SERVER_TIMEOUT', describe(timeout), context);
  // Decisión del usuario (2026-11-12): siempre incierto, aunque diga «No new tickets have been issued».
  const downline = fatal.find((item) => item.type === 'DOWNLINE_SERVICE_ERROR');
  if (downline) return uncertain('DOWNLINE_SERVICE_ERROR', describe(downline), context);
  const card = fatal.find((item) => item.type === 'PAYMENT_CARD_ISSUE');
  if (card) return uncertain('PAYMENT_CARD_ISSUE', describe(card), context);

  const notCommitted = tickets.filter((ticket) => ticket.isCommitted === false);
  if (notCommitted.length > 0) {
    return uncertain('NOT_COMMITTED', `${notCommitted.length} boleto(s) emitido(s) sin guardar en el PNR (ghost ticket)`, context);
  }
  if (tickets.length > 0) return undefined;

  const [first, ...rest] = fatal;
  if (first !== undefined) {
    return toBusinessError(FULFILL_TICKETS_SERVICE, first, { warnings, errors: rest.map((item) => toBusinessError(FULFILL_TICKETS_SERVICE, item)) });
  }
  // Un 2xx sin boletos ni errores: no confirma nada.
  return uncertain('FULFILLMENT_NOT_CONFIRMED', 'respuesta 2xx sin boletos ni errores', context);
}

function toFulfillTicketsResponse(response: RawFulfillTicketsResponse, confirmationId: string): FulfillTicketsResponse {
  const items = allItems(response);
  const warnings = items.filter(isWarning).map((item) => toWarning(FULFILL_TICKETS_SERVICE, item));
  const errors = items.filter((item) => !isWarning(item)).map((item) => toBusinessError(FULFILL_TICKETS_SERVICE, item));
  const partial = errors.length > 0 || warnings.some((warning) => warning.code === 'PARTIAL_FULFILLMENT');
  return {
    status: partial ? 'partial' : 'issued',
    confirmationId,
    tickets: ticketsOf(response),
    warnings,
    errors,
    ...(response.timestamp === undefined ? {} : { timestamp: response.timestamp }),
    ...(response.request === undefined ? {} : { request: response.request }),
  };
}

/** `errors[]` y `warnings[]` (Fulfill los separa; Create, Get y Cancel no). */
function allItems(response: RawFulfillTicketsResponse): BookingResponseError[] {
  return [...responseErrors(response), ...(Array.isArray(response.warnings) ? responseErrors({ errors: response.warnings }) : [])];
}

function ticketsOf(response: RawFulfillTicketsResponse): FulfilledTicket[] {
  return Array.isArray(response.tickets) ? response.tickets.filter((ticket) => isObject(ticket) && nonEmpty(ticket.number)) : [];
}

function uncertainTicket(ticket: FulfilledTicket): SabreUncertainTicket {
  return {
    number: ticket.number,
    ...(ticket.ticketStatusCode === undefined ? {} : { ticketStatusCode: ticket.ticketStatusCode }),
    ...(ticket.isCommitted === undefined ? {} : { isCommitted: ticket.isCommitted }),
  };
}

function uncertain(
  reason: SabreUncertainOutcomeReason,
  detail: string,
  context: { confirmationId: string; tickets?: SabreUncertainTicket[]; warnings?: SabreWarning[]; raw: unknown },
): SabreUncertainOutcomeError {
  return new SabreUncertainOutcomeError(`${FULFILL_TICKETS_SERVICE}: no se sabe si emitió (${reason}: ${detail}). Verifica con tickets.verify antes de reintentar.`, {
    operation: FULFILL_TICKETS_OPERATION,
    ...context,
    reason,
  });
}

/** Sin `fieldValue`, que puede traer datos del pasajero. */
function describe(item: BookingResponseError): string {
  return nonEmpty(item.description) ? item.description : item.type;
}
