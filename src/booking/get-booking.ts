// Get Booking (`POST /v1/trip/orders/getBooking`).
// Ver sabre-wiki/wiki/sdk/gestion-de-reserva.md y sabre-wiki/wiki/sources/get-booking.md.
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
import type { Booking } from './create-booking.js';

export const GET_BOOKING_SERVICE = 'getBooking';
const PATH = '/v1/trip/orders/getBooking';
/** Fallos de sistema que Sabre puede resolver al repetir la lectura (decidido en #39). */
const RETRYABLE_TYPES = new Set(['INTERNAL_SERVER_TIMEOUT', 'DOWNLINE_SERVICE_FAILURE']);

/** Secciones de la respuesta (`ReturnOnlyEnum`). Además evitan llamadas downline de Sabre. */
export type GetBookingReturnOnly =
  | 'FLIGHTS'
  | 'FLIGHT_PENALTY'
  | 'BAGGAGE_POLICY'
  | 'JOURNEYS'
  | 'HOTELS'
  | 'HOTEL_ADDRESS'
  | 'CARS'
  | 'CAR_RENTAL_ADDRESS'
  | 'CAR_RENTAL_PENALTY'
  | 'TRAINS'
  | 'CRUISES'
  | 'ALL_SEGMENTS'
  | 'TRAVELERS'
  | 'TICKETS'
  | 'PAYMENTS'
  | 'PENALTIES'
  | 'REMARKS'
  | 'IS_CANCELABLE'
  | 'IS_TICKETED'
  | 'CONTACT_INFO'
  | 'OTHER_SERVICES'
  | 'SPECIAL_SERVICES'
  | 'FARES'
  | 'CREATION_DETAILS'
  | 'ANCILLARIES'
  | 'FORMS_OF_PAYMENT'
  | 'RETENTION_DATE'
  | 'ACCOUNTING_ITEMS'
  | 'NON_ELECTRONIC_TICKETS'
  | 'TRAVELERS_EMPLOYERS'
  | 'PROFILES';

/** `BookingSourceEnum`. Por defecto `SABRE`. */
export type BookingSource = 'SABRE' | 'SABRE_ORDER';

/** `ExtraFeatures` del spec (incluye `CommonExtraFeatures`). */
export interface GetBookingExtraFeatures {
  /** Solo NDC. Por defecto `true`. */
  returnEmptySeatObjects?: boolean;
  /** Por defecto `false`; más lento. */
  forceHotelUpdate?: boolean;
  returnFrequentRenter?: boolean;
  returnWalletFormsOfPayment?: boolean;
  returnFiscalId?: boolean;
}

/** `GetBookingRequest` del spec v1.33. */
export interface GetBookingRequest {
  /** Localizador del PNR u Order ID (`^[A-Z0-9]{6,}$`). Único campo obligatorio. */
  confirmationId: string;
  bookingSource?: BookingSource;
  /** Cambio de contexto (`^[A-Z0-9]{3,4}$`). */
  targetPcc?: string;
  /** Validación extra: si no coincide con el PNR, Sabre responde `UNAUTHORIZED_ACCESS`. */
  surname?: string;
  /** Según el spec, Sabre no los usa; solo `surname`. */
  givenName?: string;
  middleName?: string;
  /** Vacío o ausente: la reserva completa. */
  returnOnly?: GetBookingReturnOnly[];
  extraFeatures?: GetBookingExtraFeatures;
  /** Requiere el keyword `CCVIEW` en el EPR. */
  unmaskPaymentCardNumbers?: boolean;
}

export interface GetBookingOptions {
  signal?: AbortSignal;
}

/** `GetBookingResponse` tal cual llega de Sabre: el `Booking` va en el primer nivel. */
export interface RawGetBookingResponse extends Booking {
  timestamp?: string;
  bookingSignature?: string;
  request?: GetBookingRequest;
  errors?: BookingResponseError[];
}

