import { baseUrl as defaultBaseUrl, domain as defaultDomain } from '../config';
import { SabreAuthenticationError } from '../errors/sabre-authentication-error';
import { SabreNetworkError } from '../errors/sabre-network-error';
import { SabreTimeoutError } from '../errors/sabre-timeout-error';
import { createMemoryTokenStore } from './memory-store';
import { describeError, joinUrl, tryParseJson } from './token-endpoint-utils';
import type { StoredToken, TokenProvider, TokenStore } from './types';

/**
 * Credenciales para el endpoint v3 de Sabre (`grant_type=password`).
 *
 * A diferencia de v2, aquí no hay una unión de esquemas: v3 siempre
 * combina credenciales de usuario (van en el body) con credenciales de
 * app (`clientId`/`clientSecret`, van en el header `Authorization` como
 * Basic estándar de un solo base64).
 */
export interface OAuthV3Credentials {
  username: string;
  password: string;
  pcc: string;
  domain?: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Opciones para {@link createOAuthV3}. Mismos defaults que
 * {@link createOAuthV2 | OAuthV2Options} para `baseUrl`, `store` y
 * `expirySkewMs`.
 */
export interface OAuthV3Options {
  credentials: OAuthV3Credentials;
  baseUrl?: string;
  store?: TokenStore;
  expirySkewMs?: number;
}

const DEFAULT_EXPIRY_SKEW_MS = 60_000;
const TOKEN_PATH = '/v3/auth/token';

/** Subconjunto de la respuesta del endpoint v3 de Sabre que nos importa. */
interface SabreV3TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Devuelve un {@link TokenProvider} que obtiene y refresca un token
 * bearer de Sabre OAuth v3 vía el endpoint `/v3/auth/token`
 * (`grant_type=password`).
 *
 * Factory independiente de {@link createOAuthV2}: el endpoint, la forma
 * del request (credenciales de usuario en el body, no en el header) y los
 * casos límite difieren lo suficiente como para que compartir código
 * entre ambas sea peor que dos factories simples.
 */
export function createOAuthV3(opts: OAuthV3Options): TokenProvider {
  const store = opts.store ?? createMemoryTokenStore();
  const expirySkewMs = opts.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS;
  const authorization = `Basic ${encodeAppCredentials(opts.credentials)}`;
  const body = buildPasswordGrantBody(opts.credentials);
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
        body,
      });
    } catch (err) {
      const cause =
        err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
          ? new SabreTimeoutError('Timed out fetching Sabre v3 token', { cause: err })
          : new SabreNetworkError('Network failure fetching Sabre v3 token', { cause: err });
      throw new SabreAuthenticationError(
        `Failed to obtain Sabre v3 token: ${describeError(err)}`,
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
        `Sabre v3 token endpoint returned ${response.status} ${response.statusText}`,
        response.status,
        bodyText || response.statusText,
        parsedBody,
      );
    }

    let parsed: SabreV3TokenResponse;
    try {
      parsed = JSON.parse(bodyText) as SabreV3TokenResponse;
    } catch (err) {
      throw new SabreAuthenticationError(
        'Sabre v3 token endpoint returned a body that could not be parsed as JSON',
        response.status,
        bodyText,
        undefined,
        undefined,
        { cause: err },
      );
    }

    if (!parsed.access_token || typeof parsed.expires_in !== 'number') {
      throw new SabreAuthenticationError(
        'Sabre v3 token endpoint returned an unexpected response shape',
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

/** Basic estándar de un solo base64: `base64(clientId:clientSecret)`. */
function encodeAppCredentials(credentials: OAuthV3Credentials): string {
  return btoa(`${credentials.clientId}:${credentials.clientSecret}`);
}

function buildPasswordGrantBody(credentials: OAuthV3Credentials): string {
  const domain = credentials.domain ?? defaultDomain;
  const params = new URLSearchParams();
  params.set('grant_type', 'password');
  params.set('username', `${credentials.username}-${credentials.pcc}-${domain}`);
  params.set('password', credentials.password);
  return params.toString();
}

