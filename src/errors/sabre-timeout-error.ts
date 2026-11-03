import { SabreError } from './sabre-error';

/**
 * Se lanza cuando una petición no completa antes de su deadline. Se
 * distingue de `SabreNetworkError` porque un timeout y un fallo de red
 * suelen requerir política de reintento y alertamiento distintos.
 *
 * El `AbortError` original se preserva en `cause`.
 */
export class SabreTimeoutError extends SabreError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, undefined, undefined, options);
    this.name = 'SabreTimeoutError';
  }
}
