import { SabreError } from './sabre-error';

/**
 * Se lanza cuando Sabre responde con un HTTP no-2xx a una llamada de API.
 *
 * `responseBody` conserva el cuerpo decodificado tal cual (JSON parseado
 * cuando es posible, si no el string crudo) porque el sobre de error de
 * Sabre varía entre APIs — no asumir una forma particular.
 */
export class SabreApiResponseError extends SabreError {
  readonly responseBody?: unknown;
  readonly responseHeaders?: Record<string, string>;

  constructor(
    message: string,
    statusCode: number,
    details?: string,
    responseBody?: unknown,
    responseHeaders?: Record<string, string>,
    options?: { cause?: unknown },
  ) {
    super(message, statusCode, details, options);
    this.name = 'SabreApiResponseError';
    this.responseBody = responseBody;
    this.responseHeaders = responseHeaders;
  }
}
