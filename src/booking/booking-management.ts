// Módulo de dominio `sabre.booking` (Booking Management API).
// Ver sabre-wiki/wiki/sdk/convenciones-de-nombres-y-versionado.md.
import type { RestTransport } from '../http/rest-transport.js';
import type { CreateBookingRequest } from './create-booking-request.js';
import { createBooking, type CreateBookingOptions, type CreateBookingResponse } from './create-booking.js';
import { getBooking, type GetBookingOptions, type GetBookingRequest, type GetBookingResponse } from './get-booking.js';

export class BookingManagement {
  readonly #transport: RestTransport;

  /** @internal Lo construye el cliente `Sabre`. */
  constructor(transport: RestTransport) {
    this.#transport = transport;
  }

  /**
   * Create Booking: crea la reserva. Para un itinerario de BFM/Revalidate, `flightDetails` se
   * arma con `buildBookingFlightDetails`.
   *
   * Nunca se reintenta automáticamente. Si la reserva se crea con avisos o errores no fatales,
   * no lanza: los devuelve en `warnings` y `errors`. Si no se crea, lanza `SabreBusinessError`.
   */
  create(request: CreateBookingRequest, options?: CreateBookingOptions): Promise<CreateBookingResponse> {
    return createBooking(this.#transport, request, options);
  }

  /**
   * Get Booking: lee la reserva por `confirmationId`. El `Booking` va en el primer nivel de la
   * respuesta, a diferencia de `create`. Usa `returnOnly` para pedir solo las secciones que
   * hacen falta: además acelera la respuesta.
   *
   * Si la reserva existe, no lanza: los avisos y errores parciales van en `warnings` y
   * `errors`. Si no existe o no se pudo leer (p. ej. `BOOKING_NOT_FOUND`), lanza
   * `SabreBusinessError`. Es una lectura: se reintenta ante fallos transitorios.
   */
  get(request: GetBookingRequest, options?: GetBookingOptions): Promise<GetBookingResponse> {
    return getBooking(this.#transport, request, options);
  }
}
