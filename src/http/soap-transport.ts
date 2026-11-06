// Transporte SOAP de `SabreLegacy`: sobre armado a mano, fetch, parseo y mapeo de errores.
// Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (puntos 4 y 6),
// cliente-http-y-libreria-xml.md y respuesta-cruda-soap.md.
import { XMLParser } from 'fast-xml-parser';
import { definedOnly, type ResolvedConfig } from '../config.js';
import { SabreBusinessError, SabreGatewayError, SabreWarning } from '../errors/index.js';
import { EventLogger } from '../logging/logger.js';
import { REDACTED, redactSoapEnvelope } from '../logging/redact.js';
import { type RawRequestCapture, rawRequestHeaders, type SabreRawRequestCallback } from './raw-request.js';
import type { SabreRawResponseCallback } from './raw-response.js';
import { type RetryOptions, retryDelay, sleep, validateRetryOptions } from './retry.js';

/**
 * Status HTTP transitorios cuando la respuesta no trae un sobre SOAP (proxy, balanceador).
 * Solo se reintentan en operaciones idempotentes.
 */
const TRANSIENT_STATUS = new Set([429, 500, 503, 504]);

/**
 * "Se excedió el máximo de requests concurrentes: esperar ≥ 500 ms y reintentar". Se asume que
 * Sabre no procesó el request, así que se reintentan también en las operaciones que mueven el
 * cursor. Sin confirmar: se valida en la Fase 4.
 */
export const BUSY_CODES: ReadonlySet<string> = new Set(['USG_CONNECTOR_IS_BUSY', 'USG_IS_BUSY', 'USG_SERVICE_IS_BUSY']);

/**
 * Los demás `USG_*` que el catálogo manda a "esperar ≥ 500 ms y reintentar". No dicen si el
 * request se procesó, así que solo se reintentan en operaciones idempotentes.
 * `USG_RESOURCE_UNAVAILABLE` (límite de sesiones) no está: no se reintenta.
 */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  'USG_SECURITY_ICE_ERROR',
  'USG_SERVICE_PROVIDER_ERROR',
  'USG_NO_RESPONSE_FROM_JMSRECEIVER_IN_TIME',
  'SC_SERVICE_UNAVAILABLE',
  'USG_COULD_NOT_COMPLETE_REQUEST',
  'USG_IIOP_OBJECT_NOT_EXIST',
  'USG_IIOP_TRANSIENT_EXCEPTION',
  'USG_MOM_SERVICE_PROVIDER_INFRASTRUCTURE_ERROR',
]);

/** Esquema fijo que documenta Sabre: 3 reintentos con 1 s de intervalo, sin jitter. */
export const PREVIOUS_ENTRY_ACTIVE_RETRIES = 3;
export const PREVIOUS_ENTRY_ACTIVE_DELAY_MS = 1000;
const PREVIOUS_ENTRY_ACTIVE = /PREVIOUS ENTRY ACTIVE/i;

type RetryReason = 'busy' | 'previous-entry-active' | 'transient';

/** Credencial del header `wsse:Security`. */
export type SoapSecurity =
  /** Token de sesión (ATH) o stateless (ATK). */
  | { binarySecurityToken: string }
  /** Credenciales de `SessionCreateRQ`. `clientId` y `clientSecret` solo van en la 2.0.0. */
  | {
      usernameToken: {
        username: string;
        password: string;
        organization: string;
        domain: string;
        clientId?: string;
        clientSecret?: string;
      };
    };

export interface SoapRequest {
  /** Nombre del servicio para errores y logs, p. ej. `'queueAccess'`. */
  service: string;
  /** `eb:Service` y `eb:Action`, p. ej. `'QueueAccessLLSRQ'`. */
  action: string;
  /** Payload del `soap-env:Body`, ya armado y escapado (ver `xmlEscape`). */
  payload: string;
  /** `eb:CPAId`: el PCC. */
  cpaId: string;
  /** `eb:ConversationId` de la sesión. */
  conversationId: string;
  security: SoapSecurity;
  /**
   * Si la operación se puede repetir sin efectos (`count`, `list`, `ping`). Las que mueven el
   * cursor de una cola van en `false`: nunca se reintentan ante un fallo de red.
   */
  idempotent: boolean;
  retry?: Partial<RetryOptions>;
  /** `true` para devolver el `BinarySecurityToken` de la respuesta (solo `SessionCreateRQ`). */
  readSecurityToken?: boolean;
  signal?: AbortSignal;
  /** Método público sin `legacy.`, p. ej. `'queue.access'`. Lo reciben `onRawResponse` y `onRawRequest`. */
  operation?: string;
  onRawResponse?: SabreRawResponseCallback;
  /**
   * No se llama con `usernameToken` (`SessionCreateRQ`): el sobre lleva `wsse:Password` y el
   * `ClientSecret`, y la regla de auth lo deja fuera (ADR-029).
   */
  onRawRequest?: SabreRawRequestCallback;
}

