// La reserva dentro de una sesión SOAP: hoy, solo el historial (B1 de ADR-027).
import type { SoapResponse } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';
import {
  isRecordLocator,
  parseReservationHistoryResponse,
  type ReservationHistoryOptions,
  type ReservationHistoryResponse,
  reservationHistoryRequest,
} from './reservation-history.js';

/** @internal Lo que `SessionReservation` necesita de la sesión. */
export interface ReservationContext {
  send(request: SessionRequest): Promise<SoapResponse>;
}

export class SessionReservation {
  readonly #context: ReservationContext;

  /** @internal Lo construye `SabreSession`. */
  constructor(context: ReservationContext) {
    this.#context = context;
  }

  /**
   * Get Itinerary History (`TravelItineraryHistoryLLSRQ` 2.4.0, el `*H` del host): el historial
   * del PNR, una entrada por transacción. Cada una trae quién la firmó, cuándo y desde qué PCC, y
   * los elementos que cambió con su `action`: los segmentos de vuelo con su estado en ese momento,
   * y SSR, ticketing, teléfonos, nombres y emails como texto en `generalInfo`. Lo que no se tipa
   * queda en la respuesta cruda (`onRawResponse`). **Trae datos del pasajero.**
   *
   * El historial no registra las colocaciones en cola, ni las del sistema ni un `place` manual
   * (CERT, 2026-11-06, Q-097): para eso están `queue.list`/`access` o los remarks `QUEUE_PLACE` de
   * Get Booking.
   *
   * **Dentro de una cola, Sabre lo rechaza** para otro PNR (CERT, 2026-11-06, Q-102): lanza
   * `SabreBusinessError` con `NAK6 -NOT ALLOWED- FINISH OR IGNORE OTHER ACTIVITY`. El PNR del AAA
   * no cambia, `queue.state` sigue en `'inside'` y el recorrido sigue con `ignore`. Conviene
   * llamarlo fuera de una cola.
   *
   * Es una lectura: se reintenta ante fallos transitorios. Un `locator` que no es de 6 caracteres
   * alfanuméricos en mayúscula lanza `TypeError` sin red. Un PNR que no existe sale como
   * `SabreBusinessError` (`service: 'itineraryHistory'`).
   */
  async history(locator: string, options: ReservationHistoryOptions = {}): Promise<ReservationHistoryResponse> {
    if (!isRecordLocator(locator)) {
      throw new TypeError('sabre-client: reservation.history necesita un localizador de 6 caracteres alfanuméricos en mayúscula');
    }
    const response = await this.#context.send(reservationHistoryRequest(locator, options));
    return parseReservationHistoryResponse(response);
  }
}
