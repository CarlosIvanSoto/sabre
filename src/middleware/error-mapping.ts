import { SabreApiResponseError } from '../errors/sabre-api-response-error';
import { SabreAuthenticationError } from '../errors/sabre-authentication-error';
import type { Middleware } from '../http/types';

/**
 * Devuelve un `Middleware` que convierte respuestas HTTP no-2xx en
 * subclases tipadas de `SabreError`.
 *
 * - 401 y 403 se convierten en `SabreAuthenticationError`.
 * - Cualquier otra respuesta no-2xx se convierte en `SabreApiResponseError`.
 *
 * Los fallos de red y timeout se originan en el terminador de la cadena y
 * no son responsabilidad de este middleware.
 */
export function createErrorMappingMiddleware(): Middleware {
  return async (req, next) => {
    const res = await next(req);
    if (res.status >= 200 && res.status < 300) {
      return res;
    }

    const parsedBody = tryParseJson(res.body);
    const details = parsedBody !== undefined ? JSON.stringify(parsedBody) : res.statusText;
    const message = `Request failed with status ${res.status}`;

    if (res.status === 401 || res.status === 403) {
      throw new SabreAuthenticationError(message, res.status, details, parsedBody, res.headers);
    }

    throw new SabreApiResponseError(message, res.status, details, parsedBody, res.headers);
  };
}

function tryParseJson(body: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
