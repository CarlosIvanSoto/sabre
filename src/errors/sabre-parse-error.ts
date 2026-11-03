import { SabreError } from './sabre-error';

/**
 * Se lanza cuando se recibió una respuesta 2xx pero el cuerpo no se pudo
 * parsear como JSON. Se distingue de `SabreApiResponseError`: aquella es
 * "Sabre dijo que la petición falló"; esta es "Sabre dijo que tuvo éxito
 * pero no pudimos leer la respuesta".
 */
export class SabreParseError extends SabreError {
  readonly responseBody?: unknown;

  constructor(message: string, responseBody?: unknown, options?: { cause?: unknown }) {
    super(message, undefined, undefined, options);
    this.name = 'SabreParseError';
    this.responseBody = responseBody;
  }
}
