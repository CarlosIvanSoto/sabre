// La reserva dentro de una sesión SOAP: el historial (B1 de ADR-027) y la búsqueda por fecha de
// modificación (ADR-033).
import type { SoapResponse } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';
import {
  isRecordLocator,
  parseReservationHistoryResponse,
  type ReservationHistoryOptions,
  type ReservationHistoryResponse,
  reservationHistoryRequest,
} from './reservation-history.js';
import {
  parseSearchByUpdateDateResponse,
  resolveSearchByUpdateDateRequest,
  type SearchByUpdateDateOptions,
  type SearchByUpdateDateRequest,
  type SearchByUpdateDateResult,
  searchByUpdateDateRequest,
} from './search-by-update-date.js';

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
  /**
   * Search For Itineraries por fecha de modificación (`Trip_SearchRQ` 4.5.0, vista
   * `TripSearchTN`): los localizadores de los PNR del `pcc` que cambiaron en la ventana
   * `[from, to]`. La creación, un remark, la emisión y la cancelación cuentan como cambio
   * (2026-11-16). Solo trae localizadores: para saber qué cambió, se relee cada uno
   * (`getBooking`).
   *
   * - **Hora local.** Sabre lee `UpdateDate@After`/`@Before` en hora local, sin zona. El SDK
   *   convierte `from` y `to` (instantes) a la hora local de `timeZone` con `Intl`, que
   *   también resuelve la hora repetida o inexistente de un cambio de horario (México no tiene
   *   horario de verano desde 2022). Falta probar si la hora es la del PCC o la del host de Sabre
   *   (US Central): de marzo a noviembre difieren en 1 h. Si `sabreLocalOffsetMinutes` no
   *   coincide con el offset de `timeZone`, `warnings` trae `TIMEZONE_MISMATCH`.
   * - **Ventanas solapadas.** Conviene que cada pasada se solape con la anterior, al menos 1 h
   *   mientras no se confirme la zona, y deduplicar por localizador: tampoco se sabe si `After`
   *   y `Before` incluyen el borde, ni cuánto tarda un cambio en aparecer en producción (en CERT,
   *   menos de 2 min). El corte de la pasada siguiente es `respondedAt` menos el solape, no
   *   `respondedAt` a secas. `from` y `to` se mandan al segundo.
   * - **Truncado.** Una búsqueda síncrona trae a lo sumo 800 PNR (500 según el change log), sin
   *   páginas. Si hay más, `status` es `'truncated'`: no lanza; hay que partir la ventana.
   * - **`anyBranch`** es `true` por defecto: con `false` solo salen los PNR que creó el `pcc`.
   * - Un PNR cancelado sigue saliendo con `searchType: 'ACTIVE'` (CERT, 2026-11-16).
   * - `reservations[].updatedAt` no llega con `TripSearchTN`.
   * - Sabre corta la búsqueda a los 20 s. El SDK no trae timeout: si se pasa un `signal`, que
   *   sea de más de 20 s.
   *
   * Es una lectura: nunca manda `ResultAction` (podría colocar los PNR en una cola) y se
   * reintenta ante fallos de transporte, no ante errores de negocio. Un `Errors/Error` de Sabre
   * lanza `SabreTripSearchError` (un `SabreBusinessError` con `service: 'tripSearch'` y
   * `reason`: `NO_PRIMARY_CRITERIA`, `CRITERIA_TOO_WEAK`, `TOO_MANY_RESULTS`,
   * `SEARCH_TIMEOUT`, `PCC_NOT_ACCESSIBLE` o `UNKNOWN`). Un request con forma equivocada,
   * sin `timeZone` o con un string sin zona lanza `TypeError` sin red. La respuesta cruda llega
   * por `onRawResponse`.
   */
  async searchByUpdateDate(request: SearchByUpdateDateRequest, options: SearchByUpdateDateOptions = {}): Promise<SearchByUpdateDateResult> {
    const resolved = resolveSearchByUpdateDateRequest(request);
    const response = await this.#context.send(searchByUpdateDateRequest(resolved, options));
    return parseSearchByUpdateDateResponse(response, resolved);
  }
}
