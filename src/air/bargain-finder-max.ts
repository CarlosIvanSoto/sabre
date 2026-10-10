// Bargain Finder Max v5 (`POST /v5/offers/shop`).
// Ver sabre-wiki/wiki/entities/bargain-finder-max.md.
import { SabreBusinessError, SabreError } from '../errors/index.js';
import type { RestTransport } from '../http/rest-transport.js';
import type { RetryOptions } from '../http/retry.js';
import {
  denormalizeGroupedItineraryResponse,
  type GroupedItineraryResponse,
  type ItineraryMessage,
  type RawGroupedItineraryResponse,
} from './grouped-itinerary.js';
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
  /** Pisa los reintentos del cliente solo para esta request. */
  retry?: Partial<RetryOptions>;
}

/**
 * Catálogo de errores de BFM (guía oficial de errores). Se compara por substring del
 * `text` porque Sabre agrega detalle variable. Los temporales son reintentables: BFM es
 * una lectura idempotente y Sabre indica reintentar.
 */
const CATALOG: ReadonlyArray<{ code: string; retryable: boolean }> = [
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
  });
  return denormalizeGroupedItineraryResponse(body.groupedItineraryResponse, BARGAIN_FINDER_MAX_SERVICE);
}

/**
 * Paso 3 del orden de detección: un mensaje con `severity: Error` en
 * `groupedItineraryResponse.messages[]` es un `SabreBusinessError`. Supuesto pendiente de
 * confirmar con una respuesta real de error (el wiki no trae el body).
 */
export function classifyBargainFinderMax(body: unknown): SabreError | undefined {
  const response = isObject(body) ? body.groupedItineraryResponse : undefined;
  if (!isObject(response)) {
    return new SabreError(`${BARGAIN_FINDER_MAX_SERVICE}: respuesta malformada, falta groupedItineraryResponse`, {
      retryable: false,
      raw: body,
    });
  }
  const messages = Array.isArray(response.messages) ? (response.messages as Partial<ItineraryMessage>[]) : [];
  const error = messages.find((message) => message.severity?.toLowerCase() === 'error');
  if (error === undefined) return undefined;

  const text = typeof error.text === 'string' ? error.text : '';
  const known = CATALOG.find((entry) => text.toLowerCase().includes(entry.code.toLowerCase()));
  const code = known?.code ?? error.code ?? text;
  return new SabreBusinessError(`${BARGAIN_FINDER_MAX_SERVICE}: ${text || code}`, {
    service: BARGAIN_FINDER_MAX_SERVICE,
    code,
    retryable: known?.retryable ?? false,
    raw: body,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
