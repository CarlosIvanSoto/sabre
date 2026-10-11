// Create Booking (`POST /v1/trip/orders/createBooking`).
// Ver sabre-wiki/wiki/entities/booking-management-api.md y
// sabre-wiki/wiki/sdk/manejo-y-mapeo-de-errores.md (éxito parcial de Create Booking).
import { SabreBusinessError, SabreError, SabreWarning } from '../errors/index.js';
import type { RestTransport } from '../http/rest-transport.js';
import type { CreateBookingRequest } from './create-booking-request.js';

export const CREATE_BOOKING_SERVICE = 'createBooking';
const PATH = '/v1/trip/orders/createBooking';
const WARNING = 'WARNING';
/** Aviso cuyo `description` trae el `confirmationId` de una reserva que sí se creó. */
const UNABLE_TO_RETRIEVE_BOOKING = 'UNABLE_TO_RETRIEVE_BOOKING';

export interface CreateBookingOptions {
  signal?: AbortSignal;
}

/** Elemento de `errors[]` tal cual lo manda Sabre (`Error` del spec; los avisos comparten forma). */
export interface CreateBookingResponseError {
  /** `BAD_REQUEST`, `APPLICATION_ERROR`, `WARNING`, … */
  category: string;
  /** P. ej. `UNABLE_TO_BOOK_FLIGHTS`. */
  type: string;
  description?: string;
  fieldPath?: string;
  fieldName?: string;
  /** Puede traer datos del request (p. ej. un email): no se copia a los errores del SDK. */
  fieldValue?: string;
}

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
  if (fatal !== undefined) return toBusinessError(fatal, items.filter(isWarning).map(toWarning));
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
    warnings: items.filter(isWarning).map(toWarning),
    errors: items.filter((item) => !isWarning(item)).map((item) => toBusinessError(item, [])),
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

function responseErrors(response: RawCreateBookingResponse): CreateBookingResponseError[] {
  return Array.isArray(response.errors) ? response.errors.filter(isObject) as CreateBookingResponseError[] : [];
}

function isWarning(item: CreateBookingResponseError): boolean {
  return typeof item.category === 'string' && item.category.toUpperCase() === WARNING;
}

function toWarning(item: CreateBookingResponseError): SabreWarning {
  return new SabreWarning(messageOf(item), { service: CREATE_BOOKING_SERVICE, code: codeOf(item), raw: item });
}

function toBusinessError(item: CreateBookingResponseError, warnings: SabreWarning[]): SabreBusinessError {
  return new SabreBusinessError(messageOf(item), {
    service: CREATE_BOOKING_SERVICE,
    code: codeOf(item),
    raw: item,
    warnings,
  });
}

function codeOf(item: CreateBookingResponseError): string {
  return typeof item.type === 'string' && item.type !== '' ? item.type : String(item.category);
}

/** Sin `fieldValue`, que puede traer datos del pasajero; queda en `raw`. */
function messageOf(item: CreateBookingResponseError): string {
  const where = typeof item.fieldPath === 'string' && item.fieldPath !== '' ? ` en ${item.fieldPath}` : '';
  const description = typeof item.description === 'string' && item.description !== '' ? `: ${item.description}` : '';
  return `${CREATE_BOOKING_SERVICE}: ${String(item.category)} ${codeOf(item)}${where}${description}`;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
