import { SabreNetworkError } from '../errors/sabre-network-error';
import { SabreTimeoutError } from '../errors/sabre-timeout-error';
import type { Middleware, SabreRequest, SabreResponse } from './types';

/**
 * Construye una función que corre una petición a través de la cadena de
 * middleware dada y devuelve la respuesta final.
 *
 * La cadena se compone de afuera hacia adentro: el primer middleware del
 * arreglo envuelve al segundo, que envuelve al tercero, ... que envuelve al
 * terminador (la llamada `fetch` real). Invocar la función devuelta llama
 * al middleware más externo con un `next` que recorre el resto de la
 * cadena.
 *
 * El terminador está incrustado en este runner; no es un middleware — no
 * llama a `next`, así que tratarlo como tal mentiría sobre su forma. Hace
 * el `fetch`, normaliza la respuesta a `SabreResponse` y traduce fallos de
 * red/timeout a `SabreNetworkError`/`SabreTimeoutError`. Las capas
 * superiores (el middleware de mapeo de errores) traducen respuestas HTTP
 * no-2xx a los errores de Sabre correspondientes.
 */
export function buildChain(
  middlewares: readonly Middleware[],
): (req: SabreRequest) => Promise<SabreResponse> {
  const dispatch = (index: number, req: SabreRequest): Promise<SabreResponse> => {
    if (index >= middlewares.length) {
      return terminator(req);
    }
    const mw = middlewares[index];
    if (!mw) {
      return terminator(req);
    }
    return mw(req, (nextReq) => dispatch(index + 1, nextReq));
  };

  return (req) => dispatch(0, req);
}

/**
 * El terminador: hace la llamada de red real.
 *
 * Lee el cuerpo de la respuesta una sola vez y lo expone como string.
 * Traduce fallos a nivel de `fetch` a subclases de error de Sabre sin
 * filtrar los tipos subyacentes.
 */
async function terminator(req: SabreRequest): Promise<SabreResponse> {
  let nativeResponse: Response;
  try {
    nativeResponse = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: req.signal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw new SabreTimeoutError(`Request to ${req.url} was aborted`, { cause: err });
    }
    throw new SabreNetworkError(`Network failure calling ${req.url}: ${describeError(err)}`, {
      cause: err,
    });
  }

  let body: string;
  try {
    body = await nativeResponse.text();
  } catch (err) {
    throw new SabreNetworkError(
      `Failed to read response body from ${req.url}: ${describeError(err)}`,
      { cause: err },
    );
  }

  const headers: Record<string, string> = {};
  nativeResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    status: nativeResponse.status,
    statusText: nativeResponse.statusText,
    headers,
    body,
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
