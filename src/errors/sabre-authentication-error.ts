import { SabreError } from './sabre-error';

/**
 * Se lanza cuando Sabre rechaza la petición por motivos de autenticación:
 * un 401 o 403 en la respuesta, ya sea del endpoint de token o de una
 * llamada de API regular con credenciales inválidas/expiradas.
 *
 * `statusCode` está poblado cuando el fallo fue una respuesta HTTP de
 * Sabre (p.ej. 401 del endpoint de token) y `undefined` cuando el fallo
 * ocurrió antes de recibir cualquier respuesta (red, timeout) — ver
 * `createOAuthV2`/`createOAuthV3` en `src/auth/`, que lanzan este error
 * también para esos casos, preservando la causa original en `cause`.
 */
export class SabreAuthenticationError extends SabreError {
  readonly responseBody?: unknown;
  readonly responseHeaders?: Record<string, string>;

  constructor(
    message: string,
    statusCode?: number,
    details?: string,
    responseBody?: unknown,
    responseHeaders?: Record<string, string>,
    options?: { cause?: unknown },
  ) {
    super(message, statusCode, details, options);
    this.name = 'SabreAuthenticationError';
    this.responseBody = responseBody;
    this.responseHeaders = responseHeaders;
  }
}
