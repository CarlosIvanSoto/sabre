// Cancel Booking (`POST /v1/trip/orders/cancelBooking`).
// Ver sabre-wiki/wiki/sdk/gestion-de-reserva.md y sabre-wiki/wiki/sources/cancel-booking.md.
import { SabreError, type SabreWarning } from '../errors/index.js';
import type { SabreRawResponseCallback } from '../http/raw-response.js';
import type { RestTransport } from '../http/rest-transport.js';
import {
  type BookingResponseError,
  isObject,
  isWarning,
  nonEmpty,
  responseErrors,
  toBusinessError,
  toWarning,
} from './booking-errors.js';
import type { Booking } from './create-booking.js';
import type { BookingSource } from './get-booking.js';

export const CANCEL_BOOKING_SERVICE = 'cancelBooking';
const PATH = '/v1/trip/orders/cancelBooking';
/** Llega con `category: WARNING`, pero significa que no se canceló nada (decidido en #39). */
const NO_ITEMS_CANCELLED = 'NO_ITEMS_CANCELLED';
const ITEM_LISTS = ['flights', 'hotels', 'cars', 'trains', 'cruises', 'segments'] as const;

/** `HALT_ON_ERROR` (default de Sabre, con rollback) o `ALLOW_PARTIAL_CANCEL`. */
export type CancelBookingErrorPolicy = 'HALT_ON_ERROR' | 'ALLOW_PARTIAL_CANCEL';

export type FlightTicketOperation = 'VOID' | 'REFUND';

export type RefundDocumentsType = 'Tickets' | 'EMDs' | 'Tickets and EMDs';

/** Producto a cancelar, por el `itemId` que devuelve Get Booking (p. ej. `flights[].itemId`). */
export interface BookingItemReference {
  itemId: string;
}

/**
 * Segmento a cancelar, por `id` o por `sequence`. Sabre desaconseja `sequence`: la posición
 * puede cambiar entre la lectura y la cancelación.
 */
export interface CancelSegmentReference {
  id?: string;
  sequence?: number;
}

/** `Notification` del spec: `email` o `queuePlacement`, no los dos. Se envía tal cual. */
export interface CancelBookingNotification {
  email?: 'DEFAULT' | 'INVOICE' | 'ETICKET' | 'ETICKET_PDF' | 'ITINERARY' | 'ITINERARY_PDF';
  queuePlacement?: Array<Record<string, unknown>>;
}

/**
 * `CancelBookingRequest` del spec v1.33. El Tier 1 usa `cancelAll` o `flights[].itemId` sobre
 * contenido ATPCO; los campos de tickets, NDC, impresoras, notificación y retención se envían
 * tal cual, sin lógica propia.
 */
export interface CancelBookingRequest {
  /** Localizador del PNR u Order ID (`^[A-Z0-9]{6,}$`). Único campo obligatorio. */
  confirmationId: string;
  bookingSource?: BookingSource;
  /** Cancela todos los segmentos. No se combina con las listas. */
  cancelAll?: boolean;
  flights?: BookingItemReference[];
  hotels?: BookingItemReference[];
  cars?: BookingItemReference[];
  trains?: BookingItemReference[];
  cruises?: BookingItemReference[];
  segments?: CancelSegmentReference[];
  /** Sin valor, Sabre aplica `HALT_ON_ERROR`: si algo falla, deshace lo ya cancelado. */
  errorHandlingPolicy?: CancelBookingErrorPolicy;
  /** Si es `true`, la respuesta trae el estado posterior en `booking`. */
  retrieveBooking?: boolean;
  /** Firma del cambio en el PNR. Sabre usa `LW CANCEL API` por defecto. */
  receivedFrom?: string;
  /** El contexto no se revierte al terminar. */
  targetPcc?: string;
  /** No se combina con `offerItemId`. */
  flightTicketOperation?: FlightTicketOperation;
  /** Solo NDC. No se combina con `flightTicketOperation`. */
  offerItemId?: string;
  notification?: CancelBookingNotification;
  designatePrinters?: Array<Record<string, unknown>>;
  retentionEndDate?: string;
  retentionLabel?: string;
  voidNonElectronicTickets?: boolean;
  refundDocumentsType?: RefundDocumentsType;
}

export interface CancelBookingOptions {
  signal?: AbortSignal;
  /** Respuesta cruda del último intento HTTP. El body trae PII: ver `SabreRawResponse`. */
  onRawResponse?: SabreRawResponseCallback;
}

/** `CancelBookingResponse` tal cual llega de Sabre. */
export interface RawCancelBookingResponse {
  timestamp?: string;
  request?: CancelBookingRequest;
  booking?: Booking;
  tickets?: Array<Record<string, unknown>>;
  voidedTickets?: string[];
  refundedTickets?: string[];
  flightRefunds?: Array<Record<string, unknown>>;
  errors?: BookingResponseError[];
}