export interface SoapResponse {
  /** Elemento hijo del `Body` (p. ej. `QueueAccessRS`), parseado y sin prefijos de namespace. */
  payload: Record<string, unknown>;
  /** Nombre local de ese elemento, p. ej. `'QueueAccessRS'`. */
  payloadName: string;
  /** Los `stl:Warning` de `stl:ApplicationResults`. */
  warnings: SabreWarning[];
  /** `eb:MessageId` de la respuesta, el dato que pide soporte de Sabre. */
  messageId: string | undefined;
  /** `eb:Timestamp` de la respuesta, en UTC con `Z` (ver `respondedAtOf`). */
  respondedAt: string | undefined;
  /** El sobre redactado, como `raw` de los errores que arme la operación al leer el payload. */
  raw: string;
  /** El `BinarySecurityToken` del header, solo con `readSecurityToken`. */
  securityToken: string | undefined;
  status: number;
}

export interface SoapTransportOptions {
  /** Solo para tests: id del `eb:MessageId`. */
  messageId?: () => string;
  /** Solo para tests: reloj del `eb:Timestamp`. */
  now?: () => Date;
  /** Solo para tests: fuente de aleatoriedad del jitter. */
  random?: () => number;
  /** Solo para tests: espera entre reintentos. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Último intento con respuesta HTTP (`last`), para entregarlo una sola vez a `onRawResponse`, y
 * último sobre mandado (`request`), para `onRawRequest`.
 */
interface RawCapture {
  attempts: number;
  last?: { status: number; headers: Headers; body: string };
  request?: RawRequestCapture;
}

const SOAP_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8', Accept: 'text/xml' } as const;

type XmlNode = Record<string, unknown>;

/**
 * Atributos con `@`, sin prefijos de namespace y todo como string: `"011"` y `"....261"`
 * llegan tal cual, para que cada servicio decida cómo leerlos.
 */
const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
} as const;
const parser = new XMLParser(PARSER_OPTIONS);
/** Igual, pero sin recortar los textos: solo para lo que depende de los espacios. */
const untrimmedParser = new XMLParser({ ...PARSER_OPTIONS, trimValues: false });

