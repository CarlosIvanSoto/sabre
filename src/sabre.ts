// Cliente REST. Ver sabre-wiki/wiki/sdk/arquitectura-clientes-transporte.md.
import { type ResolvedConfig, resolveConfig, type SabreConfig, type SabreEnvironment } from './config.js';
import { RestTransport } from './http/rest-transport.js';

export class Sabre {
  readonly #config: ResolvedConfig;
  // Los módulos de servicio y `AuthManager` se montan sobre este transporte (Fases 1–4).
  readonly #transport: RestTransport;

  constructor(config: SabreConfig) {
    this.#config = resolveConfig(config);
    this.#transport = new RestTransport(this.#config);
  }

  get environment(): SabreEnvironment {
    return this.#config.environment;
  }

  get baseUrl(): string {
    return this.#config.baseUrl;
  }
}
