// Arma el `credentials` de la config a partir de un solo juego de partes. El mismo objeto sirve
// para `Sabre` (REST) y para `SabreLegacy` (SOAP); la versión de OAuth solo cambia el formato
// del username. Ver sabre-wiki/wiki/proyectos/sabre-client/decisiones/configuracion-logging-y-build.md
// (ADR-010, #134) y wiki/entities/oauth-token-create.md (formato del EPR por versión).
import type { SabreAuthVersion, SabreCredentials, SabreCredentialsV2 } from '../config.js';
import { isPseudoCityCode } from '../session/credentials.js';

interface BuildCredentialsBase {
  /** Usuario EPR, sin PCC ni domain. */
  user: string;
  /** PCC del EPR (el *group*): 3 o 4 caracteres alfanuméricos. */
  pcc: string;
  /** Domain del EPR. Default `'AA'`. */
  domain?: string;
  /** Contraseña EPR. */
  password: string;
}

/** Partes para OAuth Token Create v3 (default): `clientId` y `clientSecret` son obligatorios. */
export interface BuildCredentialsOptionsV3 extends BuildCredentialsBase {
  authVersion?: 'v3';
  clientId: string;
  clientSecret: string;
}

/**
 * Partes para OAuth Token Create v2: `clientId`/`clientSecret` son opcionales. REST los ignora,
 * pero si vienen los dos, `SabreLegacy` abre la sesión con `SessionCreateRQ` 2.0.0.
 */
export interface BuildCredentialsOptionsV2 extends BuildCredentialsBase {
  authVersion: 'v2';
  clientId?: string;
  clientSecret?: string;
}

export type BuildCredentialsOptions = BuildCredentialsOptionsV3 | BuildCredentialsOptionsV2;

const DEFAULT_DOMAIN = 'AA';

function fail(message: string): never {
  throw new TypeError(`sabre-client: ${message}`);
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} es requerido y debe ser un string no vacío`);
}

/**
 * Arma el `credentials` para `Sabre` y `SabreLegacy` a partir del usuario, el PCC, el domain y
 * la contraseña del EPR, más `clientId`/`clientSecret` cuando los hay. El username queda como
 * `<user>-<PCC>-<domain>` (v3) o `V1:<user>:<PCC>:<domain>` (v2). No lee variables de entorno
 * ni toca la red; un dato inválido lanza `TypeError` sin repetir secretos.
 */
export function buildCredentials(options: BuildCredentialsOptionsV3): SabreCredentials;
export function buildCredentials(options: BuildCredentialsOptionsV2): SabreCredentialsV2;
export function buildCredentials(options: BuildCredentialsOptions): SabreCredentials | SabreCredentialsV2;
export function buildCredentials(options: BuildCredentialsOptions): SabreCredentials | SabreCredentialsV2 {
  if (typeof options !== 'object' || options === null) fail('buildCredentials recibe un objeto');

  const authVersion: SabreAuthVersion = options.authVersion ?? 'v3';
  if (authVersion !== 'v3' && authVersion !== 'v2') {
    fail(`authVersion debe ser 'v3' o 'v2' (recibido: ${JSON.stringify(authVersion)})`);
  }

  const { user, pcc, password, clientId, clientSecret } = options;
  const domain = options.domain ?? DEFAULT_DOMAIN;
  requireString(user, 'user');
  requireString(password, 'password');
  if (!isPseudoCityCode(pcc)) fail('pcc debe tener 3 o 4 caracteres alfanuméricos');
  requireString(domain, 'domain');
  // El username se lee de derecha a izquierda: un separador en el domain lo partiría mal.
  if (/[-:]/.test(domain)) fail("domain no puede contener '-' ni ':'");

  if ((clientId === undefined) !== (clientSecret === undefined)) {
    fail('clientId y clientSecret van juntos: pasa los dos o ninguno');
  }
  if (authVersion === 'v3' || clientId !== undefined) {
    requireString(clientId, authVersion === 'v3' ? 'clientId (requerido con authVersion v3)' : 'clientId');
    requireString(clientSecret, authVersion === 'v3' ? 'clientSecret (requerido con authVersion v3)' : 'clientSecret');
  }

  const username = authVersion === 'v3' ? `${user}-${pcc}-${domain}` : `V1:${user}:${pcc}:${domain}`;
  return clientId === undefined ? { username, password } : { clientId, clientSecret: clientSecret!, username, password };
}