export class SoapTransport {
  readonly #config: ResolvedConfig;
  readonly #log: EventLogger;
  readonly #messageId: () => string;
  readonly #now: () => Date;
  readonly #random: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(config: ResolvedConfig, options: SoapTransportOptions = {}) {
    this.#config = config;
    this.#log = new EventLogger(config.logger);
    this.#messageId = options.messageId ?? (() => globalThis.crypto.randomUUID());
    this.#now = options.now ?? (() => new Date());
    this.#random = options.random ?? Math.random;
    this.#sleep = options.sleep ?? sleep;
  }

  /** @internal Para los eventos de sesión que no son una request. */
  get log(): EventLogger {
    return this.#log;
  }

  async request(request: SoapRequest): Promise<SoapResponse> {
    if (request.retry !== undefined) validateRetryOptions(request.retry, 'retry');
    const capture: RawCapture = { attempts: 0 };
    try {
      return await this.#attempts(request, capture);
    } finally {
      // Una sola vez por operación: primero el último sobre que se mandó, aunque no haya tenido
      // respuesta, y después el último intento que tuvo respuesta HTTP.
      if (capture.request !== undefined) this.#deliverRawRequest(request, capture.request, capture.attempts);
      if (capture.last !== undefined) this.#deliverRaw(request, { ...capture.last, attempts: capture.attempts });
    }
  }

  /**
   * Dos presupuestos separados: el backoff genérico (`retry.maxRetries`, para `USG_*_BUSY` y
   * los transitorios) y el esquema fijo de `PREVIOUS ENTRY ACTIVE`, que no se ajusta a la config.
   */
  async #attempts(request: SoapRequest, capture: RawCapture): Promise<SoapResponse> {
    const retry = { ...this.#config.retry, ...definedOnly(request.retry ?? {}) };
    let generic = 0;
    let previousEntryActive = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#send(request, attempt, capture);
      } catch (error) {
        const reason = retryReason(error, request.idempotent);
        let delayMs: number;
        if (reason === 'previous-entry-active' && previousEntryActive < PREVIOUS_ENTRY_ACTIVE_RETRIES) {
          previousEntryActive++;
          delayMs = PREVIOUS_ENTRY_ACTIVE_DELAY_MS;
        } else if ((reason === 'busy' || reason === 'transient') && generic < retry.maxRetries) {
          delayMs = retryDelay(generic, retry.baseDelayMs, this.#random);
          generic++;
        } else {
          throw error;
        }
        this.#log.emit('warn', 'sabre.request.retry', {
          protocol: 'soap',
          service: request.service,
          action: request.action,
          attempt: attempt + 1,
          reason,
          delayMs,
          error: error as SabreGatewayError,
        });
        await this.#sleep(delayMs, request.signal);
      }
    }
  }

  async #send(request: SoapRequest, attempt: number, capture: RawCapture): Promise<SoapResponse> {
    const envelope = this.#envelope(request);
    const logContext = { protocol: 'soap', service: request.service, action: request.action, attempt };
    this.#log.emit('debug', 'sabre.request.start', logContext);
    const startedAt = Date.now();

    let response: Response;
    capture.attempts++;
    if (wantsRawRequest(request)) {
      // eb:MessageId y eb:Timestamp se generan en cada intento: se guarda el último sobre.
      capture.request = {
        method: 'POST',
        url: this.#config.soapBaseUrl,
        headers: rawRequestHeaders(SOAP_HEADERS),
        body: redactSoapEnvelope(scrubToken(envelope, request.security)),
      };
    }
    try {
      response = await this.#config.fetch(this.#config.soapBaseUrl, {
        method: 'POST',
        headers: SOAP_HEADERS,
        body: envelope,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (cause) {
      if (isAbort(cause, request.signal)) throw cause;
      const error = new SabreGatewayError(`${request.service}: fallo de red (${describe(cause)})`, {
        protocol: 'soap',
        retryable: false,
        cause,
      });
      this.#log.emit('error', 'sabre.request.end', { ...logContext, durationMs: Date.now() - startedAt, error });
      throw error;
    }

    const original = await response.text();
    // Todo lo que sale del transporte (raw, errores, logs) se arma desde el texto redactado.
    const text = redactSoapEnvelope(scrubToken(original, request.security));
    capture.last = { status: response.status, headers: response.headers, body: text };

    const document = parseEnvelope(text);
    const messageId = stringAt(document?.Header, 'MessageHeader', 'MessageData', 'MessageId');
    const endContext = {
      ...logContext,
      status: response.status,
      durationMs: Date.now() - startedAt,
      ...(messageId === undefined ? {} : { messageId }),
    };

    try {
      const result = this.#classify(request, response, document, text);
      this.#log.emit('info', 'sabre.request.end', { ...endContext, warnings: result.warnings.length });
      return {
        ...result,
        messageId,
        respondedAt: respondedAtOf(text),
        raw: text,
        securityToken: request.readSecurityToken === true ? readSecurityToken(original) : undefined,
        status: response.status,
      };
    } catch (error) {
      const level = error instanceof SabreBusinessError ? 'warn' : 'error';
      this.#log.emit(level, 'sabre.request.end', { ...endContext, error });
      throw error;
    }
  }

  /** Orden de detección: fault (gateway), luego `stl:Error` (negocio), luego data. */
  #classify(
    request: SoapRequest,
    response: Response,
    document: { Header: unknown; Body: XmlNode } | undefined,
    text: string,
  ): Pick<SoapResponse, 'payload' | 'payloadName' | 'warnings'> {
    const { service } = request;
    if (document === undefined) {
      throw new SabreGatewayError(`${service}: HTTP ${response.status}, la respuesta no es un sobre SOAP`, {
        protocol: 'soap',
        status: response.status,
        retryable: false,
        raw: text,
      });
    }

    // Paso 1: SOAP fault (errores de `Transport` y `Validation`, y los `USG_*` del gateway).
    const fault = asNode(document.Body.Fault);
    if (fault !== undefined) throw faultError(service, response.status, fault, text);

    const [payloadName, payloadValue] = firstElement(document.Body);
    const payload = asNode(payloadValue);
    if (payloadName === undefined || payload === undefined) {
      throw new SabreGatewayError(`${service}: HTTP ${response.status}, el sobre SOAP no trae payload`, {
        protocol: 'soap',
        status: response.status,
        retryable: false,
        raw: text,
      });
    }
    if (!response.ok) {
      throw new SabreGatewayError(`${service}: HTTP ${response.status}`, {
        protocol: 'soap',
        status: response.status,
        retryable: false,
        raw: text,
      });
    }

    // Paso 3: `stl:ApplicationResults`. Los `stl:Warning` no lanzan.
    const results = asNode(payload.ApplicationResults);
    const warnings = asArray(results?.Warning).map((node) => {
      const entry = resultEntry(node);
      return new SabreWarning(`${service}: ${entry.description}`, { service, code: entry.code, raw: text });
    });
    const errors = asArray(results?.Error).map((node) => {
      const entry = resultEntry(node);
      return new SabreBusinessError(`${service}: ${entry.description}`, {
        service,
        code: entry.code,
        raw: text,
        retryable: PREVIOUS_ENTRY_ACTIVE.test(entry.description),
      });
    });
    const [first, ...rest] = errors;
    if (first !== undefined) {
      throw new SabreBusinessError(first.message, {
        service,
        code: first.code,
        raw: text,
        retryable: first.retryable,
        warnings,
        errors: rest,
      });
    }

    // Paso 4: data.
    return { payload, payloadName, warnings };
  }

  #envelope(request: SoapRequest): string {
    const timestamp = this.#now().toISOString().replace(/\.\d{3}Z$/, 'Z');
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eb="http://www.ebxml.org/namespaces/messageHeader">',
      '<soap-env:Header>',
      '<eb:MessageHeader soap-env:mustUnderstand="1" eb:version="1.0">',
      '<eb:From><eb:PartyId/></eb:From>',
      '<eb:To><eb:PartyId/></eb:To>',
      `<eb:CPAId>${xmlEscape(request.cpaId)}</eb:CPAId>`,
      `<eb:ConversationId>${xmlEscape(request.conversationId)}</eb:ConversationId>`,
      `<eb:Service>${xmlEscape(request.action)}</eb:Service>`,
      `<eb:Action>${xmlEscape(request.action)}</eb:Action>`,
      '<eb:MessageData>',
      `<eb:MessageId>mid:${xmlEscape(this.#messageId())}</eb:MessageId>`,
      `<eb:Timestamp>${timestamp}</eb:Timestamp>`,
      '</eb:MessageData>',
      '</eb:MessageHeader>',
      securityHeader(request.security),
      '</soap-env:Header>',
      `<soap-env:Body>${request.payload}</soap-env:Body>`,
      '</soap-env:Envelope>',
    ].join('');
  }

  /** Un callback que lanza no rompe la operación (mismo criterio que REST). */
  #deliverRawRequest(request: SoapRequest, raw: RawRequestCapture, attempts: number): void {
    const operation = request.operation ?? request.service;
    try {
      request.onRawRequest?.({ operation, protocol: 'soap', ...raw, attempts });
    } catch (error) {
      this.#log.emit('warn', 'sabre.request.rawRequestHookFailed', {
        service: request.service,
        operation,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  /** Un callback que lanza no rompe la operación (mismo criterio que REST). */
  #deliverRaw(request: SoapRequest, raw: Required<RawCapture>['last'] & { attempts: number }): void {
    if (request.onRawResponse === undefined) return;
    const operation = request.operation ?? request.service;
    try {
      request.onRawResponse({ operation, protocol: 'soap', ...raw });
    } catch (error) {
      this.#log.emit('warn', 'sabre.request.rawResponseHookFailed', {
        service: request.service,
        operation,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }
}

