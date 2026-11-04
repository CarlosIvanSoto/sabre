// Un solo juego de variables para REST y SOAP (wiki: configuracion-logging-y-build, ADR-010):
//
//   SABRE_USERNAME       usuario EPR solo, sin PCC ni domain
//   SABRE_PCC            PCC de las credenciales (el group del EPR)
//   SABRE_DOMAIN         domain del EPR; vacío → AA
//   SABRE_PASSWORD       contraseña EPR
//   SABRE_CLIENT_ID      ClientID de la app: obligatorio con v3, opcional con v2
//   SABRE_CLIENT_SECRET  va junto con SABRE_CLIENT_ID
//   SABRE_AUTH_VERSION   v3 (default) o v2
//
// El SDK no lee variables de entorno; los scripts las leen aquí y arman `credentials` con
// `buildCredentials`, el mismo objeto para `Sabre` y `SabreLegacy`. Trabajar en otro PCC no es
// una credencial: es `targetPcc` (REST) o `pcc` (colas) en cada operación.
import { buildCredentials } from '../../dist/index.js';

/** Lee una variable de entorno; sin valor, corta el script con código 2. */
export function env(name, fallback) {
  const value = process.env[name] || fallback;
  if (value === undefined || value === '') {
    console.error(`falta la variable de entorno ${name}`);
    process.exit(2);
  }
  return value;
}

/** Variable opcional: vacía cuenta como ausente (`SABRE_DOMAIN=` en un `.env`). */
const optional = (name) => process.env[name] || undefined;

/**
 * `credentials` desde el entorno, más el usuario y el PCC sueltos y la lista de secretos que hay
 * que tapar antes de grabar o imprimir. `authVersion` por defecto sale de SABRE_AUTH_VERSION.
 * Con `app: false` no se leen SABRE_CLIENT_ID/SABRE_CLIENT_SECRET (sesión SOAP 1.0.0).
 */
export function envCredentials({ authVersion = optional('SABRE_AUTH_VERSION') ?? 'v3', app = true } = {}) {
  const user = env('SABRE_USERNAME');
  const pcc = env('SABRE_PCC');
  const domain = optional('SABRE_DOMAIN') ?? 'AA';
  const password = env('SABRE_PASSWORD');
  const clientId = app ? optional('SABRE_CLIENT_ID') : undefined;
  const clientSecret = app ? optional('SABRE_CLIENT_SECRET') : undefined;

  let credentials;
  try {
    credentials = buildCredentials({ authVersion, user, pcc, domain, password, clientId, clientSecret });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    console.error(`${error.message} (revisa SABRE_USERNAME, SABRE_PCC, SABRE_DOMAIN y SABRE_CLIENT_*)`);
    process.exit(2);
  }

  const secrets = [
    credentials.username,
    `${user}-${pcc}-${domain}`,
    `V1:${user}:${pcc}:${domain}`,
    user,
    pcc,
    password,
    clientId,
    clientSecret,
  ];
  return { authVersion, credentials, user, pcc, domain, secrets };
}