/** Cancelación con éxito: sin errores fatales y sin `NO_ITEMS_CANCELLED`. */
export interface CancelBookingResponse {
  timestamp?: string;
  /** Eco del request con los defaults de Sabre completados. */
  request?: CancelBookingRequest;
  /** Estado posterior de la reserva, anidado (solo con `retrieveBooking: true`). */
  booking?: Booking;
  tickets?: Array<Record<string, unknown>>;
  voidedTickets?: string[];
  refundedTickets?: string[];
  flightRefunds?: Array<Record<string, unknown>>;
  /**
   * Elementos de `errors[]` con `category: WARNING`. Con `END_TRANSACTION_PROBLEM` la
   * confirmación quedó pendiente: verifica el resultado con `sabre.booking.get`.
   */
  warnings: SabreWarning[];
}

/**
 * Cancel Booking: escritura sin reintento automático. Solo el reintento reactivo ante 401,
 * que el gateway rechaza antes de llegar al proveedor.
 */
export async function cancelBooking(
  transport: RestTransport,
  request: CancelBookingRequest,
  options: CancelBookingOptions = {},
): Promise<CancelBookingResponse> {
  validateCancelBookingRequest(request);
  const body = await transport.request<RawCancelBookingResponse>({
    method: 'POST',
    path: PATH,
    service: CANCEL_BOOKING_SERVICE,
    idempotent: false,
    body: request,
    classify: classifyCancelBooking,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onRawResponse === undefined
      ? {}
      : { operation: 'booking.cancel', onRawResponse: options.onRawResponse }),
  });
  return toCancelBookingResponse(body);
}

/** Combinaciones que Sabre rechaza seguro (`INVALID_FLAGS_COMBINATION`, `CANCEL_DATA_MISSING`). */
function validateCancelBookingRequest(request: CancelBookingRequest): void {
  if (!isObject(request) || !nonEmpty(request.confirmationId)) {
    throw new TypeError('sabre-client: booking.cancel espera { confirmationId: string, ... }');
  }
  const lists = ITEM_LISTS.join(', ');
  if (request.cancelAll === true) {
    if (ITEM_LISTS.some((list) => request[list] !== undefined)) {
      throw new TypeError(`sabre-client: booking.cancel no combina cancelAll con listas (${lists})`);
    }
  } else if (!ITEM_LISTS.some((list) => Array.isArray(request[list]) && request[list].length > 0)) {
    throw new TypeError(`sabre-client: booking.cancel necesita cancelAll: true o al menos una lista (${lists})`);
  }
  if (request.offerItemId !== undefined && request.flightTicketOperation !== undefined) {
    throw new TypeError('sabre-client: booking.cancel no combina offerItemId con flightTicketOperation');
  }
}

/**
 * Paso 3 del orden de detección. Éxito = ningún error que no sea `WARNING` y ningún
 * `NO_ITEMS_CANCELLED`. Si no:
 *
 * - Con `NO_ITEMS_CANCELLED`: `SabreBusinessError` con ese código; los errores que explican
 *   el fallo van en `errors` y los demás avisos en `warnings`.
 * - Sin él: `SabreBusinessError` con el primer error que no sea `WARNING`, el resto en
 *   `errors` y los avisos en `warnings`.
 */
export function classifyCancelBooking(body: unknown): SabreError | undefined {
  if (!isObject(body)) {
    return new SabreError(`${CANCEL_BOOKING_SERVICE}: respuesta malformada, se esperaba un objeto`, {
      retryable: false,
      raw: body,
    });
  }
  const items = responseErrors(body as RawCancelBookingResponse);
  const nothingCancelled = items.find(isNoItemsCancelled);
  const warnings = items.filter((item) => isWarning(item) && !isNoItemsCancelled(item)).map(warningOf);
  const fatal = items.filter((item) => !isWarning(item));

  if (nothingCancelled !== undefined) {
    return toBusinessError(CANCEL_BOOKING_SERVICE, nothingCancelled, { warnings, errors: fatal.map(errorOf) });
  }
  const [first, ...rest] = fatal;
  if (first === undefined) return undefined;
  return toBusinessError(CANCEL_BOOKING_SERVICE, first, { warnings, errors: rest.map(errorOf) });
}

/** Solo para respuestas con éxito (ver `classifyCancelBooking`): `errors[]` trae solo avisos. */
function toCancelBookingResponse(body: RawCancelBookingResponse): CancelBookingResponse {
  const { errors: _errors, ...rest } = body;
  return { ...rest, warnings: responseErrors(body).map(warningOf) };
}

function isNoItemsCancelled(item: BookingResponseError): boolean {
  return item.type === NO_ITEMS_CANCELLED;
}

function warningOf(item: BookingResponseError): SabreWarning {
  return toWarning(CANCEL_BOOKING_SERVICE, item);
}

function errorOf(item: BookingResponseError) {
  return toBusinessError(CANCEL_BOOKING_SERVICE, item);
}
