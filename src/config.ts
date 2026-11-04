// Config explícita del consumidor; el SDK nunca lee variables de entorno.
// Ver sabre-wiki/wiki/sdk/configuracion-logging-y-build.md.
import type { SabreTokenStore } from './auth/token-store.js';
import { DEFAULT_RETRY, type RetryOptions, validateRetryOptions } from './http/retry.js';
import type { SabreLogger } from './logging/index.js';

export type SabreEnvironment = 'sandbox' | 'production';

export type SabreAuthVersion = 'v3' | 'v2';

/** Credenciales para OAuth Token Create v3: Client ID/Secret más usuario EPR. */
export interface SabreCredentials {
  /**
   * Versión de OAuth para la que se armaron. `buildCredentials` la pone; la config la usa cuando
   * no trae su propio `authVersion`.
   */
  authVersion?: 'v3';
  clientId: string;
  clientSecret: string;
  /** Usuario EPR. */
  username: string;
  /** Contraseña EPR. */
  password: string;
}

/** Credenciales para OAuth Token Create v2: solo EPR; `clientId`/`clientSecret` se ignoran. */
export interface SabreCredentialsV2 {
  /**
   * Versión de OAuth para la que se armaron. `buildCredentials` la pone, y con ella la config no
   * necesita repetir `authVersion: 'v2'`.
   */
  authVersion?: 'v2';
  clientId?: string;
  clientSecret?: string;
  /** Usuario EPR. */
  username: string;
  /** Contraseña EPR. */
  password: string;
}

interface SabreBaseConfig {
  environment: SabreEnvironment;
  /** Campo reservado: PCC vs iPCC sigue sin resolver. */
  pcc?: string;
  logger?: SabreLogger;
  /** Reintentos por defecto del cliente; cada request puede pisarlos. */
  retry?: Partial<RetryOptions>;
  /** `fetch` a usar en lugar del global (tests, proxies, runtimes edge). */
  fetch?: typeof fetch;
  /**
   * Almacén del token para reutilizarlo entre procesos (scripts, serverless). Sin él, el
   * token se cachea solo en memoria.
   */
  tokenStore?: SabreTokenStore;
}

/** OAuth Token Create v3 (por defecto). */
export interface SabreConfigV3 extends SabreBaseConfig {
  authVersion?: 'v3';
  credentials: SabreCredentials;
}

/** OAuth Token Create v2. */
export interface SabreConfigV2 extends SabreBaseConfig {
  authVersion: 'v2';
  credentials: SabreCredentialsV2;
}

/**
 * OAuth Token Create v2 sin `authVersion` en la config: la versión sale de las credenciales,
 * como las devuelve `buildCredentials({ authVersion: 'v2', … })`.
 */
export interface SabreConfigV2FromCredentials extends SabreBaseConfig {
  authVersion?: never;
  credentials: SabreCredentialsV2 & { authVersion: 'v2' };
}

/**
 * Config del cliente, discriminada por `authVersion`: el de la config o, si falta, el de
 * `credentials`. Sin ninguno de los dos, es v3.
 */
export type SabreConfig = SabreConfigV3 | SabreConfigV2 | SabreConfigV2FromCredentials;

export const BASE_URLS: Readonly<Record<SabreEnvironment, string>> = Object.freeze({
  sandbox: 'https://api.cert.platform.sabre.com',
  production: 'https://api.platform.sabre.com',
});

/** Endpoints SOAP de `SabreLegacy` (ver entornos-y-certificacion). */
export const SOAP_BASE_URLS: Readonly<Record<SabreEnvironment, string>> = Object.freeze({
  sandbox: 'https://webservices.cert.platform.sabre.com',
  production: 'https://webservices.platform.sabre.com',
});

