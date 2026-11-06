// Request crudo que mandó el SDK, por operación. Ver
// sabre-wiki/wiki/proyectos/sabre-client/decisiones/request-crudo.md (ADR-029).
import type { SabreRawResponseCallback } from './raw-response.js';

/**
 * Lo que el SDK mandó por la red en el último intento de una operación.
 *
 * ⚠️ El `body` y la `url` traen datos de pasajeros (PII): localizadores, nombres, contactos. El
 * SDK nunca los envía al logger; quien usa `onRawRequest` responde por dónde los guarda.
 */
export interface SabreRawRequest {
  /** El mismo valor que en `onRawResponse`, p. ej. `'booking.get'` o `'queue.access'`. */
  operation: string;
  protocol: 'rest' | 'soap';
  /** `'GET'`, `'POST'`… En SOAP, siempre `'POST'`. */
  method: string;
  /** URL completa, con query string. */
  url: string;
  /** Los headers que se mandaron, sin `Authorization` (se quita el header entero). */
  headers: Headers;
  /**
   * El texto que se mandó, o `undefined` si el request no llevaba body. En REST va tal cual. En
   * SOAP es el sobre completo, con una sola modificación: el valor de cada `BinarySecurityToken`
   * va como `[REDACTED]`.
   */
  body: string | undefined;
  /** Intentos que llegaron a llamar a `fetch`, contando los reintentos (1 si no hubo). */
  attempts: number;
}

/**
 * Se llama una sola vez por operación, con el último intento que se mandó, antes de devolver o de
 * lanzar y antes que `onRawResponse`. A diferencia de este, se llama también si ningún intento tuvo
 * respuesta HTTP (fallo de red, `AbortError`). No se llama si la operación lanza antes de mandar
 * nada, ni con las llamadas de auth: el token de OAuth y `SessionCreateRQ` (`openSession`), que
 * llevan credenciales, y `SessionCloseRQ` (`close`).
 *
 * Es síncrono y su retorno se ignora. Si lanza, el SDK lo atrapa, emite
 * `sabre.request.rawRequestHookFailed` al logger (sin el body) y la operación sigue.
 */
export type SabreRawRequestCallback = (raw: SabreRawRequest) => void;

/** Lo que se guarda de un intento, hasta entregarlo. */
export type RawRequestCapture = Omit<SabreRawRequest, 'operation' | 'protocol' | 'attempts'>;

/** Los headers que se entregan: una copia, sin `Authorization`. */
export function rawRequestHeaders(headers: HeadersInit): Headers {
  const copy = new Headers(headers);
  copy.delete('Authorization');
  return copy;
}

/**
 * Los campos de una operación REST para el transporte: `operation` y los callbacks que haya. Sin
 * callbacks, nada.
 */
export function rawHooks(
  options: { onRawResponse?: SabreRawResponseCallback | undefined; onRawRequest?: SabreRawRequestCallback | undefined },
  operation: string,
): { operation?: string; onRawResponse?: SabreRawResponseCallback; onRawRequest?: SabreRawRequestCallback } {
  const { onRawResponse, onRawRequest } = options;
  if (onRawResponse === undefined && onRawRequest === undefined) return {};
  return {
    operation,
    ...(onRawResponse === undefined ? {} : { onRawResponse }),
    ...(onRawRequest === undefined ? {} : { onRawRequest }),
  };
}
