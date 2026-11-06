// Access Queue (`QueueAccessLLSRQ` 2.1.1): entrar a una cola y navegarla. Ver
// sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (puntos 2, 3 y 4) y
// wiki/sources/access-queue-v2-1-1-design.md.
import { XMLParser } from 'fast-xml-parser';
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreBusinessError, SabreGatewayError, type SabreWarning } from '../errors/index.js';
import { asArray, respondedAtField, type SoapResponse, textOf, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';
import { type QueueRef, queueRefAttribute } from './queue-ref.js';

export const QUEUE_ACCESS_SERVICE = 'queueAccess';
const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';

/** Texto exacto del fin de cola. Es la respuesta normal cuando no queda ningún PNR. */
export const END_OF_DISPLAY = 'END OF DISPLAY FOR REQUESTED DATA';
/**
 * Una cola vacía, como `stl:Error` de `access` y `list` (producción, #96). Las fuentes solo
 * mostraban `END OF DISPLAY`.
 */
export const QUEUE_EMPTY = 'QUEUE SELECTED WAS EMPTY';
/** `QXI` con la sesión fuera de una cola, como `stl:Error` (producción, #96). */
export const OFF_QUEUE = 'CANNOT DO THIS IF OFF QUEUE';

/** Por qué terminó la cola: el fin de cola de siempre o una cola vacía al entrar. */
export type QueueEndReason = 'end-of-display' | 'empty';

/** Máximo de filtros de `selection` y de colas de `remove({ from })`, según el design 2.1.1. */
export const MAX_SELECTIONS = 8;
export const MAX_REMOVE_FROM = 3;

/**
 * Un filtro al entrar a una cola: un calificador de host, p. ej. `{ function: 'AL', criteria: 'DL' }`
 * (solo los PNR de esa aerolínea). Las reglas de combinación las valida Sabre.
 */
export interface QueueSelection {
  function: string;
  criteria: string;
}

export interface QueueAccessRequest {
  queue: QueueRef;
  /** PCC de la cola. Por defecto, el de la sesión. */
  pcc?: string;
  /** Hasta 8 filtros. Con selección, la cola abre solo los PNR que cumplen el criterio. */
  selection?: readonly QueueSelection[];
}

/** Una cola de la que `remove` saca el PNR actual. */
export interface QueueRemoveTarget {
  queue: QueueRef;
  /** Por defecto, el PCC de la sesión. */
  pcc?: string;
}

export interface QueueRemoveRequest {
  /** De 1 a 3 colas de las que sacar el PNR actual a la vez. Sin `from`, sale de la cola en curso. */
  from?: readonly QueueRemoveTarget[];
}

export type QueueAccessOptions = RequestOptions;
export type QueueNavigationOptions = RequestOptions;

/** El PNR en el que quedó parada la cola. */
export interface QueueItem {
  /** Localizador: `Line/UniqueID@ID`. */
  locator: string;
  /**
   * `Line/DateTime`, tal cual llegó: con año en las respuestas reales (`"2024-05-15T13:24"`), sin
   * año en el design (`"12-21T07:00"`). Se toma como la colocación en la cola, pero en producción
   * el de `list` y el de `access` no coinciden para un mismo PNR (#96): el de `list` es siempre
   * posterior, y ninguna fuente dice qué fecha es cada uno. Se devuelve tal cual.
   */
  placedAt?: string;
  /** `Line/POS/Source`: quién colocó el PNR. `agentSine` puede ser `SABRE`. */
  placedBy?: { agentSine?: string; pseudoCityCode?: string };
  /** `Line/PassengerName`. Las respuestas reales de entrar a una cola no lo traen. */
  primaryPassenger?: string;
  /** `Line/Group`. Las respuestas reales de entrar a una cola no lo traen. */
  group?: string;
  /**
   * `Paragraph/Text`: el PNR en formato de host, línea por línea y tal cual, con su sangría. Las
   * líneas vacías llegan como `""`. Se interpreta con `parseQueueParagraph`.
   */
  paragraph: readonly string[];
}

/**
 * Resultado de una operación que avanza en la cola. El fin de cola es un resultado, no un error:
 * `END OF DISPLAY FOR REQUESTED DATA` llega como `{ done: true }`, también al entrar a una cola
 * vacía, y deja la sesión fuera de la cola.
 */
export type QueueStep =
  | { done: false; item: QueueItem; warnings: SabreWarning[]; respondedAt?: string }
  | { done: true; reason: QueueEndReason; message: string; warnings: SabreWarning[]; respondedAt?: string };

/** Qué acción de navegación se manda en `Navigation@Action`. */
type NavigationAction = 'I' | 'QR' | 'QXI';

const OPERATIONS: Record<NavigationAction, string> = { I: 'queue.ignore', QR: 'queue.remove', QXI: 'queue.exit' };

function root(body: string): string {
  return `<QueueAccessRQ Version="2.1.1" xmlns="${NAMESPACE}">${body}</QueueAccessRQ>`;
}

function identifier(queue: QueueRef, pcc: string): string {
  return `<QueueIdentifier ${queueRefAttribute(queue)} PseudoCityCode="${xmlEscape(pcc)}"/>`;
}

/** `Q/<PCC><cola>`, con los filtros de `Selection` si los hay. */
export function queueAccessPayload(queue: QueueRef, pcc: string, selection: readonly QueueSelection[] = []): string {
  const filters = selection
    .map((filter) => `<Selection Function="${xmlEscape(filter.function)}" Criteria="${xmlEscape(filter.criteria)}"/>`)
    .join('');
  return root(`${identifier(queue, pcc)}${filters}`);
}

/** `Navigation@Action`. Solo `QR` lleva `QueueIdentifier`: las colas de las que sacar el PNR. */
export function queueNavigationPayload(action: NavigationAction, from: ReadonlyArray<{ queue: QueueRef; pcc: string }> = []): string {
  return root(`<Navigation Action="${action}"/>${from.map((target) => identifier(target.queue, target.pcc)).join('')}`);
}

/**
 * Las operaciones de Access Queue mueven el cursor: no se reintentan ante un fallo de red. El
 * transporte solo las repite ante `USG_*_BUSY` y `PREVIOUS ENTRY ACTIVE`.
 */
export function queueAccessRequest(payload: string, operation: string, options: RequestOptions): SessionRequest {
  return { service: QUEUE_ACCESS_SERVICE, action: 'QueueAccessLLSRQ', payload, idempotent: false, operation, ...options };
}

export function navigationOperation(action: NavigationAction): string {
  return OPERATIONS[action];
}

/**
 * Parser aparte para el `Paragraph`: el del transporte recorta los espacios, y el formato de host
 * usa la sangría. Se vuelve a leer el sobre (ya redactado) sin recortar.
 */
const paragraphParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  isArray: (name) => name === 'Text',
});

