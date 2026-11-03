import { SabreError } from './sabre-error';

/**
 * Se lanza cuando falla la capa de red y no se recibió ninguna respuesta
 * HTTP de Sabre (DNS, conexión rechazada, TLS, reset a mitad de request).
 *
 * Para deadlines que expiran antes de recibir respuesta, ver
 * `SabreTimeoutError`. La causa original de `fetch` se preserva en `cause`.
 */
export class SabreNetworkError extends SabreError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, undefined, undefined, options);
    this.name = 'SabreNetworkError';
  }
}
