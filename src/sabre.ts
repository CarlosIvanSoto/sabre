// Cliente REST. Ver sabre-wiki/wiki/sdk/arquitectura-clientes-transporte.md.
import { AuthManager } from './auth/auth-manager.js';
import { type ResolvedConfig, resolveConfig, type SabreConfig, type SabreEnvironment } from './config.js';
import { RestTransport } from './http/rest-transport.js';

export class Sabre {
  readonly #config: ResolvedConfig;
  // Los módulos de servicio se montan sobre este transporte (Fases 2–4).
  readonly #transport: RestTransport;

  constructor(config: SabreConfig) {
    this.#config = resolveConfig(config);
    this.#transport = new RestTransport(this.#config);
    // Toda request lleva `Authorization: Bearer <token>`, salvo la propia de token (`auth: false`).
    const auth = new AuthManager(this.#config, this.#transport);
    this.#transport.setAuthorizationProvider(auth.bearerProvider());
  }

  get environment(): SabreEnvironment {
    return this.#config.environment;
  }

  get baseUrl(): string {
    return this.#config.baseUrl;
  }
}