export type XmlNode = Record<string, unknown>;

export function node(value: unknown): XmlNode | undefined {
  if (Array.isArray(value)) return node(value[0]);
  return typeof value === 'object' && value !== null ? (value as XmlNode) : undefined;
}

export function attribute(value: unknown, name: string): string | undefined {
  const text = node(value)?.[`@${name}`];
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : undefined;
}

function element(value: unknown): string | undefined {
  const text = textOf(Array.isArray(value) ? value[0] : value)?.trim();
  return text === undefined || text === '' ? undefined : text;
}

/**
 * Las líneas `Text` de una respuesta, tal cual: las de `Paragraph` en `QueueAccessRS` y las del
 * primer nivel en `QueuePlaceRS`.
 */
export function textLines(raw: string, payloadName: 'QueueAccessRS' | 'QueuePlaceRS'): string[] {
  let parsed: unknown;
  try {
    parsed = paragraphParser.parse(raw);
  } catch {
    return [];
  }
  const payload = node(node(node(node(parsed)?.Envelope)?.Body)?.[payloadName]);
  const container = payloadName === 'QueueAccessRS' ? node(payload?.Paragraph) : payload;
  return asArray(container?.Text).map((line) => (typeof line === 'string' ? line : (textOf(line) ?? '')));
}

/** Las líneas de `Paragraph/Text` de un `QueueAccessRS`, tal cual. */
export function paragraphLines(raw: string): string[] {
  return textLines(raw, 'QueueAccessRS');
}

/** Si un texto de Sabre es el fin de cola, comparado por el texto exacto. */
export function isEndOfDisplay(text: string | undefined): boolean {
  return text?.trim() === END_OF_DISPLAY;
}

