// Jerarquía de errores del SDK. Ver sabre-wiki/wiki/sdk/manejo-y-mapeo-de-errores.md.

export interface SabreErrorOptions {
  /** Si la política de reintentos puede volver a intentar la operación. */
  retryable: boolean;
  /** Fragmento de la respuesta original sin transformar (JSON parseado o nodo XML). */
  raw?: unknown;
  cause?: unknown;
}

/**
 * Base de todos los errores del SDK.
 *
 * `raw` puede contener credenciales o datos de pasajero: no es enumerable, así que
 * no aparece en `JSON.stringify`, spreads ni serializadores de logs, pero sigue
 * accesible como `error.raw` para debugging. No lo vuelques a un logger sin sanitizar.
 */
export class SabreError extends Error {
  override name = 'SabreError';
  readonly retryable: boolean;
  declare readonly raw: unknown;

  constructor(message: string, options: SabreErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.retryable = options.retryable;
    Object.defineProperty(this, 'raw', {
      value: options.raw,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  toJSON(): Record<string, unknown> {
    const fields: Record<string, unknown> = Object.fromEntries(Object.entries(this));
    return { ...fields, name: this.name, message: this.message };
  }
}

export type SabreProtocol = 'rest' | 'soap';

export interface SabreGatewayErrorOptions extends SabreErrorOptions {
  protocol: SabreProtocol;
  /** HTTP status de la respuesta, si la hubo. */
  status?: number;
  /** Código tal cual lo devuelve el gateway (`ERR.2SG.*`, `USG_*`), si viene en el body. */
  code?: string;
}

/** Error de transporte/gateway (`ERR.2SG.*` + HTTP status en REST, `USG_*` en SOAP). */
export class SabreGatewayError extends SabreError {
  override name = 'SabreGatewayError';
  readonly protocol: SabreProtocol;
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(message: string, options: SabreGatewayErrorOptions) {
    super(message, options);
    this.protocol = options.protocol;
    this.status = options.status;
    this.code = options.code;
  }
}

export interface SabreOrchestrationErrorOptions extends Omit<SabreErrorOptions, 'retryable'> {
  /** `SP.PROVIDER_ERROR` o `SP.INTERNAL_ERROR`. */
  code: string;
}

/**
 * Error de servicio orquestado (`SP.*`), viaja dentro de una respuesta 200.
 * `SP.PROVIDER_ERROR` es reintentable; `SP.INTERNAL_ERROR` (y cualquier otro) no.
 */
export class SabreOrchestrationError extends SabreError {
  override name = 'SabreOrchestrationError';
  readonly code: string;

  constructor(message: string, options: SabreOrchestrationErrorOptions) {
    super(message, { ...options, retryable: options.code === 'SP.PROVIDER_ERROR' });
    this.code = options.code;
  }
}

export interface SabreServiceErrorOptions extends Omit<SabreErrorOptions, 'retryable'> {
  /** Servicio que originó el error, p. ej. `'createBooking'`. */
  service: string;
  /** Código tal cual lo documenta Sabre, sin normalizar. */
  code: string;
}

export interface SabreBusinessErrorOptions extends SabreServiceErrorOptions {
  /**
   * Solo para códigos que Sabre documenta como temporales en un servicio de lectura
   * (p. ej. `Transmission timeout` de Bargain Finder Max). Por defecto `false`.
   * La política de reintentos igual exige que la operación sea idempotente.
   */
  retryable?: boolean;
  /** Avisos que llegaron junto con el error (p. ej. `category: WARNING` de Create Booking). */
  warnings?: readonly SabreWarning[];
}

/**
 * Error del catálogo propio de un servicio. No es reintentable, salvo los códigos
 * temporales de servicios de lectura que se marcan con `retryable: true`.
 */
export class SabreBusinessError extends SabreError {
  override name = 'SabreBusinessError';
  readonly service: string;
  readonly code: string;
  readonly warnings: readonly SabreWarning[];

  constructor(message: string, options: SabreBusinessErrorOptions) {
    super(message, { ...options, retryable: options.retryable ?? false });
    this.service = options.service;
    this.code = options.code;
    this.warnings = options.warnings ?? [];
  }
}

/**
 * Advertencia de un servicio (p. ej. `category: WARNING` de Create Booking, soft errors
 * de End Transaction): no es un fallo fatal. Nunca se reintenta automáticamente.
 */
export class SabreWarning extends SabreError {
  override name = 'SabreWarning';
  readonly service: string;
  readonly code: string;

  constructor(message: string, options: SabreServiceErrorOptions) {
    super(message, { ...options, retryable: false });
    this.service = options.service;
    this.code = options.code;
  }
}
