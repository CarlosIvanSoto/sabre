/**
 * Tipos de autenticación: `TokenProvider`, `TokenStore`, `StoredToken`.
 *
 * `TokenProvider` es lo que el middleware de auth llama para obtener un
 * token válido. Las implementaciones (`createOAuthV2`, `createOAuthV3`)
 * manejan los detalles del endpoint de token de Sabre al que apuntan.
 *
 * `TokenStore` es dónde vive el token cacheado. El store en memoria por
 * defecto sirve para despliegues de un solo proceso. Para despliegues
 * distribuidos donde varias instancias del cliente deberían compartir un
 * token, se puede proveer un store respaldado por Redis (o similar) que
 * implemente esta interfaz.
 */

/** Un token bearer más su expiración absoluta en epoch milliseconds. */
export interface StoredToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Almacenamiento del token bearer cacheado.
 *
 * Las implementaciones deben serializar los intentos de refresh
 * concurrentes vía `withLock` — cuando muchas peticiones compiten por un
 * token expirado, solo una de ellas debería llamar al endpoint de token;
 * las demás deberían leer el resultado que escribió la que ganó. El
 * patrón de double-checked locking se implementa en el provider; el store
 * solo provee el primitivo de lock.
 */
export interface TokenStore {
  get(): Promise<StoredToken | null>;
  set(token: StoredToken): Promise<void>;
  clear(): Promise<void>;

  /**
   * Corre `fn` mientras sostiene el lock de refresh del store. Otros
   * llamadores de `withLock` contra el mismo store esperan hasta que `fn`
   * resuelva o rechace.
   */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Lo que el middleware de auth necesita de cualquier implementación de
 * autenticación.
 *
 * `getToken` devuelve un token válido en este momento (refrescando de
 * forma proactiva si el cacheado expiró o está por expirar).
 *
 * `invalidate` lo llama el middleware de auth cuando una llamada de API
 * devolvió 401 a pesar de usar un token no-expirado localmente, indicando
 * que el token fue revocado o rotado del lado del servidor. La siguiente
 * llamada a `getToken` debe pedir un token nuevo en vez de devolver el
 * cacheado.
 */
export interface TokenProvider {
  getToken(): Promise<string>;
  invalidate(): Promise<void>;
}
