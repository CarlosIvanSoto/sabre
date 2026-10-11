// Create Booking (`POST /v1/trip/orders/createBooking`).
// Ver sabre-wiki/wiki/entities/booking-management-api.md y
// sabre-wiki/wiki/sdk/manejo-y-mapeo-de-errores.md (éxito parcial de Create Booking).
import { type SabreBusinessError, SabreError, type SabreWarning } from '../errors/index.js';
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
import type { CreateBookingRequest } from './create-booking-request.js';

export const CREATE_BOOKING_SERVICE = 'createBooking';
const PATH = '/v1/trip/orders/createBooking';
/** Aviso cuyo `description` trae el `confirmationId` de una reserva que sí se creó. */
const UNABLE_TO_RETRIEVE_BOOKING = 'UNABLE_TO_RETRIEVE_BOOKING';

export interface CreateBookingOptions {
  signal?: AbortSignal;
}

/** Elemento de `errors[]` de Create Booking. */
export type CreateBookingResponseError = BookingResponseError;

/**
 * `Booking` del spec (mismo modelo que Get Booking). Se tipa el primer nivel; el detalle de
 * `flights`, `travelers`, `fares`, etc. queda sin tipar en el Tier 1.
 */
export interface Booking {
  bookingId?: string;
  startDate?: string;
  endDate?: string;
  isCancelable?: boolean;
  isTicketed?: boolean;
  [field: string]: unknown;
}

/** `CreateBookingResponse` tal cual llega de Sabre. */
export interface RawCreateBookingResponse {
  timestamp?: string;
  confirmationId?: string;
  booking?: Booking;
  errors?: CreateBookingResponseError[];
  request?: CreateBookingRequest;
}

/**
 * Reserva creada. Si Sabre la creó con avisos o con errores no fatales (p. ej. con
 * `errorHandlingPolicy: DO_NOT_HALT_ON_*`), no se lanza: van adjuntos aquí.
 */
export interface CreateBookingResponse {
  /** Localizador del PNR. */
  confirmationId: string;
  timestamp?: string;
  /** Falta, p. ej., con el aviso `UNABLE_TO_RETRIEVE_BOOKING`. */
  booking?: Booking;
  /** Copia del request enviado, si Sabre la devuelve. */
  request?: CreateBookingRequest;
  /** Elementos de `errors[]` con `category: WARNING`. */
  warnings: SabreWarning[];
  /** Elementos de `errors[]` de otras categorías que no impidieron crear la reserva. */
  errors: SabreBusinessError[];
}

/**
 * Create Booking: escritura no idempotente, sin reintento automático. Solo el reintento
 * reactivo ante 401, que el gateway rechaza antes de llegar al proveedor.
 */
export async function createBooking(
  transport: RestTransport,
  request: CreateBookingRequest,
  options: CreateBookingOptions = {},
): Promise<CreateBookingResponse> {
  if (typeof request !== 'object' || request === null) {
    throw new TypeError('sabre-client: booking.create espera un objeto CreateBookingRequest');
  }
  const body = await transport.request<RawCreateBookingResponse>({
    method: 'POST',
    path: PATH,
    service: CREATE_BOOKING_SERVICE,
    idempotent: false,
    body: request,
    classify: classifyCreateBooking,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return toCreateBookingResponse(body);
}

/**
 * Paso 3 del orden de detección. Lo que decide si se lanza es si la reserva se creó, no la
 * categoría de `errors[]`:
 *
 * - Hay reserva (`confirmationId`, `booking.bookingId` o el aviso `UNABLE_TO_RETRIEVE_BOOKING`
 *   con el localizador en el `description`): no hay error, `toCreateBookingResponse` adjunta
 *   avisos y errores al resultado.
 * - No hay reserva: `SabreBusinessError` con el primer error que no sea `WARNING`, y los
 *   avisos adjuntos.
 */
export function classifyCreateBooking(body: unknown): SabreError | undefined {
  if (!isObject(body)) {
    return new SabreError(`${CREATE_BOOKING_SERVICE}: respuesta malformada, se esperaba un objeto`, {
      retryable: false,
      raw: body,
    });
  }
  const response = body as RawCreateBookingResponse;
  if (confirmationIdOf(response) !== undefined) return undefined;

  // La reserva existe pero no hay localizador que devolver: no es un "no se creó".
  if (reservationWithoutId(response)) {
    return new SabreError(
      `${CREATE_BOOKING_SERVICE}: Sabre indica que la reserva se creó, pero no devolvió su confirmationId`,
      { retryable: false, raw: body },
    );
  }
  const items = responseErrors(response);
  const fatal = items.find((item) => !isWarning(item));
  if (fatal !== undefined) return toBusinessError(CREATE_BOOKING_SERVICE, fatal, { warnings: items.filter(isWarning).map(warningOf) });
  return new SabreError(`${CREATE_BOOKING_SERVICE}: respuesta malformada, sin confirmationId ni errores fatales`, {
    retryable: false,
    raw: body,
  });
}

/** Solo para respuestas con reserva (ver `classifyCreateBooking`). */
function toCreateBookingResponse(body: RawCreateBookingResponse): CreateBookingResponse {
  const items = responseErrors(body);
  return {
    confirmationId: confirmationIdOf(body)!,
    ...(body.timestamp === undefined ? {} : { timestamp: body.timestamp }),
    ...(body.booking === undefined ? {} : { booking: body.booking }),
    ...(body.request === undefined ? {} : { request: body.request }),
    warnings: items.filter(isWarning).map(warningOf),
    errors: items.filter((item) => !isWarning(item)).map((item) => toBusinessError(CREATE_BOOKING_SERVICE, item)),
  };
}

function confirmationIdOf(response: RawCreateBookingResponse): string | undefined {
  if (nonEmpty(response.confirmationId)) return response.confirmationId;
  if (nonEmpty(response.booking?.bookingId)) return response.booking.bookingId;
  const notRetrieved = responseErrors(response).find((item) => item.type === UNABLE_TO_RETRIEVE_BOOKING);
  return notRetrieved === undefined ? undefined : locatorIn(notRetrieved.description);
}

function reservationWithoutId(response: RawCreateBookingResponse): boolean {
  return response.booking !== undefined || responseErrors(response).some((item) => item.type === UNABLE_TO_RETRIEVE_BOOKING);
}

/**
 * El catálogo documenta el description como `Booking was created successfully but could not
 * be retrieved. (confirmationId)`. Se prefiere el valor entre paréntesis.
 */
function locatorIn(description: string | undefined): string | undefined {
  if (description === undefined) return undefined;
  return /\(([A-Z0-9]{6,})\)/.exec(description)?.[1] ?? /\b([A-Z0-9]{6,})\b/.exec(description)?.[1];
}

function warningOf(item: BookingResponseError): SabreWarning {
  return toWarning(CREATE_BOOKING_SERVICE, item);
}
