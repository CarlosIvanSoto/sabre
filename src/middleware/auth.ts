import type { TokenProvider } from '../auth/types';
import type { Middleware } from '../http/types';

/**
 * Devuelve un `Middleware` que agrega `Authorization: Bearer <token>` a la
 * petición saliente si no trae ya un `Authorization` explícito.
 *
 * Recibe un getter (no el valor) porque `setAuthorization()` en `Sabre` se
 * llama después de construir el cliente, y la cadena se arma una sola vez
 * en el constructor.
 *
 * No toca la petición si ya trae `Authorization`: es lo que permite que
 * `auth()`/`authClient()` (que fijan su propio `Basic ...`) pasen por la
 * misma cadena sin que este middleware los pise.
 *
 * Es el camino manual por defecto (`sabre.setAuthorization(token)` /
 * `authentication.OAuthTokenV2()`). Cuando el consumidor pasa un
 * `TokenProvider` vía `SabreOptions.auth`, este middleware sigue instalado
 * pero por delante de {@link createAuthMiddleware}: un token puesto a
 * mano tiene precedencia sobre el provider automático.
 */
export function createBearerAuthMiddleware(getToken: () => string | null): Middleware {
  return (req, next) => {
    if (!req.headers.Authorization) {
      const token = getToken();
      if (token) {
        req.headers.Authorization = `Bearer ${token}`;
      }
    }
    return next(req);
  };
}

/**
 * Devuelve un `Middleware` que obtiene el token de un {@link TokenProvider}
 * (refresh proactivo, cache y locking ya resueltos por el provider) y
 * reintenta una vez ante un 401.
 *
 * Igual que {@link createBearerAuthMiddleware}, no toca la petición si ya
 * trae `Authorization` — así conviven con `auth()`/`authClient()` y con un
 * token puesto a mano por delante en la cadena.
 *
 * El reintento cubre el caso borde de un token que la cache local cree
 * válido pero que Sabre rechazó (rotado o revocado del lado del
 * servidor); el refresh proactivo del provider ya cubre el caso común
 * (token vencido). Si el segundo intento también da 401, se deja pasar
 * como respuesta normal para que el middleware de mapeo de errores lo
 * convierta en `SabreAuthenticationError`.
 */
export function createAuthMiddleware(provider: TokenProvider): Middleware {
  return async (req, next) => {
    if (req.headers.Authorization) {
      return next(req);
    }

    req.headers.Authorization = `Bearer ${await provider.getToken()}`;
    const firstResponse = await next(req);
    if (firstResponse.status !== 401) {
      return firstResponse;
    }

    await provider.invalidate();
    req.headers.Authorization = `Bearer ${await provider.getToken()}`;
    return next(req);
  };
}
