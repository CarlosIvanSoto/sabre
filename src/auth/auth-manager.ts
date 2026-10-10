// Obtención del token ATK de OAuth Token Create.
// Ver sabre-wiki/wiki/sdk/renovacion-token-oauth.md y wiki/entities/oauth-token-create.md.
import type { ResolvedConfig } from '../config.js';
import { SabreGatewayError } from '../errors/index.js';
import type { AuthorizationProvider, RestTransport } from '../http/rest-transport.js';
import { EventLogger } from '../logging/logger.js';
import { buildTokenRequest } from './token-request.js';

export const TOKEN_SERVICE = 'oauthTokenCreate';

/** Margen de refresco proactivo: 1 h antes de expirar (o media vida si el token dura menos). */
export const REFRESH_THRESHOLD_S = 3600;

export type TokenRefreshReason = 'initial' | 'proactive' | 'reactive';

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

/**
 * Cachea el token en memoria, lo renueva antes de que expire y comparte una sola
 * petición en vuelo entre requests concurrentes. Interno en v0.3.0.
 */
export class AuthManager {
  readonly #config: ResolvedConfig;
  readonly #transport: RestTransport;
  readonly #now: () => number;
  readonly #log: EventLogger;
  #token: AccessToken | undefined;
  #inFlight: Promise<AccessToken> | undefined;
  /** El último token cacheado fue rechazado con 401 (el próximo refresco es reactivo). */
  #invalidated = false;

  constructor(config: ResolvedConfig, transport: RestTransport, options: AuthManagerOptions = {}) {
    this.#config = config;
    this.#transport = transport;
    this.#now = options.now ?? Date.now;
    this.#log = new EventLogger(config.logger);
  }

  /** Token vigente; pide uno nuevo si no hay o si cruzó el umbral de refresco. */
  async getToken(): Promise<string> {
    const token = this.#token;
    if (token !== undefined && !this.#needsRefresh(token)) return token.accessToken;
    const reason = token !== undefined ? 'proactive' : this.#invalidated ? 'reactive' : 'initial';
    return (await this.#refresh(reason)).accessToken;
  }

  /**
   * Descarta `accessToken` tras un 401 de un servicio. Si el caché ya tiene otro token
   * (otra request lo renovó), no hace nada: los 401 concurrentes comparten un refresco.
   */
  invalidate(accessToken: string): void {
    if (this.#token?.accessToken !== accessToken) return;
    this.#token = undefined;
    this.#invalidated = true;
  }

  /** Adaptador de salida para el transporte REST: `Authorization: Bearer <token>`. */
  bearerProvider(): AuthorizationProvider {
    return {
      get: async () => `Bearer ${await this.getToken()}`,
      invalidate: (authorization) => this.invalidate(authorization.replace(/^Bearer /, '')),
    };
  }

  #needsRefresh(token: AccessToken): boolean {
    const thresholdMs = Math.min(REFRESH_THRESHOLD_S, token.expiresIn / 2) * 1000;
    return this.#now() >= token.obtainedAt + token.expiresIn * 1000 - thresholdMs;
  }

  /** Una sola petición en vuelo: las llamadas concurrentes esperan la misma promesa. */
  #refresh(reason: TokenRefreshReason): Promise<AccessToken> {
    this.#inFlight ??= this.fetchToken()
      .then((token) => {
        this.#token = token;
        this.#invalidated = false;
        this.#log.emit('info', 'sabre.auth.token.refresh', {
          authVersion: this.#config.authVersion,
          reason,
          expiresIn: token.expiresIn,
        });
        return token;
      })
      .finally(() => {
        this.#inFlight = undefined;
      });
    return this.#inFlight;
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
