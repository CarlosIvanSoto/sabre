/**
 * Tipos HTTP usados por la cadena de middleware.
 *
 * Son deliberadamente mínimos y están desacoplados de los tipos nativos de
 * `fetch` (`Request`, `Response`, `Headers`). La cadena opera sobre datos
 * planos para que un middleware pueda inspeccionar y modificar la petición
 * o la respuesta sin tocar objetos específicos de transporte.
 */

/** Métodos HTTP que usa el cliente. */
export type SabreHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Una petición fluyendo por la cadena de middleware.
 *
 * `url` es la URL absoluta a solicitar (ya incluye el baseUrl + el path).
 * `headers` es un mapa plano string-a-string; cada petición trae el suyo,
 * nunca se comparte una instancia mutable entre llamadas concurrentes.
 * `body` es el cuerpo ya serializado (string para JSON o form-urlencoded;
 * `undefined` cuando no aplica).
 */
export interface SabreRequest {
  method: SabreHttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/**
 * Una respuesta regresando por la cadena de middleware.
 *
 * `body` es el cuerpo decodificado como string; el runner de la cadena lo
 * lee una sola vez para que ni los middlewares ni el consumidor tengan que
 * lidiar con un stream ya consumido.
 */
export interface SabreResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Un middleware del pipeline de petición/respuesta.
 *
 * Puede inspeccionar o modificar `req`, llamar a `next` para pasarlo al
 * resto de la cadena, y luego inspeccionar o modificar la respuesta que
 * `next` devuelve. También puede saltarse `next` (p.ej. para responder con
 * un valor cacheado) o envolver la llamada en un try/catch (p.ej. para
 * mapear errores).
 *
 * La cadena se invoca de afuera hacia adentro: cada middleware ve como
 * `next` al resto de la cadena más el terminador (quien hace el `fetch`
 * real).
 */
export type Middleware = (
  req: SabreRequest,
  next: (req: SabreRequest) => Promise<SabreResponse>,
) => Promise<SabreResponse>;
