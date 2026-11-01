// Credenciales de `SessionCreateRQ`, sacadas del mismo `username` EPR que autentica en REST.
// Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 1 y "Decisiones tomadas en la
// revisión") y wiki/entities/oauth-token-create.md (formatos del EPR).
import type { SabreCredentials, SabreCredentialsV2 } from '../config.js';

/** Versión de `SessionCreateRQ`: 2.0.0 con `clientId`/`clientSecret`, 1.0.0 sin ellos. */
export type SessionCreateVersion = '2.0.0' | '1.0.0';

/** Lo que pide el `wsse:UsernameToken` de `SessionCreateRQ`, ya separado. */
export interface SessionCredentials {
  version: SessionCreateVersion;
  /** Usuario EPR, sin PCC ni domain. */
  username: string;
  password: string;
  /** PCC: `Organization` del `UsernameToken` y `eb:CPAId`. Default de las operaciones de cola. */
  organization: string;
  domain: string;
  /** Solo en la 2.0.0. */
  clientId?: string;
  /** Solo en la 2.0.0. */
  clientSecret?: string;
}

/** 3 o 4 caracteres alfanuméricos. */
const PCC = /^[A-Za-z0-9]{3,4}$/;

/** Prefijo del EPR de OAuth v2: `V1:<user>:<PCC>:<domain>`. */
const V2_PREFIX = 'V1:';

const FORMATS = "'V1:<user>:<PCC>:<domain>' (OAuth v2) o '<user>-<PCC>-<domain>' (OAuth v3)";

function fail(message: string): never {
  throw new TypeError(`sabre-client: ${message}`);
}

/**
 * Separa usuario, PCC y domain del `username` EPR, leyendo de derecha a izquierda: el último
 * campo es el domain, el anterior el PCC y lo que queda es el usuario. Así un usuario con `-`
 * o `:` no rompe el formato. Los mensajes de error no repiten el `username`.
 */
export function parseEprUsername(username: string): { username: string; organization: string; domain: string } {
  const v2 = username.startsWith(V2_PREFIX);
  const fields = (v2 ? username.slice(V2_PREFIX.length) : username).split(v2 ? ':' : '-');
  if (fields.length < 3) fail(`credentials.username debe tener el formato ${FORMATS} para abrir una sesión SOAP`);

  const domain = fields.pop()!;
  const organization = fields.pop()!;
  const user = fields.join(v2 ? ':' : '-');
  if (user.trim() === '' || domain.trim() === '') {
    fail(`credentials.username debe tener el formato ${FORMATS} para abrir una sesión SOAP`);
  }
  if (!PCC.test(organization)) {
    fail('el PCC de credentials.username debe tener 3 o 4 caracteres alfanuméricos');
  }
  return { username: user, organization, domain };
}

/**
 * Credenciales de sesión a partir de las de la config. La versión sale de los datos, sin
 * fallback: con `clientId` y `clientSecret`, 2.0.0; sin ninguno, 1.0.0; con uno solo, error de
 * configuración.
 */
export function resolveSessionCredentials(
  credentials: Readonly<SabreCredentials | SabreCredentialsV2>,
): SessionCredentials {
  const { clientId, clientSecret, password } = credentials;
  if ((clientId === undefined) !== (clientSecret === undefined)) {
    fail('credentials.clientId y credentials.clientSecret van juntos: pasa los dos (SessionCreateRQ 2.0.0) o ninguno (1.0.0)');
  }
  const epr = parseEprUsername(credentials.username);
  if (clientId === undefined || clientSecret === undefined) return { version: '1.0.0', ...epr, password };

  if (typeof clientId !== 'string' || clientId.trim() === '') fail('credentials.clientId debe ser un string no vacío');
  if (typeof clientSecret !== 'string' || clientSecret.trim() === '') {
    fail('credentials.clientSecret debe ser un string no vacío');
  }
  return { version: '2.0.0', ...epr, password, clientId, clientSecret };
}
