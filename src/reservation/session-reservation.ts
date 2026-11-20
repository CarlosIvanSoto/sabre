// La reserva dentro de una sesión SOAP: el historial (B1 de ADR-027) y la búsqueda por fecha de
// modificación (ADR-033), y la confirmación de un cambio de horario (ADR-034).
import type { SoapResponse } from '../http/soap-transport.js';
import type { EventLogger } from '../logging/logger.js';
import type { SessionRequest } from '../session/session.js';
import {
  type ConfirmAirSegmentsOptions,
  type ConfirmAirSegmentsRequest,
  type ConfirmAirSegmentsResult,
  confirmAirSegments,
} from './confirm-air-segments.js';
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
  log?: EventLogger;
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
   * - **Demasiados resultados.** Una búsqueda síncrona trae a lo sumo `maxItems` PNR (hasta 800;
   *   500 según el change log), sin páginas. Si hay más, Sabre no corta: responde `200206` sin
   *   lista y el SDK lanza `SabreTripSearchError` con `reason: 'TOO_MANY_RESULTS'` (CERT,
   *   2026-11-16). Hay que partir la ventana y volver a pedir. `status: 'truncated'` cubre la
   *   advertencia `200006` y los contadores que describe la guía, que no se vieron en Sabre.
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

  /**
   * Confirma un cambio de horario (ADR-034): pasa a `HK` los segmentos `TK` del PNR con
   * `UpdateReservationRQ` `CONFIRM-ALL`, con el End Transaction en la misma llamada.
   *
   * 1. Relee el PNR con `GetReservationRQ` `Stateful`.
   * 2. Sin ningún `TK`, devuelve `status: 'noop'` sin escribir. Si los `TK` no son exactamente
   *    `expectedSegmentIds`, lanza `SabreReservationUpdateError` con `reason: 'SEGMENTS_CHANGED'`
   *    sin escribir.
   * 3. Manda `CONFIRM-ALL` y compara el PNR de la respuesta con el de la lectura: `changed` trae
   *    los segmentos que cambiaron de estado y `warnings` trae `NOT_APPLIED` si uno esperado no
   *    quedó en `HK`.
   *
   * - **`CONFIRM-ALL` confirma todos los `TK` del PNR**, no solo los esperados: por eso el
   *   chequeo del paso 2. Sabre no confirma uno solo por id.
   * - **Abierto (Q-139, Q-140):** si `CONFIRM-ALL` toca también los `KK`, y cómo se relaciona el
   *   id de segmento de STL (`segments[].id`) con el `itemId` de `booking.get`. Los ids de
   *   `expectedSegmentIds` son los de STL: salen de `segments` o de una lectura previa.
   * - **Nunca se reintenta.** Un `Errors/Error` de Sabre lanza `SabreReservationUpdateError`
   *   (`reason: 'SABRE_ERROR'`, con el `code` y el texto de Sabre) después de un
   *   `IgnoreTransaction`. Lo que pudo haber llegado a Sabre sin una respuesta legible lanza
   *   `SabreUncertainOutcomeError` (`operation: 'reservation.confirmAirSegments'`,
   *   `confirmationId`: el localizador; `reason`: `TRANSPORT`, `GATEWAY_5XX`, `UNPARSEABLE`,
   *   `ABORTED` o `END_TRANSACTION_PROBLEM`): **hay que releer el PNR antes de reintentar.**
   * - Un request con forma equivocada o `retry.maxRetries` distinto de 0 lanza `TypeError` sin red.
   *
   * `onRawResponse` y `onRawRequest` se llaman una vez por cada llamada a Sabre: la lectura, el
   * Update y, si hace falta, el `IgnoreTransaction` (los dos primeros traen PII).
   */
  confirmAirSegments(request: ConfirmAirSegmentsRequest, options: ConfirmAirSegmentsOptions = {}): Promise<ConfirmAirSegmentsResult> {
    return confirmAirSegments(this.#context, request, options);
  }
}
