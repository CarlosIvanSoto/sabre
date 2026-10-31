// Respuesta cruda de Sabre por request. Ver sabre-wiki/wiki/sdk/respuesta-cruda.md.

/**
 * Respuesta tal cual llegó de Sabre, para guardarla junto al resultado tipado.
 *
 * ⚠️ El `body` trae datos de pasajeros (PII). El SDK nunca lo envía al logger; quien usa
 * `onRawResponse` responde por dónde lo guarda.
 */
export interface SabreRawResponse {
  /** Método público sin `sabre.`, p. ej. `'booking.get'` o `'air.bargainFinderMax'`. */
  operation: string;
  protocol: 'rest';
  /** HTTP status del intento que se entrega. */
  status: number;
  headers: Headers;
  /** Texto tal cual llegó, sin parsear. `''` si vino vacío. */
  body: string;
  /** Intentos HTTP hechos, contando los reintentos (1 si no hubo). */
  attempts: number;
}

/**
 * Se llama una sola vez por operación, con la respuesta del último intento HTTP, antes de
 * devolver o de lanzar: también si termina en `SabreBusinessError` o `SabreGatewayError`. No
 * se llama si ningún intento tuvo respuesta HTTP, ni con las llamadas de token.
 *
 * Es síncrono y su retorno se ignora. Si lanza, el SDK lo atrapa, emite
 * `sabre.request.rawResponseHookFailed` al logger (sin el body) y la operación sigue.
 */
export type SabreRawResponseCallback = (raw: SabreRawResponse) => void;
