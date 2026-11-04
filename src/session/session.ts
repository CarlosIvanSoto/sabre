// Ciclo de vida de la sesión SOAP: `SessionCreateRQ` (2.0.0 o 1.0.0) y `SessionCloseRQ` 1.0.1,
// con uso exclusivo. Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 1 y
// decisiones de la revisión), wiki/entities/create-session.md y gestion-de-sesion-soap.md.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreError, SabreGatewayError, SabreSessionError, type SabreSessionErrorKind } from '../errors/index.js';
import {
  asArray,
  type SoapRequest,
  type SoapResponse,
  type SoapSecurity,
  type SoapTransport,
  textOf,
  xmlEscape,
} from '../http/soap-transport.js';
import { QueueManagement } from '../queue/queue-management.js';
import {
  commandToken,
  parseSabreCommandResponse,
  type SabreCommandOptions,
  type SabreCommandResponse,
  sabreCommandRequest,
} from './command.js';
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
 * `USG_*` que dejan la sesión inutilizable (punto 4). Una sesión vencida en producción devuelve
 * `USG_INVALID_SECURITY_TOKEN` (#95, 2026-11-02): HTTP 500, `faultcode`
 * `soap-env:Client.InvalidSecurityToken`, y el código solo en el `detail`. `USG_AUTHENTICATION_FAILED`
 * sigue como `'expired'` de forma tentativa: no se observó con una sesión abierta.
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

/** Opciones de `openSession`. */
export interface OpenSessionOptions extends RequestOptions {
  /**
   * Manda `OTA_PingRQ` cuando la sesión lleva 13 minutos inactiva, antes del vencimiento de los
   * 15. Apagado por defecto: en runtimes serverless o edge un timer no sobrevive entre
   * invocaciones. Ahí conviene `withSession` por recorrido, o un `ping()` antes de reutilizar.
   */
  keepAlive?: boolean;
}

/** Inactividad a la que `keepAlive` manda el ping: 2 minutos antes de los 15 del vencimiento. */
export const KEEP_ALIVE_IDLE_MS = 13 * 60_000;

/**
 * Una sesión SOAP abierta con `SessionCreateRQ`. Es exclusiva: Sabre no admite llamadas
 * concurrentes en la misma sesión (`USG_INVALID_SESSION`), así que una segunda llamada mientras
 * otra está en vuelo lanza `TypeError` sin llamar a la red. Se cierra con `close()`, o sola si
 * se abrió con `withSession`.
 */
export class SabreSession {
  /** Queue Management: contar, recorrer y colocar en colas, dentro de esta sesión. */
  readonly queue: QueueManagement;
  readonly #transport: SoapTransport;
  readonly #pcc: string;
  readonly #conversationId: string;
  readonly #security: SoapSecurity;
  #busy = false;
  #closing: Promise<void> | undefined;
  /** El `SabreSessionError` que dejó la sesión inutilizable. */
  #unusable: SabreSessionError | undefined;
  /** Última vez que Sabre respondió en esta sesión (`Date.now()`). */
  #lastActivity = Date.now();
  #keepAliveTimer: ReturnType<typeof setTimeout> | undefined;
  /** El ping de `keepAlive` en vuelo: las llamadas del consumidor lo esperan en vez de chocar. */
  #keepAlivePing: Promise<void> | undefined;

  static {
    // `await using` es un extra: solo si el runtime tiene el símbolo (Node 22 no tiene la
    // sintaxis nativa, y algunos runtimes edge no tienen el símbolo).
    installAsyncDispose(this.prototype, (Symbol as { asyncDispose?: symbol }).asyncDispose);
  }

  /** @internal Se crea con `SabreLegacy.openSession()`. */
  constructor(internal: {
    transport: SoapTransport;
    pcc: string;
    conversationId: string;
    token: string;
    keepAlive: boolean;
  }) {
    this.#transport = internal.transport;
    this.#pcc = internal.pcc;
    this.#conversationId = internal.conversationId;
    this.#security = { binarySecurityToken: internal.token };
    this.queue = new QueueManagement({
      send: (request) => this[sessionSend](request),
      pcc: internal.pcc,
      log: internal.transport.log,
    });
    if (internal.keepAlive) this.#scheduleKeepAlive(KEEP_ALIVE_IDLE_MS);
  }

  /**
   * Milisegundos desde la última respuesta de Sabre en esta sesión; `0` mientras hay una llamada
   * en vuelo. Sabre cierra la sesión a los 15 minutos de inactividad.
   */
  get idleMs(): number {
    return this.#busy ? 0 : Math.max(0, Date.now() - this.#lastActivity);
  }

  /**
   * Manda `OTA_PingRQ`, que reinicia el contador de inactividad sin tocar el AAA. Durante un
   * recorrido de cola no hace falta: cada operación ya lo reinicia.
   */
  async ping(options: RequestOptions = {}): Promise<void> {
    checkPingResponse(await this[sessionSend]({ ...pingRequest(), ...options }));
  }

  /**
   * Manda un comando de host (`SabreCommandLLSRQ` 2.0.0) y devuelve la pantalla como texto, sin
   * interpretarla. Es una vía de escape: sin tipos ni garantías, y un comando puede cambiar la
   * configuración del PCC o emitir. El comando va tal cual; el separador de Sabre Red (`‡`) se
   * escribe `¥`. Sin reintento salvo `{ idempotent: true }`, para comandos de solo lectura.
   */
  async command(command: string, options: SabreCommandOptions = {}): Promise<SabreCommandResponse> {
    const request = sabreCommandRequest(command, options);
    this.#transport.log.emit('debug', 'sabre.session.command', { command: commandToken(command) });
    return parseSabreCommandResponse(await this[sessionSend](request));
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
    if (this.#busy && this.#keepAlivePing === undefined) {
      return Promise.reject(new TypeError('sabre-client: session busy'));
    }
    this.#stopKeepAlive();
    if (this.#unusable !== undefined) {
      this.#closing = Promise.resolve();
      return this.#closing;
    }
    // Si el ping de `keepAlive` está en vuelo, el cierre sale cuando termina.
    const before = this.#keepAlivePing ?? Promise.resolve();
    this.#closing = before.then(() => this.#sendClose(options));
    return this.#closing;
  }

  /** @internal Una llamada a Sabre dentro de la sesión, con uso exclusivo. */
  async [sessionSend](request: SessionRequest): Promise<SoapResponse> {
    if (this.#keepAlivePing !== undefined && this.#closing === undefined) await this.#keepAlivePing;
    return this.#send(request);
  }

  async #send(request: SessionRequest): Promise<SoapResponse> {
    if (this.#closing !== undefined) fail('session closed');
    if (this.#unusable !== undefined) {
      throw new TypeError(`sabre-client: session unusable (${this.#unusable.kind})`, { cause: this.#unusable });
    }
    if (this.#busy) fail('session busy');
    this.#busy = true;
    try {
      const response = await this.#transport.request({ ...request, ...this.#envelopeFields() });
      this.#touch();
      return response;
    } catch (error) {
      if (reachedSabre(error)) this.#touch();
      throw this.#markUnusable(error);
    } finally {
      this.#busy = false;
    }
  }

  async #sendClose(options: RequestOptions): Promise<void> {
    if (this.#unusable !== undefined) return;
    this.#busy = true;
    try {
      await this.#transport.request({
        service: 'sessionClose',
        action: 'SessionCloseRQ',
        payload: `<SessionCloseRQ Version="1.0.1"><POS><Source PseudoCityCode="${xmlEscape(this.#pcc)}"/></POS></SessionCloseRQ>`,
        ...this.#envelopeFields(),
        // Solo se reintenta ante `USG_*_BUSY`: tras un fallo de red no se sabe si ya se cerró.
        idempotent: false,
        operation: 'close',
        ...options,
      });
    } catch (error) {
      throw this.#markUnusable(error);
    } finally {
      this.#busy = false;
    }
    this.#transport.log.emit('info', 'sabre.session.close', { pseudoCityCode: this.#pcc });
  }

  /** Un error de sesión deja la sesión inutilizable. No se reabre sola: el cursor ya se perdió. */
  #markUnusable(error: unknown): unknown {
    const mapped = toSessionError(error);
    if (mapped instanceof SabreSessionError) {
      this.#unusable = mapped;
      this.#stopKeepAlive();
    }
    return mapped;
  }

  #touch(): void {
    this.#lastActivity = Date.now();
  }

  #envelopeFields(): Pick<SoapRequest, 'cpaId' | 'conversationId' | 'security'> {
    return { cpaId: this.#pcc, conversationId: this.#conversationId, security: this.#security };
  }

  /**
   * Un solo timer, que se reprograma según `idleMs`: cada respuesta de Sabre corre el ping. Si el
   * ping falla (ya con los reintentos del transporte), se avisa con un `warn` y `keepAlive` se
   * apaga: reintentar sin fin no tiene sentido con una sesión que vence a los 15 minutos.
   */
  #scheduleKeepAlive(delayMs: number): void {
    const timer = setTimeout(() => this.#onKeepAlive(), delayMs);
    // Que el timer no mantenga vivo el proceso si el consumidor se olvida de cerrar (Node).
    (timer as { unref?: () => void }).unref?.();
    this.#keepAliveTimer = timer;
  }

  #onKeepAlive(): void {
    this.#keepAliveTimer = undefined;
    if (this.#closing !== undefined || this.#unusable !== undefined) return;
    if (this.#busy) {
      this.#scheduleKeepAlive(KEEP_ALIVE_IDLE_MS);
      return;
    }
    const remaining = KEEP_ALIVE_IDLE_MS - this.idleMs;
    if (remaining > 0) {
      this.#scheduleKeepAlive(remaining);
      return;
    }
    this.#keepAlivePing = this.#send(pingRequest()).then(
      () => {
        if (this.#closing === undefined && this.#unusable === undefined) this.#scheduleKeepAlive(KEEP_ALIVE_IDLE_MS);
      },
      (error: unknown) => {
        this.#transport.log.emit('warn', 'sabre.session.keepAliveFailed', { error });
      },
    );
    void this.#keepAlivePing.finally(() => {
      this.#keepAlivePing = undefined;
    });
  }

  #stopKeepAlive(): void {
    if (this.#keepAliveTimer !== undefined) clearTimeout(this.#keepAliveTimer);
    this.#keepAliveTimer = undefined;
  }
}

