// Módulo de dominio `sabre.booking` (Booking Management API).
// Ver sabre-wiki/wiki/sdk/convenciones-de-nombres-y-versionado.md.
import type { RestTransport } from '../http/rest-transport.js';
import type { CreateBookingRequest } from './create-booking-request.js';
import { createBooking, type CreateBookingOptions, type CreateBookingResponse } from './create-booking.js';

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
}
