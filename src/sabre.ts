// Cliente REST. Ver sabre-wiki/wiki/sdk/arquitectura-clientes-transporte.md.
import { Air } from './air/air.js';
import { AuthManager } from './auth/auth-manager.js';
import { BookingManagement } from './booking/booking-management.js';
import { type ResolvedConfig, resolveConfig, type SabreConfig, type SabreEnvironment } from './config.js';
import { RestTransport } from './http/rest-transport.js';

export class Sabre {
  readonly #config: ResolvedConfig;
  readonly #transport: RestTransport;
  /** Servicios de Air: shopping, revalidación. */
  readonly air: Air;
  /** Booking Management: creación de reservas. */
  readonly booking: BookingManagement;

  constructor(config: SabreConfig) {
    this.#config = resolveConfig(config);
    this.#transport = new RestTransport(this.#config);
    // Toda request lleva `Authorization: Bearer <token>`, salvo la propia de token (`auth: false`).
    const auth = new AuthManager(this.#config, this.#transport);
    this.#transport.setAuthorizationProvider(auth.bearerProvider());
    this.air = new Air(this.#transport);
    this.booking = new BookingManagement(this.#transport);
  }

  get environment(): SabreEnvironment {
    return this.#config.environment;
  }

  get baseUrl(): string {
    return this.#config.baseUrl;
  }
}