/** Config validada y con defaults aplicados. */
export interface ResolvedConfig {
  credentials: Readonly<SabreCredentials | SabreCredentialsV2>;
  environment: SabreEnvironment;
  baseUrl: string;
  soapBaseUrl: string;
  authVersion: SabreAuthVersion;
  pcc: string | undefined;
  logger: SabreLogger | undefined;
  retry: Readonly<RetryOptions>;
  fetch: typeof fetch;
  tokenStore: SabreTokenStore | undefined;
}

const LOGGER_METHODS = ['debug', 'info', 'warn', 'error'] as const;

function fail(message: string): never {
  throw new TypeError(`sabre-client: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} es requerido y debe ser un string no vacío`);
}

export function resolveConfig(config: SabreConfig): ResolvedConfig {
  if (!isObject(config)) fail('la config debe ser un objeto');

  const { environment } = config;
  if (environment !== 'sandbox' && environment !== 'production') {
    fail(`environment debe ser 'sandbox' o 'production' (recibido: ${JSON.stringify(environment)})`);
  }

  const configVersion = config.authVersion ?? undefined;
  if (configVersion !== undefined && configVersion !== 'v3' && configVersion !== 'v2') {
    fail(`authVersion debe ser 'v3' o 'v2' (recibido: ${JSON.stringify(configVersion)})`);
  }

  const { credentials } = config;
  if (!isObject(credentials)) fail('credentials es requerido');
  // La marca que pone `buildCredentials`: evita repetir `authVersion` en la config (#148).
  const credentialsVersion = credentials.authVersion ?? undefined;
  if (credentialsVersion !== undefined && credentialsVersion !== 'v3' && credentialsVersion !== 'v2') {
    fail(`credentials.authVersion debe ser 'v3' o 'v2' (recibido: ${JSON.stringify(credentialsVersion)})`);
  }
  if (configVersion !== undefined && credentialsVersion !== undefined && configVersion !== credentialsVersion) {
    fail(`authVersion '${configVersion}' no coincide con credentials.authVersion '${credentialsVersion}'`);
  }
  const authVersion: SabreAuthVersion = configVersion ?? credentialsVersion ?? 'v3';
  requireString(credentials.username, 'credentials.username');
  requireString(credentials.password, 'credentials.password');
  if (authVersion === 'v3') {
    requireString(credentials.clientId, 'credentials.clientId (requerido con authVersion v3)');
    requireString(credentials.clientSecret, 'credentials.clientSecret (requerido con authVersion v3)');
  }

  if (config.pcc !== undefined) requireString(config.pcc, 'pcc');

  const { logger } = config;
  if (logger !== undefined) {
    if (!isObject(logger)) fail('logger debe ser un objeto con debug/info/warn/error');
    for (const method of LOGGER_METHODS) {
      if (typeof logger[method] !== 'function') fail(`logger.${method} debe ser una función`);
    }
  }

  if (config.retry !== undefined) {
    if (!isObject(config.retry)) fail('retry debe ser un objeto');
    validateRetryOptions(config.retry, 'retry');
  }

  const { tokenStore } = config;
  if (tokenStore !== undefined) {
    if (!isObject(tokenStore) || typeof tokenStore.get !== 'function' || typeof tokenStore.set !== 'function') {
      fail('tokenStore debe ser un objeto con get(key) y set(key, token)');
    }
  }

  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('no hay fetch disponible: pasa config.fetch');

  return {
    credentials: Object.freeze({ ...credentials }),
    environment,
    baseUrl: BASE_URLS[environment],
    soapBaseUrl: SOAP_BASE_URLS[environment],
    authVersion,
    pcc: config.pcc,
    logger,
    retry: Object.freeze({ ...DEFAULT_RETRY, ...definedOnly(config.retry ?? {}) }),
    // Enlazado al global para evitar "Illegal invocation" en algunos runtimes.
    fetch: config.fetch ?? globalThis.fetch.bind(globalThis),
    tokenStore,
  };
}

/** Quita claves con valor `undefined` para que no pisen los defaults. */
export function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
