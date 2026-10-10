// Obtención del token ATK de OAuth Token Create.
// Ver sabre-wiki/wiki/sdk/renovacion-token-oauth.md y wiki/entities/oauth-token-create.md.
import type { ResolvedConfig } from '../config.js';
import { SabreGatewayError } from '../errors/index.js';
import type { RestTransport } from '../http/rest-transport.js';
import { buildTokenRequest } from './token-request.js';

export const TOKEN_SERVICE = 'oauthTokenCreate';

/** Token ATK obtenido de OAuth Token Create. */
export interface AccessToken {
  accessToken: string;
  /** Vida del token en segundos, tal cual llega en `expires_in`. */
  expiresIn: number;
  /** Momento de obtención, en ms desde epoch. */
  obtainedAt: number;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
}

export interface AuthManagerOptions {
  /** Solo para tests: reloj en ms. */
  now?: () => number;
}

export class AuthManager {
  readonly #config: ResolvedConfig;
  readonly #transport: RestTransport;
  readonly #now: () => number;

  constructor(config: ResolvedConfig, transport: RestTransport, options: AuthManagerOptions = {}) {
    this.#config = config;
    this.#transport = transport;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Pide un token nuevo. Los errores del endpoint (`invalid_request`/`invalid_client` 401,
   * `unauthorized` 403) salen como `SabreGatewayError` con `retryable: false`.
   */
  async fetchToken(): Promise<AccessToken> {
    const { path, authorization, body } = buildTokenRequest(this.#config.authVersion, this.#config.credentials);
    const response = await this.#transport.request<TokenResponse | undefined>({
      method: 'POST',
      path,
      service: TOKEN_SERVICE,
      // Pedir otro token no tiene efectos duplicados: 429/5xx entran en la política genérica.
      idempotent: true,
      auth: false,
      headers: { Authorization: authorization },
      body,
    });
    return this.#parse(response);
  }

  #parse(response: TokenResponse | undefined): AccessToken {
    const accessToken = response?.access_token;
    const expiresIn = response?.expires_in;
    if (typeof accessToken !== 'string' || accessToken === '' || typeof expiresIn !== 'number' || !(expiresIn > 0)) {
      throw new SabreGatewayError(`${TOKEN_SERVICE}: respuesta sin access_token/expires_in válidos`, {
        protocol: 'rest',
        status: 200,
        retryable: false,
        raw: response,
      });
    }
    return { accessToken, expiresIn, obtainedAt: this.#now() };
  }
}