/** Escapa texto para un elemento o un atributo XML. */
/**
 * `eb:Timestamp` del header de un sobre de respuesta, en ISO 8601 UTC: Sabre lo manda sin zona
 * (`"2026-11-06T17:34:16"`) y en UTC (comparado con `stl:Success@timeStamp`, que trae `Z`, en
 * CERT el 2026-11-06), así que se le agrega `Z`. Con una zona explícita queda tal cual. Si no
 * viene o no tiene forma de fecha y hora, `undefined`. Ver ADR-027 (C1).
 */
export function respondedAtOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const header = /<(?:[\w-]+:)?Header\b[\s\S]*?<\/(?:[\w-]+:)?Header>/.exec(raw)?.[0];
  const value = header === undefined ? undefined : /<(?:[\w-]+:)?Timestamp>\s*([^<\s]+)\s*</.exec(header)?.[1];
  const match = value === undefined ? null : /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (match === null) return undefined;
  return `${match[1]}${match[2] ?? 'Z'}`;
}

/** `{ respondedAt }` si el sobre lo trae; si no, nada (`exactOptionalPropertyTypes`). */
export function respondedAtField(raw: unknown): { respondedAt?: string } {
  const respondedAt = respondedAtOf(raw);
  return respondedAt === undefined ? {} : { respondedAt };
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function securityHeader(security: SoapSecurity): string {
  const open = '<wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">';
  if ('binarySecurityToken' in security) {
    return `${open}<wsse:BinarySecurityToken valueType="String" EncodingType="wsse:Base64Binary">${xmlEscape(security.binarySecurityToken)}</wsse:BinarySecurityToken></wsse:Security>`;
  }
  const token = security.usernameToken;
  return [
    open,
    '<wsse:UsernameToken>',
    `<wsse:Username>${xmlEscape(token.username)}</wsse:Username>`,
    `<wsse:Password>${xmlEscape(token.password)}</wsse:Password>`,
    `<Organization>${xmlEscape(token.organization)}</Organization>`,
    `<Domain>${xmlEscape(token.domain)}</Domain>`,
    token.clientId === undefined ? '' : `<ClientId>${xmlEscape(token.clientId)}</ClientId>`,
    token.clientSecret === undefined ? '' : `<ClientSecret>${xmlEscape(token.clientSecret)}</ClientSecret>`,
    '</wsse:UsernameToken>',
    '</wsse:Security>',
  ].join('');
}

/**
 * Tapa el token que mandó el SDK donde sea que Sabre lo repita (p. ej. dentro de un
 * `faultstring`), en texto plano o escapado. El `BinarySecurityToken` del header lo tapa
 * después `redactSoapEnvelope`.
 */
/** `onRawRequest` solo con token de sesión: el sobre de `SessionCreateRQ` es la credencial. */
function wantsRawRequest(request: SoapRequest): boolean {
  return request.onRawRequest !== undefined && 'binarySecurityToken' in request.security;
}

function scrubToken(text: string, security: SoapSecurity): string {
  if (!('binarySecurityToken' in security) || security.binarySecurityToken === '') return text;
  const token = security.binarySecurityToken;
  return text.split(token).join(REDACTED).split(xmlEscape(token)).join(REDACTED);
}

function parseEnvelope(text: string, xmlParser = parser): { Header: unknown; Body: XmlNode } | undefined {
  if (text.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(text);
  } catch {
    return undefined;
  }
  const envelope = asNode(asNode(parsed)?.Envelope);
  const body = asNode(envelope?.Body);
  if (envelope === undefined || body === undefined) return undefined;
  return { Header: envelope.Header, Body: body };
}

/** Lee el token del texto original, antes de redactar. Solo para `SessionCreateRS`. */
function readSecurityToken(original: string): string | undefined {
  const document = parseEnvelope(original);
  const token = stringAt(document?.Header, 'Security', 'BinarySecurityToken');
  return token === undefined || token.trim() === '' ? undefined : token.trim();
}

/**
 * `USG_*` dentro del fault, best-effort: ninguna fuente dice en qué campo viaja. Se busca en
 * `faultcode`, `faultstring` y `detail`, y si no aparece se usa el `faultcode`. Se confirma
 * con la primera sesión real (#95).
 */
const USG_CODE = /\bUSG_[A-Z0-9_]+\b/;

function faultError(service: string, status: number, fault: XmlNode, text: string): SabreGatewayError {
  const faultcode = textOf(fault.faultcode);
  const faultstring = textOf(fault.faultstring);
  const haystack = [faultcode, faultstring, JSON.stringify(fault.detail ?? '')].join(' ');
  const code = USG_CODE.exec(haystack)?.[0] ?? faultcode;
  const detail = [faultcode, faultstring].filter((part) => part !== undefined && part !== '').join(': ');
  // `retryable: true` solo para `USG_*_BUSY` y `PREVIOUS ENTRY ACTIVE` (decisiones 4 y 5).
  const retryable = (code !== undefined && BUSY_CODES.has(code)) || PREVIOUS_ENTRY_ACTIVE.test(haystack);
  return new SabreGatewayError(`${service}: SOAP fault${detail === '' ? '' : ` ${detail}`}`, {
    protocol: 'soap',
    status,
    retryable,
    raw: text,
    ...(code === undefined || code === '' ? {} : { code }),
  });
}

/**
 * Un `stl:Error` o `stl:Warning`: `code` es el primer `Message@code`, o el primer `ShortText` si
 * no viene (las respuestas reales traen el `ERR.SWS.*` ahí, #96), o el `type`. La descripción junta
 * los textos de `Message` con el `ShortText`.
 */
function resultEntry(node: unknown): { code: string; description: string } {
  const entry = asNode(node) ?? {};
  const messages: string[] = [];
  const shortTexts: string[] = [];
  let code: string | undefined;
  for (const results of asArray(entry.SystemSpecificResults)) {
    const resultsNode = asNode(results) ?? {};
    for (const message of asArray(resultsNode.Message)) {
      code ??= nonEmpty(asNode(message)?.['@code']);
      const value = textOf(message);
      if (value !== undefined && value !== '') messages.push(value);
    }
    for (const shortText of asArray(resultsNode.ShortText)) {
      const value = textOf(shortText);
      if (value !== undefined && value !== '') shortTexts.push(value);
    }
  }
  const type = nonEmpty(entry['@type']);
  const description = [
    messages.join(' / ') || type || 'sin detalle',
    ...shortTexts.filter((short) => !messages.includes(short)).map((short) => `(${short})`),
  ].join(' ');
  return { code: code ?? shortTexts[0] ?? type ?? 'UNKNOWN', description };
}

/**
 * Por qué se puede reintentar un error, según la idempotencia de la operación. Ver
 * tier-3-sesion-y-colas-soap.md (punto 5) y politica-de-reintentos-y-backoff.md.
 */
function retryReason(error: unknown, idempotent: boolean): RetryReason | undefined {
  if ((error instanceof SabreBusinessError || error instanceof SabreGatewayError) && PREVIOUS_ENTRY_ACTIVE.test(error.message)) {
    return 'previous-entry-active';
  }
  if (!(error instanceof SabreGatewayError) || error.protocol !== 'soap') return undefined;
  if (error.code !== undefined && BUSY_CODES.has(error.code)) return 'busy';
  // Lo que sigue pudo haber llegado a Sabre: solo se repite si la operación es idempotente.
  if (!idempotent) return undefined;
  if (error.code !== undefined) return TRANSIENT_CODES.has(error.code) ? 'transient' : undefined;
  // Sin código: un fallo de red (sin status) o una respuesta sin sobre SOAP.
  if (error.status === undefined || TRANSIENT_STATUS.has(error.status)) return 'transient';
  return undefined;
}

/**
 * El payload del `Body` de `raw` con los textos tal cual, sin recortar espacios ni saltos de
 * línea. Para las pantallas de host (`SabreCommandLLSRS`), que van alineadas por columna: el
 * parser compartido recorta y desalinea la primera línea.
 */
export function untrimmedPayload(raw: string): Record<string, unknown> | undefined {
  const document = parseEnvelope(raw, untrimmedParser);
  return document === undefined ? undefined : asNode(firstElement(document.Body)[1]);
}

function firstElement(node: XmlNode): [string | undefined, unknown] {
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith('@') && key !== '#text') return [key, Array.isArray(value) ? value[0] : value];
  }
  return [undefined, undefined];
}

function asNode(value: unknown): XmlNode | undefined {
  if (Array.isArray(value)) return asNode(value[0]);
  return typeof value === 'object' && value !== null ? (value as XmlNode) : undefined;
}

export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

/** Texto de un elemento: un string, o el `#text` de un elemento con atributos. */
export function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const node = asNode(value);
  const text = node?.['#text'];
  return typeof text === 'string' ? text : node === undefined ? undefined : '';
}

function stringAt(root: unknown, ...path: string[]): string | undefined {
  let node: unknown = root;
  for (const key of path) node = asNode(node)?.[key];
  return nonEmpty(textOf(node));
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

