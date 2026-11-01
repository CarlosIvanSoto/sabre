// Ciclo de vida de la sesión SOAP: `SessionCreateRQ` (2.0.0 o 1.0.0) y `SessionCloseRQ` 1.0.1,
// con uso exclusivo. Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 1 y
// decisiones de la revisión), wiki/entities/create-session.md y gestion-de-sesion-soap.md.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreGatewayError, SabreSessionError, type SabreSessionErrorKind } from '../errors/index.js';
import { type SoapRequest, type SoapResponse, type SoapSecurity, type SoapTransport, xmlEscape } from '../http/soap-transport.js';
import type { SessionCredentials } from './credentials.js';

const OTA_NAMESPACE = 'http://www.opentravel.org/OTA/2002/11';
const SWS_NAMESPACE = 'http://webservices.sabre.com';

/** Lo que una operación pide al transporte. La sesión agrega `CPAId`, `ConversationId` y el token. */
export type SessionRequest = Omit<SoapRequest, 'cpaId' | 'conversationId' | 'security'>;

/**
 * Método interno por el que las operaciones de la sesión (cola, ping) llaman a Sabre. Va con un
 * símbolo que no se exporta del paquete para no sumar superficie pública.
 */
export const sessionSend: unique symbol = Symbol('sabre-client.session.send');

function fail(message: string): never {
  throw new TypeError(`sabre-client: ${message}`);
}

/**
 * `USG_*` que dejan la sesión inutilizable (punto 4). Ninguna fuente documenta el código de una
 * sesión vencida: `'expired'` se mapea tentativamente y se confirma en #95.
 */
const SESSION_ERROR_KINDS: ReadonlyMap<string, SabreSessionErrorKind> = new Map([
  ['USG_RESOURCE_UNAVAILABLE', 'limit'],
  ['USG_INVALID_SESSION', 'invalid'],
  ['USG_INVALID_SECURITY_TOKEN', 'expired'],
  ['USG_AUTHENTICATION_FAILED', 'expired'],
  ['USG_RESOURCE_BLOCKED', 'blocked'],
]);

/**
 * Al abrir todavía no hay sesión que pueda vencer ni usarse en paralelo: ahí un
 * `USG_AUTHENTICATION_FAILED` son credenciales mal configuradas, y sigue como `SabreGatewayError`.
 */
const OPEN_ERROR_KINDS: ReadonlySet<SabreSessionErrorKind> = new Set(['limit', 'blocked']);

/** Convierte un fault de sesión en `SabreSessionError`; cualquier otro error sale igual. */
export function toSessionError(error: unknown, allowed?: ReadonlySet<SabreSessionErrorKind>): unknown {
  if (!(error instanceof SabreGatewayError) || error instanceof SabreSessionError) return error;
  if (error.protocol !== 'soap' || error.code === undefined) return error;
  const kind = SESSION_ERROR_KINDS.get(error.code);
  if (kind === undefined || (allowed !== undefined && !allowed.has(kind))) return error;
  return new SabreSessionError(error.message, {
    kind,
    code: error.code,
    retryable: error.retryable,
    raw: error.raw,
    cause: error.cause,
    ...(error.status === undefined ? {} : { status: error.status }),
  });
}

/**
 * Una sesión SOAP abierta con `SessionCreateRQ`. Es exclusiva: Sabre no admite llamadas
 * concurrentes en la misma sesión (`USG_INVALID_SESSION`), así que una segunda llamada mientras
 * otra está en vuelo lanza `TypeError` sin llamar a la red. Se cierra con `close()`, o sola si
 * se abrió con `withSession`.
 */
export class SabreSession {
  readonly #transport: SoapTransport;
  readonly #pcc: string;
  readonly #conversationId: string;
  readonly #security: SoapSecurity;
  #busy = false;
  #closing: Promise<void> | undefined;
  /** El `SabreSessionError` que dejó la sesión inutilizable. */
  #unusable: SabreSessionError | undefined;

  static {
    // `await using` es un extra: solo si el runtime tiene el símbolo (Node 22 no tiene la
    // sintaxis nativa, y algunos runtimes edge no tienen el símbolo).
    installAsyncDispose(this.prototype, (Symbol as { asyncDispose?: symbol }).asyncDispose);
  }

  /** @internal Se crea con `SabreLegacy.openSession()`. */
  constructor(internal: { transport: SoapTransport; pcc: string; conversationId: string; token: string }) {
    this.#transport = internal.transport;
    this.#pcc = internal.pcc;
    this.#conversationId = internal.conversationId;
    this.#security = { binarySecurityToken: internal.token };
  }

