// Módulo de dominio `sabre.air`. Ver sabre-wiki/wiki/sdk/convenciones-de-nombres-y-versionado.md.
import type { RestTransport } from '../http/rest-transport.js';
import {
  bargainFinderMax,
  type BargainFinderMaxRequest,
  type BargainFinderMaxResponse,
  type RequestOptions,
} from './bargain-finder-max.js';
import { getSeats, type GetSeatsRequest, type GetSeatsResponse } from './get-seats.js';
import {
  revalidateItinerary,
  type RevalidateItineraryRequest,
  type RevalidateItineraryResponse,
} from './revalidate-itinerary.js';

export class Air {
  readonly #transport: RestTransport;

  /** @internal Lo construye el cliente `Sabre`. */
  constructor(transport: RestTransport) {
    this.#transport = transport;
  }

  /**
   * Bargain Finder Max v5: busca itinerarios de menor precio. Devuelve el
   * `groupedItineraryResponse` con las referencias ya resueltas.
   */
  bargainFinderMax(request: BargainFinderMaxRequest, options?: RequestOptions): Promise<BargainFinderMaxResponse> {
    return bargainFinderMax(this.#transport, request, options);
  }

  /**
   * Revalidate Itinerary v5: revalida disponibilidad y precio de un itinerario ya elegido,
   * sin sostener inventario. El request se arma con `buildRevalidateItineraryRequest`.
   */
  revalidateItinerary(
    request: RevalidateItineraryRequest,
    options?: RequestOptions,
  ): Promise<RevalidateItineraryResponse> {
    return revalidateItinerary(this.#transport, request, options);
  }

  /**
   * Get Seats v3: mapa de asientos con disponibilidad y precio. Sin `pnrLocator` va a
   * `byReservationPayload` (la reserva va en el request).
   */
  getSeats(request: GetSeatsRequest, options?: RequestOptions): Promise<GetSeatsResponse> {
    return getSeats(this.#transport, request, options);
  }
}
