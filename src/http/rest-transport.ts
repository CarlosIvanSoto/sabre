// Transporte REST del cliente `Sabre`: fetch JSON, detección de errores y reintentos.
// Ver sabre-wiki/wiki/sdk/manejo-y-mapeo-de-errores.md y politica-de-reintentos-y-backoff.md.
import { definedOnly, type ResolvedConfig } from '../config.js';
import { SabreError, SabreGatewayError } from '../errors/index.js';
import { EventLogger } from '../logging/logger.js';
import { type RetryOptions, retryDelay, shouldRetry, validateRetryOptions } from './retry.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Status de gateway REST reintentables (ver errores-comunes-api). */
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);

/**
 * Pasos 2–3 del orden de detección, aportados por cada servicio: recibe el body de una
 * respuesta 2xx y devuelve el error de su catálogo (orquestado, negocio o warning), o
 * `undefined` si la respuesta es data válida.
 */
export type ResponseClassifier = (body: unknown, response: Response) => SabreError | undefined;

export interface RestRequest {
  method: HttpMethod;
  /** Ruta relativa a la base URL, p. ej. `/v5/offers/shop`. */
  path: string;
  /** Nombre del servicio para errores y logs, p. ej. `'bargainFinderMax'`. */
  service: string;
  /**
   * Si la operación se puede repetir sin efectos duplicados. Las escrituras
   * (Create Booking, End Transaction) van en `false` y nunca se reintentan.
   */
  idempotent: boolean;
  query?: Record<string, string | number | boolean | undefined>;
  /** Se serializa como JSON. */
  body?: unknown;
  headers?: Record<string, string>;
  /** `false` para no pedir el header `Authorization` (p. ej. la propia request de token). */
  auth?: boolean;
  classify?: ResponseClassifier;
  retry?: Partial<RetryOptions>;
  signal?: AbortSignal;
}

/** Devuelve el valor del header `Authorization` (lo provee `AuthManager`). */
export type AuthorizationProvider = () => Promise<string>;

export interface RestTransportOptions {
  authorization?: AuthorizationProvider;
  /** Solo para tests: fuente de aleatoriedad del jitter. */
  random?: () => number;
  /** Solo para tests: espera entre reintentos. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class RestTransport {
  readonly #config: ResolvedConfig;
  readonly #log: EventLogger;
  readonly #random: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  #authorization: AuthorizationProvider | undefined;

  constructor(config: ResolvedConfig, options: RestTransportOptions = {}) {
    this.#config = config;
    this.#log = new EventLogger(config.logger);
    this.#authorization = options.authorization;
    this.#random = options.random ?? Math.random;
    this.#sleep = options.sleep ?? sleep;
  }

  /** Punto de enganche para `AuthManager` (Fase 1.3). */
  setAuthorizationProvider(provider: AuthorizationProvider | undefined): void {
    this.#authorization = provider;
  }

  async request<T>(request: RestRequest): Promise<T> {
    if (request.retry !== undefined) validateRetryOptions(request.retry, 'retry');
    const retry = { ...this.#config.retry, ...definedOnly(request.retry ?? {}) };

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#send<T>(request, attempt);
      } catch (error) {
        if (attempt >= retry.maxRetries || !shouldRetry(error, request.idempotent)) throw error;
        const delayMs = retryDelay(attempt, retry.baseDelayMs, this.#random);
        this.#log.emit('warn', 'sabre.request.retry', {
          service: request.service,
          method: request.method,
          path: request.path,
          attempt: attempt + 1,
          maxRetries: retry.maxRetries,
          delayMs,
          error: error as SabreError,
        });
        await this.#sleep(delayMs, request.signal);
      }
    }
  }

  async #send<T>(request: RestRequest, attempt: number): Promise<T> {
    const url = this.#url(request);
    const headers = new Headers({ Accept: 'application/json', ...request.headers });
    if (request.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (request.auth !== false && this.#authorization !== undefined) {
      headers.set('Authorization', await this.#authorization());
    }

    const logContext = { service: request.service, method: request.method, path: request.path, attempt };
    this.#log.emit('debug', 'sabre.request.start', logContext);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.#config.fetch(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (cause) {
      if (isAbort(cause, request.signal)) throw cause;
      const error = new SabreGatewayError(`${request.service}: fallo de red (${describe(cause)})`, {
        protocol: 'rest',
        retryable: true,
        cause,
      });
      this.#log.emit('error', 'sabre.request.end', { ...logContext, durationMs: Date.now() - startedAt, error });
      throw error;
    }

    const body = await readBody(response);
    const endContext = { ...logContext, status: response.status, durationMs: Date.now() - startedAt };

    // Paso 1: HTTP status de gateway.
    if (!response.ok) {
      const error = gatewayError(request.service, response.status, body);
      this.#log.emit('error', 'sabre.request.end', { ...endContext, error });
      throw error;
    }

    // Pasos 2–3: catálogo propio del servicio.
    const serviceError = request.classify?.(body, response);
    if (serviceError !== undefined) {
      this.#log.emit('warn', 'sabre.request.end', { ...endContext, error: serviceError });
      throw serviceError;
    }

    // Paso 4: data.
    this.#log.emit('info', 'sabre.request.end', endContext);
    return body as T;
  }

  #url(request: RestRequest): string {
    const path = request.path.startsWith('/') ? request.path : `/${request.path}`;
    const url = new URL(path, this.#config.baseUrl);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }
}

/** Body parseado como JSON; si no es JSON, el texto tal cual; vacío → `undefined`. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function gatewayError(service: string, status: number, body: unknown): SabreGatewayError {
  const code = extractCode(body);
  return new SabreGatewayError(`${service}: HTTP ${status}${code === undefined ? '' : ` ${code}`}`, {
    protocol: 'rest',
    status,
    retryable: RETRYABLE_STATUS.has(status),
    raw: body,
    ...(code === undefined ? {} : { code }),
  });
}

/**
 * Best-effort: el campo exacto del código `ERR.2SG.*` no está confirmado
 * (issue de fuente #21). Se prueban `errorCode` y `error`.
 */
function extractCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  for (const key of ['errorCode', 'error'] as const) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
