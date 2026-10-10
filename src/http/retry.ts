// Política de reintentos. Ver sabre-wiki/wiki/sdk/politica-de-reintentos-y-backoff.md.
import { SabreError } from '../errors/index.js';

export interface RetryOptions {
  /** Reintentos después de la primera llamada (3 → hasta 4 llamadas en total). */
  maxRetries: number;
  /** Delay base del backoff exponencial, en milisegundos. */
  baseDelayMs: number;
}

export const DEFAULT_RETRY: Readonly<RetryOptions> = Object.freeze({ maxRetries: 3, baseDelayMs: 500 });

/** Piso mínimo de espera que documenta Sabre para 429/5xx de gateway. */
export const MIN_RETRY_DELAY_MS = 500;

/** Full jitter: aleatorio entre 0 y `baseDelayMs · 2^retry`, con piso de 500 ms. */
export function retryDelay(retry: number, baseDelayMs: number, random: () => number = Math.random): number {
  return Math.max(MIN_RETRY_DELAY_MS, Math.floor(random() * baseDelayMs * 2 ** retry));
}

/** Solo se reintenta un `SabreError` con `retryable: true` en una operación idempotente. */
export function shouldRetry(error: unknown, idempotent: boolean): boolean {
  return idempotent && error instanceof SabreError && error.retryable;
}

export function validateRetryOptions(retry: Partial<RetryOptions>, where: string): void {
  if (retry.maxRetries !== undefined && !(Number.isInteger(retry.maxRetries) && retry.maxRetries >= 0)) {
    throw new TypeError(`sabre-client: ${where}.maxRetries debe ser un entero >= 0`);
  }
  if (retry.baseDelayMs !== undefined && !(Number.isFinite(retry.baseDelayMs) && retry.baseDelayMs >= 0)) {
    throw new TypeError(`sabre-client: ${where}.baseDelayMs debe ser un número >= 0`);
  }
}
