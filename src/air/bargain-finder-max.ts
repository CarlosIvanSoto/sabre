// Bargain Finder Max v5 (`POST /v5/offers/shop`).
// Ver sabre-wiki/wiki/entities/bargain-finder-max.md.
import type { SabreError } from '../errors/index.js';
import type { SabreRawResponseCallback } from '../http/raw-response.js';
import type { RestTransport } from '../http/rest-transport.js';
import type { RetryOptions } from '../http/retry.js';
import {
  denormalizeGroupedItineraryResponse,
  type GroupedItineraryResponse,
  type RawGroupedItineraryResponse,
} from './grouped-itinerary.js';
import { classifyItineraryMessages, type ItineraryMessageCatalogEntry } from './itinerary-messages.js';
import type { OtaAirLowFareSearchRq } from './low-fare-search-request.js';

export const BARGAIN_FINDER_MAX_SERVICE = 'bargainFinderMax';
const PATH = '/v5/offers/shop';

/** Body de Bargain Finder Max v5, tal cual lo documenta Sabre. */
export interface BargainFinderMaxRequest {
  OTA_AirLowFareSearchRQ: OtaAirLowFareSearchRq;
}

/** `groupedItineraryResponse` con las referencias ya resueltas. */
export type BargainFinderMaxResponse = GroupedItineraryResponse;

export interface RequestOptions {
  signal?: AbortSignal;
  /** Respuesta cruda del último intento HTTP. El body trae PII: ver `SabreRawResponse`. */
  onRawResponse?: SabreRawResponseCallback;
  /** Pisa los reintentos del cliente solo para esta request. */
  retry?: Partial<RetryOptions>;
}

/**
 * Catálogo de errores de BFM (guía oficial de errores). Se compara por substring del
 * `text` porque Sabre agrega detalle variable. Los temporales son reintentables: BFM es
 * una lectura idempotente y Sabre indica reintentar.
 */
export const BARGAIN_FINDER_MAX_CATALOG: ReadonlyArray<ItineraryMessageCatalogEntry> = [
  { code: 'No Availability', retryable: false },
  { code: 'NO FLIGHT SCHEDULES FOR QUALIFIERS USED', retryable: false },
  { code: 'Connection reset by peer', retryable: true },
  { code: 'Transmission timeout', retryable: true },
  { code: 'Insufficient resources', retryable: true },
  { code: 'MAX NBR COMBINATIONS EXCEEDED', retryable: true },
];

export async function bargainFinderMax(
  transport: RestTransport,
  request: BargainFinderMaxRequest,
  options: RequestOptions = {},
): Promise<BargainFinderMaxResponse> {
  if (typeof request !== 'object' || request === null || typeof request.OTA_AirLowFareSearchRQ !== 'object') {
    throw new TypeError('sabre-client: bargainFinderMax espera { OTA_AirLowFareSearchRQ: { ... } }');
  }
  const body = await transport.request<{ groupedItineraryResponse: RawGroupedItineraryResponse }>({
    method: 'POST',
    path: PATH,
    service: BARGAIN_FINDER_MAX_SERVICE,
    // POST, pero de solo lectura: se puede reintentar sin efectos duplicados.
    idempotent: true,
    body: request,
    classify: classifyBargainFinderMax,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onRawResponse === undefined
      ? {}
      : { operation: 'air.bargainFinderMax', onRawResponse: options.onRawResponse }),
  });
  return denormalizeGroupedItineraryResponse(body.groupedItineraryResponse, BARGAIN_FINDER_MAX_SERVICE);
}

/** Ver `classifyItineraryMessages`. */
export function classifyBargainFinderMax(body: unknown): SabreError | undefined {
  return classifyItineraryMessages(body, BARGAIN_FINDER_MAX_SERVICE, BARGAIN_FINDER_MAX_CATALOG);
}