/**
 * `OTA_PingRQ` 1.0.0, como el sample oficial pero con el namespace OTA de la respuesta: sin él,
 * producción contesta `Invalid version` (#95). Idempotente: no toca el estado de negocio.
 */
function pingRequest(): SessionRequest {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    service: 'ping',
    action: 'OTA_PingRQ',
    payload: `<OTA_PingRQ xmlns="${OTA_PING_NAMESPACE}" TimeStamp="${timestamp}" Version="1.0.0"><EchoData>sabre-client</EchoData></OTA_PingRQ>`,
    idempotent: true,
    operation: 'ping',
  };
}

const OTA_PING_NAMESPACE = 'http://www.opentravel.org/OTA/2003/05';

/**
 * `OTA_PingRS` puede traer un error con HTTP 200 y sin fault, como `<Errors><Error Type="VER">
 * Invalid version</Error></Errors>` (producción, #95). Es un rechazo del request, así que sale
 * como `SabreGatewayError`, igual que un error de validación. Sin `Success` tampoco se da por bueno.
 */
function checkPingResponse(response: SoapResponse): void {
  const errors = asArray(response.payload.Errors)[0] as Record<string, unknown> | undefined;
  const error = asArray(errors?.Error)[0];
  if (error !== undefined) {
    const type = (error as Record<string, unknown>)['@Type'];
    const text = textOf(error)?.trim();
    throw new SabreGatewayError(`ping: OTA_PingRS con error${text ? `: ${text}` : ''}`, {
      protocol: 'soap',
      status: response.status,
      ...(typeof type === 'string' && type !== '' && { code: type }),
      retryable: false,
      raw: response.raw,
    });
  }
  if (response.payloadName !== 'OTA_PingRS' || !('Success' in response.payload)) {
    throw new SabreGatewayError('ping: respuesta no reconocida (sin OTA_PingRS/Success)', {
      protocol: 'soap',
      status: response.status,
      retryable: false,
      raw: response.raw,
    });
  }
}

/**
 * Si Sabre llegó a responder: cualquier error del SDK salvo un fallo de red (sin status). Solo
 * eso reinicia el contador de inactividad.
 */
function reachedSabre(error: unknown): boolean {
  if (!(error instanceof SabreError)) return false;
  return !(error instanceof SabreGatewayError && error.status === undefined);
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
  options: OpenSessionOptions = {},
): Promise<SabreSession> {
  const { keepAlive = false, ...requestOptions } = options;
  if (typeof keepAlive !== 'boolean') fail('keepAlive debe ser un boolean');
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
    ...requestOptions,
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
  return new SabreSession({
    transport,
    pcc: credentials.organization,
    conversationId,
    token: response.securityToken,
    keepAlive,
  });
}
