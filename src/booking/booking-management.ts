// Módulo de dominio `sabre.booking` (Booking Management API).
// Ver sabre-wiki/wiki/sdk/convenciones-de-nombres-y-versionado.md.
import type { RestTransport } from '../http/rest-transport.js';
import {
  cancelBooking,
  type CancelBookingOptions,
  type CancelBookingRequest,
  type CancelBookingResponse,
} from './cancel-booking.js';
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
   * Con `agency.ticketingPolicy: 'FUTURE_TICKETING'` y sin `agency.futureTicketingPolicy`, lanza
   * `TypeError` sin llamar a la red: Sabre lo rechaza seguro. Lo mismo con un asiento cuyo
   * `travelerIndex` no está en `travelers`. Un asiento con precio en Get Seats (ver
   * `buildBookingFlightDetails`) solo emite `sabre.booking.seat.priced` en `warn`.
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

  /**
   * Cancel Booking: cancela la reserva entera (`cancelAll: true`) o por `itemId` (p. ej. los
   * `flights[].itemId` de `get`). Valida antes de enviar las combinaciones que Sabre rechaza y,
   * si encuentra una, lanza `TypeError` sin llamar a la red.
   *
   * Nunca se reintenta automáticamente. Lanza `SabreBusinessError` si algo falló o si Sabre
   * responde `NO_ITEMS_CANCELLED` (no se canceló nada), aunque llegue como aviso. Con
   * `END_TRANSACTION_PROBLEM` en `warnings`, la confirmación quedó pendiente: verifica con `get`.
   *
   * **Void** (`flightTicketOperation: 'VOID'`, ADR-031): anula los boletos y es **irreversible**.
   * Con `cancelAll` y `HALT_ON_ERROR`, una sola llamada anula y cancela la reserva; `voidedTickets`
   * trae los números anulados (CERT, 2026-11-13). Un fallo de red, un 5xx, un cuerpo ilegible, un
   * abort con el request ya mandado o `END_TRANSACTION_PROBLEM` lanzan `SabreUncertainOutcomeError`:
   * no se sabe si se anuló. Verifica con `sabre.tickets.verify` (un boleto anulado queda en `TV`) o
   * con `get` antes de reintentar. `VOID` sobre una reserva sin boletos lanza `NO_ITEMS_CANCELLED`
   * con `UNABLE_TO_VOID_TICKET` y **no cancela nada**: para una reserva sin emitir, cancela sin
   * `VOID`.
   */
  cancel(request: CancelBookingRequest, options?: CancelBookingOptions): Promise<CancelBookingResponse> {
    return cancelBooking(this.#transport, request, options);
  }
}