/**
 * Si un `stl:Warning` o `stl:Error` es el fin de cola. El transporte junta los `Message` con
 * `" / "` y agrega el `ShortText` entre paréntesis, así que se busca el texto como una de esas
 * partes, entero.
 */
export function isEndOfDisplayResult(error: { message: string; service: string }): boolean {
  return resultHasText(error, END_OF_DISPLAY);
}

/** Si un `stl:Warning` o `stl:Error` trae `text` como una de sus partes, entero. */
export function resultHasText(error: { message: string; service: string }, text: string): boolean {
  const prefix = `${error.service}: `;
  const description = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
  return description
    .split(/ \/ | \(|\)/)
    .some((part) => part.trim() === text);
}

/**
 * El fin de cola, si llegó como `stl:Error` de `service`: `END OF DISPLAY` o una cola vacía
 * (`QUEUE SELECTED WAS EMPTY`). Si no, `undefined`.
 */
export function queueEndError(error: unknown, service: string): { reason: QueueEndReason; error: SabreBusinessError } | undefined {
  if (!(error instanceof SabreBusinessError) || error.service !== service) return undefined;
  const results = [error, ...error.errors];
  if (results.some((result) => resultHasText(result, QUEUE_EMPTY))) return { reason: 'empty', error };
  if (results.some(isEndOfDisplayResult)) return { reason: 'end-of-display', error };
  return undefined;
}

/** Si el error es el de `QXI` con la sesión fuera de una cola. */
export function isOffQueueError(error: unknown): error is SabreBusinessError {
  return error instanceof SabreBusinessError && [error, ...error.errors].some((result) => resultHasText(result, OFF_QUEUE));
}

/** El fin de cola. `raw` es el sobre del que sale `respondedAt`: la respuesta o el `stl:Error`. */
export function endStep(warnings: SabreWarning[], reason: QueueEndReason = 'end-of-display', raw?: unknown): QueueStep {
  return { done: true, reason, message: reason === 'empty' ? QUEUE_EMPTY : END_OF_DISPLAY, warnings, ...respondedAtField(raw) };
}

/**
 * Lee el paso de un `QueueAccessRS`. El fin de cola llega como primera línea del `Paragraph`
 * (evidencia de `1.0.8`) o como `stl:Warning`. Un `Line` sin localizador es una respuesta que el
 * SDK no entiende: lanza `SabreGatewayError`.
 */
export function parseQueueStep(response: SoapResponse): QueueStep {
  const { warnings } = response;
  const paragraph = paragraphLines(response.raw);
  const firstLine = paragraph.find((line) => line.trim() !== '');
  if (isEndOfDisplay(firstLine) || warnings.some(isEndOfDisplayResult)) return endStep(warnings, 'end-of-display', response.raw);

  const fields = lineFields(response.payload.Line);
  if (fields === undefined) {
    throw new SabreGatewayError(`${QUEUE_ACCESS_SERVICE}: respuesta no reconocida (sin Line/UniqueID ni fin de cola)`, {
      protocol: 'soap',
      status: response.status,
      retryable: false,
      raw: response.raw,
    });
  }
  const item: QueueItem = { ...fields, paragraph };
  return { done: false, item, warnings, ...respondedAtField(response.raw) };
}

/** Los campos de un `Line`, o `undefined` si no trae `UniqueID`. */
export function lineFields(value: unknown): Omit<QueueItem, 'paragraph'> | undefined {
  const line = node(value);
  const locator = attribute(line?.UniqueID, 'ID');
  if (line === undefined || locator === undefined) return undefined;
  const source = node(node(line.POS)?.Source);
  const agentSine = attribute(source, 'AgentSine');
  const pseudoCityCode = attribute(source, 'PseudoCityCode');
  const placedAt = element(line.DateTime);
  const primaryPassenger = element(line.PassengerName);
  const group = element(line.Group);
  return {
    locator,
    ...(placedAt === undefined ? {} : { placedAt }),
    ...(agentSine === undefined && pseudoCityCode === undefined
      ? {}
      : {
          placedBy: {
            ...(agentSine === undefined ? {} : { agentSine }),
            ...(pseudoCityCode === undefined ? {} : { pseudoCityCode }),
          },
        }),
    ...(primaryPassenger === undefined ? {} : { primaryPassenger }),
    ...(group === undefined ? {} : { group }),
  };
}