/**
 * Reserva leída, con el `Booking` en el primer nivel tal cual lo define Sabre (no se normaliza
 * contra Create ni Cancel, que lo anidan en `booking`). `errors[]` del original se reemplaza
 * por los errores del SDK.
 */
export interface GetBookingResponse extends Booking {
  bookingId: string;
  timestamp?: string;
  /** Solo viene si Sabre armó la reserva sin errores. Lo usa Modify Booking. */
  bookingSignature?: string;
  /** Copia del request enviado, si Sabre la devuelve. */
  request?: GetBookingRequest;
  /**
   * Elementos de `errors[]` con `category: WARNING`. En un PNR sin emitir es normal
   * `RESOURCE_UNAVAILABLE` por falta de fare rules.
   */
  warnings: SabreWarning[];
  /**
   * Elementos de `errors[]` de otras categorías que llegaron junto con la reserva, p. ej.
   * `UNAUTHORIZED_ACCESS` de un servicio downline: faltan secciones, pero la reserva existe.
   */
  errors: SabreBusinessError[];
}

/**
 * Get Booking: lectura idempotente. Los 429/5xx de gateway se reintentan con la política
 * genérica, y también `INTERNAL_SERVER_TIMEOUT` y `DOWNLINE_SERVICE_FAILURE`.
 */
export async function getBooking(
  transport: RestTransport,
  request: GetBookingRequest,
  options: GetBookingOptions = {},
): Promise<GetBookingResponse> {
  if (!isObject(request) || !nonEmpty(request.confirmationId)) {
    throw new TypeError('sabre-client: booking.get espera { confirmationId: string, ... }');
  }
  const body = await transport.request<RawGetBookingResponse>({
    method: 'POST',
    path: PATH,
    service: GET_BOOKING_SERVICE,
    idempotent: true,
    body: request,
    classify: classifyGetBooking,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return toGetBookingResponse(body);
}

/**
 * Paso 3 del orden de detección. Lo que decide si se lanza es si hay reserva (`bookingId`):
 *
 * - Hay reserva: no hay error; `toGetBookingResponse` adjunta avisos y errores al resultado.
 * - No hay reserva: `SabreBusinessError` con el primer error que no sea `WARNING` (p. ej.
 *   `BOOKING_NOT_FOUND` o `UNAUTHORIZED_ACCESS`), y los avisos adjuntos.
 */
export function classifyGetBooking(body: unknown): SabreError | undefined {
  if (!isObject(body)) {
    return new SabreError(`${GET_BOOKING_SERVICE}: respuesta malformada, se esperaba un objeto`, {
      retryable: false,
      raw: body,
    });
  }
  const response = body as RawGetBookingResponse;
  if (nonEmpty(response.bookingId)) return undefined;

  const items = responseErrors(response);
  const fatal = items.find((item) => !isWarning(item));
  if (fatal !== undefined) return errorOf(fatal, items.filter(isWarning).map(warningOf));
  return new SabreError(`${GET_BOOKING_SERVICE}: respuesta malformada, sin bookingId ni errores fatales`, {
    retryable: false,
    raw: body,
  });
}

/** Solo para respuestas con reserva (ver `classifyGetBooking`). */
function toGetBookingResponse(body: RawGetBookingResponse): GetBookingResponse {
  const items = responseErrors(body);
  return {
    ...body,
    bookingId: body.bookingId!,
    warnings: items.filter(isWarning).map(warningOf),
    errors: items.filter((item) => !isWarning(item)).map((item) => errorOf(item, [])),
  };
}

function warningOf(item: BookingResponseError): SabreWarning {
  return toWarning(GET_BOOKING_SERVICE, item);
}

function errorOf(item: BookingResponseError, warnings: SabreWarning[]): SabreBusinessError {
  return toBusinessError(GET_BOOKING_SERVICE, item, { warnings, retryable: RETRYABLE_TYPES.has(item.type) });
}
