// Cliente SOAP. Ver sabre-wiki/wiki/sdk/arquitectura-clientes-transporte.md y
// tier-3-sesion-y-colas-soap.md.
import { type ResolvedConfig, resolveConfig, type SabreConfig, type SabreEnvironment } from './config.js';
import { resolveSessionCredentials, type SessionCredentials } from './session/credentials.js';

export class SabreLegacy {
  readonly #config: ResolvedConfig;
  /** Usuario, PCC, domain y versión de `SessionCreateRQ`, validados al crear el cliente. */
  readonly #session: Readonly<SessionCredentials>;

  /**
   * Recibe la misma config que `Sabre`. Usuario, PCC y domain de la sesión salen de
   * `credentials.username` (`V1:<user>:<PCC>:<domain>` o `<user>-<PCC>-<domain>`), y la versión
   * de `SessionCreateRQ` de las credenciales: 2.0.0 con `clientId` y `clientSecret`, 1.0.0 sin
   * ellos. Una config inválida lanza `TypeError` aquí, sin llamar a la red.
   */
  constructor(config: SabreConfig) {
    this.#config = resolveConfig(config);
    this.#session = Object.freeze(resolveSessionCredentials(this.#config.credentials));
  }

  get environment(): SabreEnvironment {
    return this.#config.environment;
  }

  /** Endpoint SOAP del entorno. */
  get baseUrl(): string {
    return this.#config.soapBaseUrl;
  }
}
