// Módulo de dominio `sabre.air`. Ver sabre-wiki/wiki/sdk/convenciones-de-nombres-y-versionado.md.
import type { RestTransport } from '../http/rest-transport.js';
import {
  bargainFinderMax,
  type BargainFinderMaxRequest,
  type BargainFinderMaxResponse,
  type RequestOptions,
} from './bargain-finder-max.js';

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
}
