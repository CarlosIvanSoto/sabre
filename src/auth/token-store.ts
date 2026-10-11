// Almacén de token inyectable por el consumidor. Ver sabre-wiki/wiki/sdk/renovacion-token-oauth.md,
// sección "Decisiones de la Fase 4" (decisión B).
import type { SabreAuthVersion, SabreCredentials, SabreCredentialsV2, SabreEnvironment } from '../config.js';

/** Token ATK tal cual se guarda: tiempos absolutos, para que otro proceso sepa cuánto le queda. */
export interface StoredToken {
  accessToken: string;
  /** Momento de obtención, en ms desde epoch. */
  obtainedAt: number;
  /** Momento de expiración, en ms desde epoch. */
  expiresAt: number;
}

/**
 * Almacén de token del consumidor (archivo, Redis, KV…). El SDK no trae implementaciones.
 *
 * `key` identifica la configuración (entorno, versión de OAuth y credencial, sin secretos):
 * un mismo store puede servir a varios clientes sin mezclar sus tokens. El token es un
 * secreto: protegerlo dentro del store es responsabilidad del consumidor.
 *
 * Si `get` o `set` lanzan, el SDK sigue con su caché en memoria: el store nunca rompe una llamada.
 */
export interface SabreTokenStore {
  get(key: string): Promise<StoredToken | undefined>;
  set(key: string, token: StoredToken): Promise<void>;
}

/**
 * `sabre-client:<environment>:<authVersion>:<hash>`, donde `hash` son los primeros 16 bytes
 * en hex del SHA-256 del username EPR (y del clientId en v3). No contiene secretos.
 */
export async function tokenStoreKey(
  environment: SabreEnvironment,
  authVersion: SabreAuthVersion,
  credentials: Readonly<SabreCredentials | SabreCredentialsV2>,
): Promise<string> {
  const identity = authVersion === 'v3' ? `${credentials.clientId}\n${credentials.username}` : credentials.username;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const hash = [...new Uint8Array(digest).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sabre-client:${environment}:${authVersion}:${hash}`;
}

/** Un valor de `get` que no tenga la forma de `StoredToken` se ignora. */
export function isStoredToken(value: unknown): value is StoredToken {
  if (typeof value !== 'object' || value === null) return false;
  const { accessToken, obtainedAt, expiresAt } = value as Record<string, unknown>;
  return (
    typeof accessToken === 'string' &&
    accessToken !== '' &&
    typeof obtainedAt === 'number' &&
    typeof expiresAt === 'number' &&
    Number.isFinite(obtainedAt) &&
    expiresAt > obtainedAt
  );
}
