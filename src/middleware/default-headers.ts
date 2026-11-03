import { conversationId, userAgent } from '../config';
import type { Middleware } from '../http/types';

/**
 * Devuelve un `Middleware` que agrega las cabeceras transversales que
 * Sabre recomienda para trazabilidad/soporte (`User-Agent`,
 * `Conversation-ID`), sin sobreescribir un valor que la petición ya traiga
 * explícito.
 */
export function createDefaultHeadersMiddleware(): Middleware {
  return (req, next) => {
    if (!req.headers['User-Agent']) {
      req.headers['User-Agent'] = userAgent;
    }
    if (!req.headers['Conversation-ID']) {
      req.headers['Conversation-ID'] = conversationId;
    }
    return next(req);
  };
}
