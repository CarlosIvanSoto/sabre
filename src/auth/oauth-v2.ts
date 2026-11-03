import { baseUrl as defaultBaseUrl, domain as defaultDomain } from '../config';
import { SabreAuthenticationError } from '../errors/sabre-authentication-error';
import { SabreNetworkError } from '../errors/sabre-network-error';
import { SabreTimeoutError } from '../errors/sabre-timeout-error';
import { createMemoryTokenStore } from './memory-store';
import { describeError, joinUrl, tryParseJson } from './token-endpoint-utils';
import type { StoredToken, TokenProvider, TokenStore } from './types';

/**
 * Las dos formas de credenciales que Sabre acepta en el endpoint v2 de
 * token, cada una produciendo un header `Authorization: Basic ...`
 * distinto:
 *
 * - `'user'` — esquema EPR (usuario/contraseña/PCC). Es una cuenta de
 *   agencia tradicional.
 * - `'client'` — esquema `clientId`/`clientSecret` de una app registrada
 *   con Sabre.
 *
 * Ninguno reemplaza al otro: qué esquema usar lo determina el tipo de
 * entitlement que Sabre le dio a la cuenta, no una preferencia de diseño.
 */
export type OAuthV2Credentials =
  | { type: 'user'; username: string; password: string; pcc: string; domain?: string }
  | { type: 'client'; clientId: string; clientSecret: string };

/**
 * Opciones para {@link createOAuthV2}.
 *
 * `baseUrl` por defecto es el mismo `baseUrl` que usa el resto del
 * cliente (`src/config.ts`, con fallback a `SABRE_REST_URL`).
 *
 * `store` es la cache del token obtenido. Por defecto un store en
 * memoria; proveer uno respaldado por Redis (o similar) para despliegues
 * distribuidos.
 *
 * `expirySkewMs` es cuán temprano tratar un token como expirado, para
 * nunca entregar uno que muere en los milisegundos siguientes. Default
 * 60_000 ms.
 */
export interface OAuthV2Options {
  credentials: OAuthV2Credentials;
  baseUrl?: string;
  store?: TokenStore;
  expirySkewMs?: number;
}

const DEFAULT_EXPIRY_SKEW_MS = 60_000;
const TOKEN_PATH = '/v2/auth/token';

/** Subconjunto de la respuesta del endpoint v2 de Sabre que nos importa. */
interface SabreV2TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Devuelve un {@link TokenProvider} que obtiene y refresca un token
 * bearer de Sabre OAuth v2 vía el endpoint `/v2/auth/token`, con
 * `grant_type=client_credentials`.
 *
 * Los refresh se serializan a través del lock del store para que
 * llamadores concurrentes no golpeen todos a la vez el endpoint de token.
 */
export function createOAuthV2(opts: OAuthV2Options): TokenProvider {
  const store = opts.store ?? createMemoryTokenStore();
  const expirySkewMs = opts.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS;
  const authorization = `Basic ${encodeCredentials(opts.credentials)}`;
  const tokenUrl = joinUrl(opts.baseUrl ?? defaultBaseUrl, TOKEN_PATH);

  const isExpired = (token: StoredToken): boolean => {
    return Date.now() >= token.expiresAt - expirySkewMs;
  };

  const fetchFreshToken = async (): Promise<StoredToken> => {
    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
    } catch (err) {
      const cause =
        err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
          ? new SabreTimeoutError('Timed out fetching Sabre v2 token', { cause: err })
          : new SabreNetworkError('Network failure fetching Sabre v2 token', { cause: err });
      throw new SabreAuthenticationError(
        `Failed to obtain Sabre v2 token: ${describeError(err)}`,
        undefined,
        undefined,
        undefined,
        undefined,
        { cause },
      );
    }

    const bodyText = await response.text().catch(() => '');

    if (!response.ok) {
      const parsedBody = tryParseJson(bodyText);
      throw new SabreAuthenticationError(
        `Sabre v2 token endpoint returned ${response.status} ${response.statusText}`,
        response.status,
        bodyText || response.statusText,
        parsedBody,
      );
    }

    let parsed: SabreV2TokenResponse;
    try {
      parsed = JSON.parse(bodyText) as SabreV2TokenResponse;
    } catch (err) {
      throw new SabreAuthenticationError(
        'Sabre v2 token endpoint returned a body that could not be parsed as JSON',
        response.status,
        bodyText,
        undefined,
        undefined,
        { cause: err },
      );
    }

    if (!parsed.access_token || typeof parsed.expires_in !== 'number') {
      throw new SabreAuthenticationError(
        'Sabre v2 token endpoint returned an unexpected response shape',
        response.status,
      );
    }

    return {
      accessToken: parsed.access_token,
      expiresAt: Date.now() + parsed.expires_in * 1000,
    };
  };

  return {
    async getToken(): Promise<string> {
      const cached = await store.get();
      if (cached && !isExpired(cached)) {
        return cached.accessToken;
      }

      return store.withLock(async () => {
        // Doble chequeo dentro del lock: otro llamador pudo haber
        // refrescado mientras esperábamos. Usar su resultado si sigue
        // siendo válido.
        const recheck = await store.get();
        if (recheck && !isExpired(recheck)) {
          return recheck.accessToken;
        }

        const fresh = await fetchFreshToken();
        await store.set(fresh);
        return fresh.accessToken;
      });
    },

    async invalidate(): Promise<void> {
      await store.clear();
    },
  };
}

/**
 * Construye el header `Authorization` para cada esquema de credenciales.
 *
 * - `'user'` (EPR): `base64( base64("V1:"+user+":"+pcc+":"+domain) + ":" +
 *   base64(password) )`. Es el esquema que ya usaba `Sabre.getSecret()`.
 * - `'client'`: **doble** base64 —
 *   `base64( base64(clientId) + ":" + base64(clientSecret) )`. No es un
 *   error de transcripción: el Basic estándar de un solo base64 de
 *   `clientId:clientSecret` devuelve 401 en el endpoint v2 de Sabre.
 */
function encodeCredentials(credentials: OAuthV2Credentials): string {
  if (credentials.type === 'client') {
    const encodedId = btoa(credentials.clientId);
    const encodedSecret = btoa(credentials.clientSecret);
    return btoa(`${encodedId}:${encodedSecret}`);
  }

  const domain = credentials.domain ?? defaultDomain;
  const userId = btoa(`V1:${credentials.username}:${credentials.pcc}:${domain}`);
  return btoa(`${userId}:${btoa(credentials.password)}`);
}

