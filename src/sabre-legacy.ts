// Cliente SOAP. Ver sabre-wiki/wiki/sdk/arquitectura-clientes-transporte.md y
// tier-3-sesion-y-colas-soap.md.
import { type ResolvedConfig, resolveConfig, type SabreConfig, type SabreEnvironment } from './config.js';
import { SoapTransport } from './http/soap-transport.js';
import { resolveSessionCredentials, type SessionCredentials } from './session/credentials.js';
import { type OpenSessionOptions, openSession, type SabreSession } from './session/session.js';

export class SabreLegacy {
  readonly #config: ResolvedConfig;
  /** Usuario, PCC, domain y versión de `SessionCreateRQ`, validados al crear el cliente. */
  readonly #session: Readonly<SessionCredentials>;
  readonly #transport: SoapTransport;

  /**
   * Recibe la misma config que `Sabre`. Usuario, PCC y domain de la sesión salen de
   * `credentials.username` (`V1:<user>:<PCC>:<domain>` o `<user>-<PCC>-<domain>`), y la versión
   * de `SessionCreateRQ` de las credenciales: 2.0.0 con `clientId` y `clientSecret`, 1.0.0 sin
   * ellos. Una config inválida lanza `TypeError` aquí, sin llamar a la red.
   */
  constructor(config: SabreConfig) {
    this.#config = resolveConfig(config);
    this.#session = Object.freeze(resolveSessionCredentials(this.#config.credentials));
    this.#transport = new SoapTransport(this.#config);
  }

  get environment(): SabreEnvironment {
    return this.#config.environment;
  }

  /** Endpoint SOAP del entorno. */
  get baseUrl(): string {
    return this.#config.soapBaseUrl;
  }

  /**
   * Abre una sesión SOAP. Quien la abre la cierra: `try { … } finally { await session.close() }`.
   * Para el caso común, `withSession` la cierra sola. Con `keepAlive: true`, manda un ping a los
   * 13 minutos de inactividad.
   */
  openSession(options: OpenSessionOptions = {}): Promise<SabreSession> {
    return openSession(this.#transport, this.#session, options);
  }

  /**
   * Abre una sesión, se la presta al callback y la cierra en un `finally`. Devuelve lo mismo que
   * el callback y propaga su error. Si el cierre falla, emite `sabre.session.closeFailed` en
   * `warn` y no pisa el resultado ni el error del callback.
   */
  async withSession<T>(callback: (session: SabreSession) => Promise<T>): Promise<T> {
    const session = await this.openSession();
    let result: T;
    try {
      result = await callback(session);
    } catch (error) {
      await this.#closeQuietly(session);
      throw error;
    }
    await this.#closeQuietly(session);
    return result;
  }

  async #closeQuietly(session: SabreSession): Promise<void> {
    try {
      await session.close();
    } catch (error) {
      this.#transport.log.emit('warn', 'sabre.session.closeFailed', { error });
    }
  }
}
