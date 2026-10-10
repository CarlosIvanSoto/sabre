// Armado de la request de OAuth Token Create, una estrategia por versión.
// Ver sabre-wiki/wiki/entities/oauth-token-create.md: v2 y v3 no son intercambiables.
import type { SabreAuthVersion, SabreCredentials, SabreCredentialsV2 } from '../config.js';

export interface TokenRequest {
  path: string;
  /** Valor del header `Authorization` (`Basic ...`). */
  authorization: string;
  body: URLSearchParams;
}

/** v3: `Basic base64(clientId:clientSecret)` y el EPR en el body con `grant_type=password`. */
export function buildTokenRequestV3(credentials: SabreCredentials): TokenRequest {
  return {
    path: '/v3/auth/token',
    authorization: `Basic ${base64(`${credentials.clientId}:${credentials.clientSecret}`)}`,
    body: new URLSearchParams({
      grant_type: 'password',
      username: credentials.username,
      password: credentials.password,
    }),
  };
}

/** v2: doble Base64 sobre el EPR y su password, con `grant_type=client_credentials`. */
export function buildTokenRequestV2(credentials: SabreCredentialsV2): TokenRequest {
  return {
    path: '/v2/auth/token',
    authorization: `Basic ${base64(`${base64(credentials.username)}:${base64(credentials.password)}`)}`,
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  };
}

export function buildTokenRequest(
  authVersion: SabreAuthVersion,
  credentials: SabreCredentials | SabreCredentialsV2,
): TokenRequest {
  // `resolveConfig` ya exige clientId/clientSecret cuando la versión es v3.
  return authVersion === 'v3'
    ? buildTokenRequestV3(credentials as SabreCredentials)
    : buildTokenRequestV2(credentials);
}

/** Base64 de los bytes UTF-8 de `text`, solo con Web APIs (sin `Buffer`). */
export function base64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