  /**
   * Cierra la sesión con `SessionCloseRQ`: Sabre descarta el AAA e invalida el token. Es
   * idempotente: las llamadas siguientes devuelven la misma promesa, sin volver a la red. Si el
   * cierre falla, la sesión queda cerrada igual del lado del SDK; la de Sabre vence sola a los
   * 15 minutos. Una sesión inutilizable (ver `SabreSessionError`) se cierra sin red: Sabre ya no
   * la reconoce.
   */
  close(options: RequestOptions = {}): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    if (this.#busy) return Promise.reject(new TypeError('sabre-client: session busy'));
    if (this.#unusable !== undefined) {
      this.#closing = Promise.resolve();
      return this.#closing;
    }
    this.#busy = true;
    this.#closing = this.#transport
      .request({
        service: 'sessionClose',
        action: 'SessionCloseRQ',
        payload: `<SessionCloseRQ Version="1.0.1"><POS><Source PseudoCityCode="${xmlEscape(this.#pcc)}"/></POS></SessionCloseRQ>`,
        ...this.#envelopeFields(),
        // Solo se reintenta ante `USG_*_BUSY`: tras un fallo de red no se sabe si ya se cerró.
        idempotent: false,
        operation: 'close',
        ...options,
      })
      .then(
        () => this.#transport.log.emit('info', 'sabre.session.close', { pseudoCityCode: this.#pcc }),
        (error: unknown) => {
          throw this.#markUnusable(error);
        },
      )
      .finally(() => {
        this.#busy = false;
      });
    return this.#closing;
  }

  /** @internal Una llamada a Sabre dentro de la sesión, con uso exclusivo. */
  async [sessionSend](request: SessionRequest): Promise<SoapResponse> {
    if (this.#closing !== undefined) fail('session closed');
    if (this.#unusable !== undefined) {
      throw new TypeError(`sabre-client: session unusable (${this.#unusable.kind})`, { cause: this.#unusable });
    }
    if (this.#busy) fail('session busy');
    this.#busy = true;
    try {
      return await this.#transport.request({ ...request, ...this.#envelopeFields() });
    } catch (error) {
      throw this.#markUnusable(error);
    } finally {
      this.#busy = false;
    }
  }

  /** Un error de sesión deja la sesión inutilizable. No se reabre sola: el cursor ya se perdió. */
  #markUnusable(error: unknown): unknown {
    const mapped = toSessionError(error);
    if (mapped instanceof SabreSessionError) this.#unusable = mapped;
    return mapped;
  }

  #envelopeFields(): Pick<SoapRequest, 'cpaId' | 'conversationId' | 'security'> {
    return { cpaId: this.#pcc, conversationId: this.#conversationId, security: this.#security };
  }
}

/** Define `[Symbol.asyncDispose]` como `close()`, si el runtime tiene el símbolo. */
export function installAsyncDispose(target: object, symbol: symbol | undefined): void {
  if (symbol === undefined) return;
  Object.defineProperty(target, symbol, {
    value(this: SabreSession): Promise<void> {
      return this.close();
    },
    configurable: true,
    writable: true,
  });
}

/** Cuerpo de `SessionCreateRQ`: 2.0.0 en el namespace de Sabre, 1.0.0 en el de OTA. */
export function sessionCreatePayload(credentials: Pick<SessionCredentials, 'version' | 'organization'>): string {
  const pos = `<POS><Source PseudoCityCode="${xmlEscape(credentials.organization)}"/></POS>`;
  return credentials.version === '2.0.0'
    ? `<SessionCreateRQ xmlns="${SWS_NAMESPACE}" Version="2.0.0">${pos}</SessionCreateRQ>`
    : `<SessionCreateRQ xmlns="${OTA_NAMESPACE}" Version="1.0.0" returnContextID="true">${pos}</SessionCreateRQ>`;
}

function usernameToken(credentials: SessionCredentials): SoapSecurity {
  const { username, password, organization, domain, clientId, clientSecret } = credentials;
  return {
    usernameToken: {
      username,
      password,
      organization,
      domain,
      ...(clientId === undefined ? {} : { clientId }),
      ...(clientSecret === undefined ? {} : { clientSecret }),
    },
  };
}

/**
 * Abre una sesión. Se reintenta solo ante `USG_*_BUSY`: `USG_RESOURCE_UNAVAILABLE` (más de 50
 * sesiones) se lanza sin reintentar.
 */
export async function openSession(
  transport: SoapTransport,
  credentials: SessionCredentials,
  options: RequestOptions = {},
): Promise<SabreSession> {
  const conversationId = globalThis.crypto.randomUUID();
  const request: SoapRequest = {
    service: 'sessionCreate',
    action: 'SessionCreateRQ',
    payload: sessionCreatePayload(credentials),
    cpaId: credentials.organization,
    conversationId,
    security: usernameToken(credentials),
    idempotent: false,
    readSecurityToken: true,
    operation: 'openSession',
    ...options,
  };
  const response = await transport.request(request).catch((error: unknown) => {
    throw toSessionError(error, OPEN_ERROR_KINDS);
  });

  const status = response.payload['@status'];
  if (typeof status === 'string' && status !== 'Approved') {
    throw new SabreGatewayError(`sessionCreate: SessionCreateRS con status ${status}`, {
      protocol: 'soap',
      status: response.status,
      retryable: false,
    });
  }
  if (response.securityToken === undefined) {
    throw new SabreGatewayError('sessionCreate: la respuesta no trae BinarySecurityToken', {
      protocol: 'soap',
      status: response.status,
      retryable: false,
    });
  }

  // La versión elegida queda en el log, sin credenciales.
  transport.log.emit('info', 'sabre.session.open', {
    version: credentials.version,
    pseudoCityCode: credentials.organization,
  });
  return new SabreSession({ transport, pcc: credentials.organization, conversationId, token: response.securityToken });
}
