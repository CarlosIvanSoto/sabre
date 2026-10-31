// Transporte REST del cliente `Sabre`: fetch JSON, detección de errores y reintentos.
// Ver sabre-wiki/wiki/sdk/manejo-y-mapeo-de-errores.md y politica-de-reintentos-y-backoff.md.
import { definedOnly, type ResolvedConfig } from '../config.js';
import { SabreError, SabreGatewayError } from '../errors/index.js';
import { EventLogger } from '../logging/logger.js';
import type { SabreRawResponse, SabreRawResponseCallback } from './raw-response.js';
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
  /** Se serializa como JSON, salvo `URLSearchParams`, que va como form-urlencoded. */
  body?: unknown;
  headers?: Record<string, string>;
  /** `false` para no pedir el header `Authorization` (p. ej. la propia request de token). */
  auth?: boolean;
  classify?: ResponseClassifier;
  retry?: Partial<RetryOptions>;
  signal?: AbortSignal;
  /** Método público sin `sabre.`, p. ej. `'booking.get'`. Lo recibe `onRawResponse`. */
  operation?: string;
  onRawResponse?: SabreRawResponseCallback;
}

/** Último intento con respuesta HTTP. Solo se lleva si hay `onRawResponse`. */
interface RawCapture {
  attempts: number;
  last?: { status: number; headers: Headers; body: string };
}

/** Fuente del header `Authorization` de los servicios (la implementa `AuthManager`). */
export interface AuthorizationProvider {
  /** Valor vigente del header, p. ej. `Bearer <token>`. */
  get(): Promise<string>;
  /** El gateway rechazó `authorization` con 401: descartarlo para que `get` traiga otro. */
  invalidate(authorization: string): void;
}

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

  /** Punto de enganche para `AuthManager`. */
  setAuthorizationProvider(provider: AuthorizationProvider | undefined): void {
    this.#authorization = provider;
  }

  async request<T>(request: RestRequest): Promise<T> {
    if (request.retry !== undefined) validateRetryOptions(request.retry, 'retry');
    const capture: RawCapture | undefined = request.onRawResponse === undefined ? undefined : { attempts: 0 };
    try {
      return await this.#attempts<T>(request, capture);
    } finally {
      // Antes de devolver o de lanzar, con el último intento que tuvo respuesta HTTP.
      if (capture?.last !== undefined) this.#deliverRaw(request, { ...capture.last, attempts: capture.attempts });
    }
  }

  async #attempts<T>(request: RestRequest, capture: RawCapture | undefined): Promise<T> {
    const retry = { ...this.#config.retry, ...definedOnly(request.retry ?? {}) };

    let reauthorized = false;
    for (let attempt = 0; ; attempt++) {
      // Fuera del try: un fallo al obtener el token ya pasó por sus propios reintentos.
      const authorization = await this.#authorizationFor(request);
      try {
        return await this.#send<T>(request, attempt, authorization, capture);
      } catch (error) {
        // Refresco reactivo: un solo reintento con token nuevo, fuera del presupuesto genérico.
        // Aplica también a escrituras: el 401 del gateway rechaza la request antes del proveedor.
        if (authorization !== undefined && !reauthorized && isUnauthorized(error)) {
          reauthorized = true;
          this.#authorization?.invalidate(authorization);
          this.#log.emit('warn', 'sabre.request.retry', {
            service: request.service,
            method: request.method,
            path: request.path,
            attempt: attempt + 1,
            reason: 'unauthorized',
            error: error as SabreError,
          });
          attempt--;
          continue;
        }
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

  /** Un callback que lanza no rompe la operación: Create Booking no puede perder su localizador. */
  #deliverRaw(request: RestRequest, raw: Omit<SabreRawResponse, 'operation' | 'protocol'>): void {
    const operation = request.operation ?? request.service;
    try {
      request.onRawResponse?.({ operation, protocol: 'rest', ...raw });
    } catch (error) {
      this.#log.emit('warn', 'sabre.request.rawResponseHookFailed', {
        service: request.service,
        operation,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  async #authorizationFor(request: RestRequest): Promise<string | undefined> {
    if (request.auth === false || this.#authorization === undefined) return undefined;
    return this.#authorization.get();
  }

  async #send<T>(
    request: RestRequest,
    attempt: number,
    authorization: string | undefined,
    capture: RawCapture | undefined,
  ): Promise<T> {
    const url = this.#url(request);
    const headers = new Headers({ Accept: 'application/json', ...request.headers });
    const form = request.body instanceof URLSearchParams;
    if (request.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', form ? 'application/x-www-form-urlencoded' : 'application/json');
    }
    if (authorization !== undefined) headers.set('Authorization', authorization);

    const logContext = { service: request.service, method: request.method, path: request.path, attempt };
    this.#log.emit('debug', 'sabre.request.start', logContext);
    const startedAt = Date.now();

    let response: Response;
    if (capture !== undefined) capture.attempts++;
    try {
      response = await this.#config.fetch(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: form ? String(request.body) : JSON.stringify(request.body) }),
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

    const text = await response.text();
    if (capture !== undefined) capture.last = { status: response.status, headers: response.headers, body: text };
    const body = parseBody(text);
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
function parseBody(text: string): unknown {
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

function isUnauthorized(error: unknown): boolean {
  return error instanceof SabreGatewayError && error.protocol === 'rest' && error.status === 401;
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
