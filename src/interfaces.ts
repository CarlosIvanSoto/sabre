import { TokenProvider } from "./auth/types";

export interface SabreOptions {
  username?: string,
  password?: string,
  organization?: string
  clientId?: string
  clientSecret?: string
  /**
   * TokenProvider opcional para autenticación automática (refresh
   * proactivo, cache y locking). Sin esta opción, el comportamiento es el
   * de siempre: token manual vía `setAuthorization()` o
   * `authentication.OAuthTokenV2()`/`V3()`. Construir con `createOAuthV2`
   * o `createOAuthV3`. Un token puesto a mano con `setAuthorization()`
   * tiene precedencia sobre el provider.
   */
  auth?: TokenProvider
}