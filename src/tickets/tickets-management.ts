// Módulo de dominio `sabre.tickets`: emisión y verificación (ADR-019, ADR-031).
import type { RestTransport } from '../http/rest-transport.js';
import { type FulfillTicketsOptions, type FulfillTicketsRequest, type FulfillTicketsResponse, fulfillTickets } from './fulfill-tickets.js';
import { type VerifyTicketsOptions, type VerifyTicketsRequest, type VerifyTicketsResponse, verifyTickets } from './verify-tickets.js';

export class TicketsManagement {
  readonly #transport: RestTransport;

  /** @internal Lo construye el cliente `Sabre`. */
  constructor(transport: RestTransport) {
    this.#transport = transport;
  }

  /**
   * Fulfill Flight Tickets: emite los boletos (y EMD) de una reserva con su PQ guardado. **Mueve
   * dinero y nunca se reintenta**, ni ante un fallo de transporte ni ante un error que Sabre marque
   * como temporal (ADR-031). Pasar `retry.maxRetries` distinto de 0 lanza `TypeError` sin red.
   *
   * El SDK manda `acceptPriceChanges: false` y `priceQuoteExpirationMethod: 'Quit'` salvo que se
   * pasen otros valores: una emisión automática no paga un precio que nadie vio.
   *
   * Desenlaces:
   * - **Emitido** (`status: 'issued'`): todos los boletos con `isCommitted: true`.
   * - **Parcial** (`status: 'partial'`): hay boletos emitidos y algo faltó (`PARTIAL_FULFILLMENT`
   *   o un error junto con boletos). **No es una emisión completa**: hay pasajeros sin boleto.
   *   Guarda los emitidos y verifica antes de completar.
   * - **No emitido**: lanza `SabreBusinessError` (p. ej. `PRICE_MISMATCH`, `BOOKING_FULFILLED`) o
   *   `SabreGatewayError` (400, 401, 403, 429).
   * - **Incierto**: lanza `SabreUncertainOutcomeError`. Verifica con `verify`, pasando sus
   *   `tickets` como `expectedTickets`, antes de pensar en reintentar.
   *
   * `BOOKING_FULFILLED` quiere decir que la reserva ya tiene boletos, **no** que sean de esta
   * emisión: verifica con `verify`. Los errores de configuración del PCC (comisión, impresora,
   * Secure Flight) llegan como `DOWNLINE_SERVICE_ERROR` y hoy se tratan como incierto (CERT,
   * 2026-11-12).
   */
  fulfill(request: FulfillTicketsRequest, options?: FulfillTicketsOptions): Promise<FulfillTicketsResponse> {
    return fulfillTickets(this.#transport, request, options);
  }

  /**
   * ¿Se emitió? Lee la reserva con Get Booking y devuelve `issued`, `notCommitted` o `notFound`,
   * por el `ticketStatusCode` de cada boleto. Nunca emite. Un `notFound` no prueba que no se haya
   * emitido: ver `VerifyTicketsResponse`.
   */
  verify(request: VerifyTicketsRequest, options?: VerifyTicketsOptions): Promise<VerifyTicketsResponse> {
    return verifyTickets(this.#transport, request, options);
  }
}
