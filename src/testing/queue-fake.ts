// Fake de colas para los tests de los consumidores: un `fetch` que responde como Sabre a la sesión
// SOAP y a Queue Management, sin red. Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md
// (punto 7 y su decisión). Se publica en `sabre-client/testing`, fuera del bundle principal.
//
// Las respuestas imitan lo observado en producción (#95, #96 y #97): la cola vacía como
// `QUEUE SELECTED WAS EMPTY`, el fin de cola en el `Paragraph`, `place` dentro de una cola que
// mueve el PNR y devuelve el siguiente, y los errores de host con el código en `ShortText`.
import { XMLParser } from 'fast-xml-parser';
import { END_OF_DISPLAY, OFF_QUEUE, QUEUE_EMPTY } from '../queue/queue-access.js';
import { signatureLocator } from '../queue/queue-place.js';
import type { QueueActivityCounters } from '../queue/queue-activity.js';
import { MAX_QUEUE_NUMBER, MESSAGE_QUEUE, MIN_QUEUE_NUMBER, type QueueRef, toQueueRef } from '../queue/queue-ref.js';
import type {
  ReservationHistoryAccounting,
  ReservationHistoryFlightSegment,
  ReservationHistoryText,
  ReservationHistoryTransaction,
} from '../reservation/reservation-history.js';

/** Un PNR del fake, con los campos que Sabre manda en `Line`. */
export interface QueueFakePnr {
  /** Localizador de 6 caracteres alfanuméricos. */
  locator: string;
  /**
   * Las líneas del PNR en formato de host, como el `Paragraph` de Access Queue. Si no termina en
   * una línea de firma (`… HHMM/DDMMMYY <localizador> H`), el fake agrega una: `place` dentro de
   * una cola saca el localizador de ahí, igual que con Sabre.
   */
  paragraph?: readonly string[];
  /** `Line/DateTime`, tal cual. */
  placedAt?: string;
  /** `Line/POS/Source`. */
  placedBy?: { agentSine?: string; pseudoCityCode?: string };
  /** `Line/PassengerName`. Solo llega en `list` con `primaryPassenger: true`. */
  primaryPassenger?: string;
}

/**
 * Los contadores de `queue.activity` que se siembran para una cola. `numMessages` no va: sale
 * siempre de lo que hay en la cola del fake.
 */
export type QueueFakeActivity = Partial<Omit<QueueActivityCounters, 'numMessages'>>;

/**
 * Una transacción del historial de un PNR, como la devuelve `reservation.history`. Las listas que
 * falten van vacías.
 */
export type QueueFakeHistoryTransaction = Omit<
  ReservationHistoryTransaction,
  'flightSegments' | 'generalInfo' | 'remarks' | 'accounting'
> & {
  flightSegments?: readonly ReservationHistoryFlightSegment[];
  generalInfo?: readonly ReservationHistoryText[];
  remarks?: readonly ReservationHistoryText[];
  accounting?: readonly ReservationHistoryAccounting[];
};

/** Un PNR: sus campos, o solo el párrafo. Con solo el párrafo, el localizador sale de la línea de firma. */
export type QueueFakeItem = QueueFakePnr | readonly string[];

export interface QueueFakeOptions {
  /**
   * El contenido de cada cola, en orden. La clave es el número de cola (`'12'`, de 0 a 511), una
   * cola alfabética (`'S'`, una o dos letras mayúsculas) o una cola con nombre (`'name:HOTELS'`, o
   * `'HOTELS'` sin el prefijo). La alfabética y la con nombre viajan por atributos distintos
   * (`Number` y `Name`, ADR-028). El fake no distingue PCC: las colas son las mismas para cualquier
   * `pcc`.
   *
   * La `'S'` es la cola de mensajes: cada elemento es el texto de un mensaje (`string[]`), no un
   * PNR. `access` lo muestra sin `Line`, como Sabre en CERT, e `ignore` lo deja en la cola. Que
   * `remove` lo saque es un supuesto del fake: no se probó con Sabre.
   */
  queues?: Readonly<Record<string, readonly QueueFakeItem[]>>;
  /** PNR que no están en ninguna cola, para colocarlos con `place({ locators })`. */
  pnrs?: readonly QueueFakeItem[];
  /**
   * Los contadores de `queue.activity` por cola, con las mismas claves que `queues`. `numMessages`
   * sale del estado del fake, como en `count`: sin el PNR en pantalla (CERT, #167). Los demás valen
   * lo que se siembre aquí, o 0. Las acciones del fake (`ignore`, `remove`, `place`, `exit`) **no**
   * los cambian: no se probó qué contador sube Sabre con cada una (Q-097).
   */
  activity?: Readonly<Record<string, QueueFakeActivity>>;
  /**
   * El historial de cada PNR para `reservation.history`, por localizador. Un PNR que el fake
   * conoce y no está aquí devuelve una transacción sintética (la creación). Un localizador que
   * el fake no conoce da un error de host marcado como no simulado.
   */
  histories?: Readonly<Record<string, readonly QueueFakeHistoryTransaction[]>>;
  /** Reloj de las fechas de `count` y de `place`. Por defecto, `new Date()`. Las fechas van en UTC. */
  now?: () => Date;
}

/** Qué le pidió el SDK al fake. */
export type QueueFakeCommand =
  | 'open'
  | 'close'
  | 'ping'
  | 'count'
  | 'access'
  | 'list'
  | 'ignore'
  | 'remove'
  | 'exit'
  | 'place'
  | 'activity'
  | 'history';

export interface QueueFakeCall {
  command: QueueFakeCommand;
  /** La cola de `access` y `list`. */
  queue?: QueueRef;
  /** El localizador de `history`. */
  locator?: string;
}

export interface QueueFake {
  /** Se pasa como `config.fetch` de `SabreLegacy`. */
  readonly fetch: typeof fetch;
  /** Los localizadores de una cola, en orden, con lo que el recorrido haya sacado o colocado. */
  locators(queue: QueueRef): string[];
  /** El texto de los mensajes que siguen en la cola `S`, en orden. */
  messages(): string[][];
  /** Las llamadas recibidas, en orden. */
  readonly calls: readonly QueueFakeCall[];
  /** Cuántas sesiones siguen abiertas: sirve para comprobar que el consumidor las cierra. */
  readonly openSessions: number;
  /**
   * Vence todas las sesiones abiertas. La siguiente llamada de cada una recibe el fault de una
   * sesión vencida (`USG_INVALID_SECURITY_TOKEN`), y el SDK la convierte en `SabreSessionError`
   * con `kind: 'expired'`.
   */
  expireSessions(): void;
}

const SWS_NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';
const STL_NAMESPACE = 'http://services.sabre.com/STL/v01';
const SIGNATURE_DATE = '1200/01JAN26';
const LOCATOR = /^[A-Z0-9]{6}$/;
const NAVIGATION: Readonly<Record<string, QueueFakeCommand>> = { I: 'ignore', QR: 'remove', QXI: 'exit' };

type XmlNode = Record<string, unknown>;

interface Pnr {
  locator: string;
  paragraph: readonly string[];
  primaryPassenger: string | undefined;
}

/** Un PNR dentro de una cola: el PNR y los datos de su colocación. */
interface Entry {
  /** Vacío en un mensaje de la `S`. */
  locator: string;
  /** El texto de un mensaje de la `S`. */
  message?: readonly string[];
  placedAt: string | undefined;
  placedBy: { agentSine?: string; pseudoCityCode?: string } | undefined;
}

interface Session {
  conversationId: string;
  /** La cola en la que está la sesión y la posición del PNR en pantalla. */
  inside: { key: string; index: number } | undefined;
}

interface Reply {
  status: number;
  body: string;
}

function fail(message: string): never {
  throw new TypeError(`sabre-client/testing: ${message}`);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => name === 'QueueIdentifier' || name === 'UniqueID' || name === 'Selection',
});

function node(value: unknown): XmlNode | undefined {
  if (Array.isArray(value)) return node(value[0]);
  return typeof value === 'object' && value !== null ? (value as XmlNode) : undefined;
}

function nodes(value: unknown): XmlNode[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((item): item is XmlNode => node(item) !== undefined);
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim();
  const inner = node(value)?.['#text'];
  return typeof inner === 'string' ? inner.trim() : undefined;
}

function attr(value: unknown, name: string): string | undefined {
  const found = node(value)?.[`@${name}`];
  return typeof found === 'string' ? found : undefined;
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Clave interna de una cola (ADR-028): `'12'` (numérica), `'S'` (alfabética) o `'name:HOTELS'` (con
 * nombre). Las alfabéticas y las con nombre viajan por atributos distintos, así que no comparten clave.
 */
function queueKey(queue: QueueRef): string {
  if (typeof queue === 'number') return String(queue);
  if (typeof queue === 'string') return queue;
  return `${NAME_PREFIX}${queue.name}`;
}

const NAME_PREFIX = 'name:';
const ALPHA_KEY = /^[A-Z]{1,2}$/;

/**
 * Clave de `QueueFakeOptions.queues`: un número (`'12'`), una cola alfabética (`'S'`), o una con
 * nombre, como `'name:HOTELS'` o, sin el prefijo, `'HOTELS'`.
 */
function optionKey(key: string): string {
  if (key.startsWith(NAME_PREFIX) || /^\d+$/.test(key) || ALPHA_KEY.test(key)) return key;
  return `${NAME_PREFIX}${key}`;
}

/** La `QueueRef` de una clave interna. */
function refOfKey(key: string): QueueRef {
  if (key.startsWith(NAME_PREFIX)) return { name: key.slice(NAME_PREFIX.length) };
  return /^\d+$/.test(key) ? Number(key) : key;
}

/** Atributo de `QueueIdentifier` de una clave, como lo manda Sabre en la respuesta. */
function keyAttribute(key: string, pad = false): string {
  if (key.startsWith(NAME_PREFIX)) return `Name="${escape(key.slice(NAME_PREFIX.length))}"`;
  return `Number="${escape(pad && /^\d+$/.test(key) ? key.padStart(4, '0') : key)}"`;
}

function validateKey(key: string): void {
  if (/^\d+$/.test(key)) {
    const number = Number(key);
    if (number < MIN_QUEUE_NUMBER || number > MAX_QUEUE_NUMBER) fail(`la cola ${key} está fuera de 0–511`);
    return;
  }
  if (key.startsWith(NAME_PREFIX) ? key.slice(NAME_PREFIX.length).trim() === '' : key.trim() === '') {
    fail('el nombre de una cola no puede estar vacío');
  }
}

/** `MM-DDTHH:mm`, como el `DateTime` de `QueueCountRS` y `QueuePlaceRS`. */
function shortDate(date: Date): string {
  return date.toISOString().slice(5, 16);
}

/** `YYYY-MM-DDTHH:mm`, como el `Line/DateTime` real de Access Queue. */
function longDate(date: Date): string {
  return date.toISOString().slice(0, 16);
}

/** Un mensaje de `queues['S']`: una lista de líneas, con al menos una que no esté vacía. */
function toMessage(item: unknown, index: number): string[] {
  const label = `queues['${MESSAGE_QUEUE}'][${index}]`;
  if (!Array.isArray(item) || item.some((line) => typeof line !== 'string')) {
    fail(`${label}: la S es la cola de mensajes; cada elemento es el texto de un mensaje (string[])`);
  }
  const lines = item as string[];
  if (!lines.some((line) => line.trim() !== '')) fail(`${label}: el mensaje no puede estar vacío`);
  return [...lines];
}

function toPnr(item: QueueFakeItem, label: string): Pnr & Omit<Entry, 'locator'> {
  if (Array.isArray(item)) {
    const lines = item as readonly string[];
    const locator = signatureLocator(lines);
    if (locator === undefined) fail(`${label}: el párrafo no tiene línea de firma; pasa { locator, paragraph }`);
    return { locator, paragraph: [...lines], primaryPassenger: undefined, placedAt: undefined, placedBy: undefined };
  }
  const pnr = item as QueueFakePnr;
  if (typeof pnr !== 'object' || pnr === null || typeof pnr.locator !== 'string' || !LOCATOR.test(pnr.locator)) {
    fail(`${label}: locator debe ser de 6 caracteres alfanuméricos en mayúscula`);
  }
  const lines = [...(pnr.paragraph ?? [])];
  const signed = signatureLocator(lines);
  if (signed !== undefined && signed !== pnr.locator) fail(`${label}: la línea de firma es de ${signed}, no de ${pnr.locator}`);
  if (signed === undefined) lines.push(`XXXX.XXXX*AAA ${SIGNATURE_DATE} ${pnr.locator} H`);
  return {
    locator: pnr.locator,
    paragraph: lines,
    primaryPassenger: pnr.primaryPassenger,
    placedAt: pnr.placedAt,
    placedBy: pnr.placedBy,
  };
}

function envelope(action: string, conversationId: string, token: string | undefined, body: string): string {
  const security =
    token === undefined
      ? ''
      : `<wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext"><wsse:BinarySecurityToken valueType="String" EncodingType="wsse:Base64Binary">${escape(token)}</wsse:BinarySecurityToken></wsse:Security>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/"><soap-env:Header>',
    '<eb:MessageHeader xmlns:eb="http://www.ebxml.org/namespaces/messageHeader" eb:version="1.0" soap-env:mustUnderstand="1">',
    `<eb:ConversationId>${escape(conversationId)}</eb:ConversationId><eb:Action>${escape(action)}</eb:Action>`,
    '</eb:MessageHeader>',
    security,
    `</soap-env:Header><soap-env:Body>${body}</soap-env:Body></soap-env:Envelope>`,
  ].join('');
}

function results(status: 'Complete' | 'NotProcessed', inner: string): string {
  return `<stl:ApplicationResults status="${status}">${inner}</stl:ApplicationResults>`;
}

const success = '<stl:Success/>';

/** Un error de host con la forma real: `Message` sin `@code` y el código en `ShortText`. */
function hostResult(kind: 'Error' | 'Warning', message: string): string {
  return `<stl:${kind} type="BusinessLogic"><stl:SystemSpecificResults><stl:Message>${escape(message)}</stl:Message><stl:ShortText>ERR.SWS.HOST.ERROR_IN_RESPONSE</stl:ShortText></stl:SystemSpecificResults></stl:${kind}>`;
}

function textLines(lines: readonly string[]): string {
  return lines.map((line) => `<Text>${escape(line)}</Text>`).join('');
}

/** Lee la clave de una `QueueIdentifier` del request: `Number` (numérica o alfabética) o `Name`. */
function requestedKey(identifier: XmlNode | undefined): string | undefined {
  const number = attr(identifier, 'Number');
  if (number !== undefined) {
    const ref = toQueueRef(number);
    return ref === undefined ? undefined : queueKey(ref);
  }
  const name = attr(identifier, 'Name');
  return name === undefined ? undefined : `${NAME_PREFIX}${name}`;
}

const ACTIVITY_COUNTERS: ReadonlyArray<[keyof QueueFakeActivity, string]> = [
  ['ended', 'Ended'],
  ['ignored', 'Ignored'],
  ['moved', 'Moved'],
  ['removed', 'Removed'],
  ['transferred', 'Transferred'],
  ['leftMessageToContact', 'LeftMessageToContact'],
  ['unableToReach', 'UnableToReach'],
];

function toActivity(value: unknown, label: string): QueueFakeActivity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label} debe ser un objeto de contadores`);
  const known = new Set<string>(ACTIVITY_COUNTERS.map(([key]) => key));
  const result: QueueFakeActivity = {};
  for (const [key, count] of Object.entries(value)) {
    if (key === 'numMessages') fail(`${label}.numMessages sale de la cola del fake: no se siembra`);
    if (!known.has(key)) fail(`${label}.${key} no es un contador de queue.activity`);
    if (!Number.isInteger(count) || (count as number) < 0) fail(`${label}.${key} debe ser un entero de 0 en adelante`);
    result[key as keyof QueueFakeActivity] = count as number;
  }
  return result;
}

function toHistory(value: unknown, label: string): QueueFakeHistoryTransaction[] {
  if (!Array.isArray(value)) fail(`${label} debe ser una lista de transacciones`);
  return value.map((transaction: unknown, index) => {
    const at = `${label}[${index}]`;
    if (typeof transaction !== 'object' || transaction === null) fail(`${at} debe ser un objeto`);
    const t = transaction as QueueFakeHistoryTransaction;
    // Sin Action, el SDK no entiende la respuesta: se frena acá, con el lugar exacto.
    for (const [list, name] of [
      [t.flightSegments, 'flightSegments'],
      [t.generalInfo, 'generalInfo'],
      [t.remarks, 'remarks'],
    ] as const) {
      if (list === undefined) continue;
      if (!Array.isArray(list)) fail(`${at}.${name} debe ser una lista`);
      list.forEach((entry: { action?: unknown }, position: number) => {
        if (typeof entry?.action !== 'string' || entry.action.trim() === '') fail(`${at}.${name}[${position}].action debe ser un string no vacío`);
      });
    }
    if (t.accounting !== undefined && !Array.isArray(t.accounting)) fail(`${at}.accounting debe ser una lista`);
    return t;
  });
}

const attrs = (pairs: ReadonlyArray<[string, string | number | undefined]>): string =>
  pairs.map(([name, value]) => (value === undefined ? '' : ` ${name}="${escape(String(value))}"`)).join('');

/** Las líneas de un texto del historial, una por `Text`. */
const historyText = (text: string): string =>
  text.split('\n').map((line) => `<Text>${escape(line)}</Text>`).join('');

/** Una transacción como `HistoricalInfo`, en el orden de las respuestas de CERT. */
function historicalInfo(t: QueueFakeHistoryTransaction): string {
  const segments = (t.flightSegments ?? []).map((segment) =>
    [
      `<Item><FlightSegment${attrs([
        ['Action', segment.action],
        ['ArrivalDateTime', segment.arrivalDateTime],
        ['DepartureDateTime', segment.departureDateTime],
        ['FlightNumber', segment.flightNumber],
        ['NumberInParty', segment.numberInParty],
        ['ResBookDesigCode', segment.bookingClass],
        ['Status', segment.status],
      ])}>`,
      segment.destination === undefined ? '' : `<DestinationLocation${attrs([['LocationCode', segment.destination]])}/>`,
      segment.marketingAirline === undefined ? '' : `<MarketingAirline${attrs([['Code', segment.marketingAirline]])}/>`,
      segment.origin === undefined ? '' : `<OriginLocation${attrs([['LocationCode', segment.origin]])}/>`,
      segment.supplierRef === undefined ? '' : `<SupplierRef${attrs([['ID', segment.supplierRef]])}/>`,
      '</FlightSegment></Item>',
    ].join(''),
  );
  return [
    `<HistoricalInfo${attrs([['RPH', t.rph]])}>`,
    ...(t.generalInfo ?? []).map((entry) => `<GeneralInfo${attrs([['Action', entry.action]])}>${historyText(entry.text)}</GeneralInfo>`),
    segments.length === 0 ? '' : `<ItineraryInfo><ReservationItems>${segments.join('')}</ReservationItems></ItineraryInfo>`,
    (t.remarks ?? []).length === 0
      ? ''
      : `<RemarkInfo>${(t.remarks ?? []).map((entry) => `<Remark${attrs([['Action', entry.action]])}>${historyText(entry.text)}</Remark>`).join('')}</RemarkInfo>`,
    ...(t.accounting ?? []).map((entry) => `<AccountingInfo${attrs([['Action', entry.action], ['Type', entry.type], ['LinkCode', entry.linkCode]])}/>`),
    `<ItineraryRef><Source${attrs([
      ['AAA_PseudoCityCode', t.aaaPcc],
      ['CreateDateTime', t.createdAt],
      ['CreationAgent', t.agent],
      ['CreationAgentDutyCode', t.agentDutyCode],
      ['CreationAgentFunctionCode', t.agentFunctionCode],
      ['PseudoCityCode', t.pcc],
      ['ReceivedFrom', t.receivedFrom],
    ])}/></ItineraryRef>`,
    '</HistoricalInfo>',
  ].join('');
}

/** Lo que Sabre responde al historial de otro PNR con la sesión dentro de una cola (CERT, Q-102). */
const NOT_ALLOWED_INSIDE_QUEUE = 'NAK6 -NOT ALLOWED- FINISH OR IGNORE OTHER ACTIVITY';

export function createQueueFake(options: QueueFakeOptions = {}): QueueFake {
  if (typeof options !== 'object' || options === null) fail('options debe ser un objeto');
  const now = options.now ?? (() => new Date());
  if (typeof now !== 'function') fail('now debe ser una función');

  const pnrs = new Map<string, Pnr>();
  const queues = new Map<string, Entry[]>();
  const sessions = new Map<string, Session>();
  const calls: QueueFakeCall[] = [];
  let tokens = 0;

  const register = (item: QueueFakeItem, label: string): Pnr & Omit<Entry, 'locator'> => {
    const pnr = toPnr(item, label);
    const known = pnrs.get(pnr.locator);
    if (known !== undefined && JSON.stringify(known.paragraph) !== JSON.stringify(pnr.paragraph)) {
      fail(`${label}: el PNR ${pnr.locator} aparece con dos párrafos distintos`);
    }
    if (known === undefined) {
      pnrs.set(pnr.locator, { locator: pnr.locator, paragraph: pnr.paragraph, primaryPassenger: pnr.primaryPassenger });
    }
    return pnr;
  };

  for (const [optionName, items] of Object.entries(options.queues ?? {})) {
    const key = optionKey(optionName);
    validateKey(key);
    if (!Array.isArray(items)) fail(`queues['${key}'] debe ser una lista`);
    if (key === MESSAGE_QUEUE) {
      queues.set(key, items.map((item, index) => ({ locator: '', placedAt: undefined, placedBy: undefined, message: toMessage(item, index) })));
      continue;
    }
    queues.set(
      key,
      items.map((item, index) => {
        const { locator, placedAt, placedBy } = register(item, `queues['${key}'][${index}]`);
        return { locator, placedAt, placedBy };
      }),
    );
  }
  for (const [index, item] of (options.pnrs ?? []).entries()) register(item, `pnrs[${index}]`);

  const activity = new Map<string, QueueFakeActivity>();
  for (const [optionName, counters] of Object.entries(options.activity ?? {})) {
    const key = optionKey(optionName);
    validateKey(key);
    activity.set(key, toActivity(counters, `activity['${key}']`));
  }
  const histories = new Map<string, QueueFakeHistoryTransaction[]>();
  for (const [locator, transactions] of Object.entries(options.histories ?? {})) {
    if (!LOCATOR.test(locator)) fail(`histories['${locator}']: la clave debe ser un localizador de 6 caracteres alfanuméricos en mayúscula`);
    histories.set(locator, toHistory(transactions, `histories['${locator}']`));
  }

  const queue = (key: string): Entry[] => {
    let entries = queues.get(key);
    if (entries === undefined) {
      entries = [];
      queues.set(key, entries);
    }
    return entries;
  };

  // --- Respuestas de sesión ---------------------------------------------------------------

  const invalidToken = (conversationId: string, token: string | undefined): Reply => ({
    status: 500,
    body: envelope(
      'ErrorRS',
      conversationId,
      token,
      `<soap-env:Fault><faultcode>soap-env:Client.InvalidSecurityToken</faultcode><faultstring>Invalid or Expired binary security token: ${escape(token ?? '')}</faultstring><detail><StackTrace>com.sabre.universalservices.base.session.SessionException: errors.session.USG_INVALID_SECURITY_TOKEN</StackTrace></detail></soap-env:Fault>`,
    ),
  });

  const reply = (action: string, session: Session, token: string, body: string): Reply => ({
    status: 200,
    body: envelope(action, session.conversationId, token, body),
  });

  // --- Colas --------------------------------------------------------------------------

  const lineXml = (entry: Entry, extra: { number?: number; passenger?: boolean } = {}): string => {
    const pnr = pnrs.get(entry.locator);
    const source =
      entry.placedBy === undefined
        ? ''
        : `<POS><Source${entry.placedBy.agentSine === undefined ? '' : ` AgentSine="${escape(entry.placedBy.agentSine)}"`}${entry.placedBy.pseudoCityCode === undefined ? '' : ` PseudoCityCode="${escape(entry.placedBy.pseudoCityCode)}"`}/></POS>`;
    return [
      extra.number === undefined ? '<Line>' : `<Line Number="${extra.number}">`,
      entry.placedAt === undefined ? '' : `<DateTime>${escape(entry.placedAt)}</DateTime>`,
      source,
      extra.passenger === true && pnr?.primaryPassenger !== undefined ? `<PassengerName>${escape(pnr.primaryPassenger)}</PassengerName>` : '',
      `<UniqueID ID="${escape(entry.locator)}"/>`,
      '</Line>',
    ].join('');
  };

  const accessRS = (inner: string): string =>
    `<QueueAccessRS xmlns="${SWS_NAMESPACE}" xmlns:stl="${STL_NAMESPACE}" Version="2.1.1">${inner}</QueueAccessRS>`;
  const placeRS = (inner: string): string =>
    `<QueuePlaceRS xmlns="${SWS_NAMESPACE}" xmlns:stl="${STL_NAMESPACE}" Version="2.0.4">${inner}</QueuePlaceRS>`;
  const accessError = (message: string): string => accessRS(results('NotProcessed', hostResult('Error', message)));
  const placeError = (message: string): string => placeRS(results('NotProcessed', hostResult('Error', message)));

  /** El paso en el que queda la sesión: el PNR en pantalla o el fin de cola. */
  const step = (session: Session): string => {
    const inside = session.inside;
    const entry = inside === undefined ? undefined : queue(inside.key)[inside.index];
    if (entry === undefined) {
      session.inside = undefined;
      return accessRS(`${results('Complete', success)}<Paragraph>${textLines([END_OF_DISPLAY])}</Paragraph>`);
    }
    if (entry.message !== undefined) {
      return accessRS(`${results('Complete', success)}<Paragraph>${textLines(entry.message)}</Paragraph>`);
    }
    const pnr = pnrs.get(entry.locator)!;
    return accessRS(`${results('Complete', success)}${lineXml(entry)}<Paragraph>${textLines(pnr.paragraph)}</Paragraph>`);
  };

  /** Cuántos hay en una cola para `count` y `activity`: sin el PNR en pantalla (producción, #96; CERT, #167). */
  const waiting = (session: Session, key: string, entries: readonly Entry[]): number =>
    entries.length - (session.inside?.key === key && entries[session.inside.index] !== undefined ? 1 : 0);

  const count = (session: Session, rq: XmlNode): string => {
    const pcc = attr(node(node(rq.QueueInfo)?.QueueIdentifier), 'PseudoCityCode') ?? '';
    let pnrsTotal = 0;
    let messages = 0;
    const identifiers: string[] = [];
    for (const [key, entries] of queues) {
      // Con un PNR en pantalla, su cola no lo cuenta (producción, #96).
      const total = waiting(session, key, entries);
      if (total <= 0) continue;
      identifiers.push(`<QueueIdentifier Count="${total}" ${keyAttribute(key)}/>`);
      // Las alfabéticas (la S) son de mensajes; las numéricas y las con nombre, de PNR.
      if (ALPHA_KEY.test(key)) messages += total;
      else pnrsTotal += total;
    }
    return `<QueueCountRS xmlns="${SWS_NAMESPACE}" xmlns:stl="${STL_NAMESPACE}" Version="2.2.1">${results('Complete', success)}<QueueInfo DateTime="${shortDate(now())}" PseudoCityCode="${escape(pcc)}">${identifiers.join('')}</QueueInfo><Totals Count="${messages}" Type="MESSAGES"/><Totals Count="0" Type="SPECIALS"/><Totals Count="${pnrsTotal}" Type="PNRS"/></QueueCountRS>`;
  };

  const access = (session: Session, rq: XmlNode): string => {
    const navigation = attr(rq.Navigation, 'Action');
    if (navigation !== undefined) return navigate(session, rq, navigation);

    const identifier = node(rq.QueueIdentifier);
    const key = requestedKey(identifier);
    if (key === undefined) return accessError('sabre-client/testing: QueueIdentifier sin Number ni Name');
    const isList = node(identifier?.List) !== undefined;
    calls.push({ command: isList ? 'list' : 'access', queue: refOfKey(key) });

    if (nodes(rq.Selection).length > 0) return accessError('sabre-client/testing: selection no está simulado');
    const entries = queue(key);
    if (entries.length === 0) return accessError(QUEUE_EMPTY);

    if (isList) {
      const passenger = attr(identifier?.List, 'PrimaryPassenger') === 'true';
      const lines = entries.map((entry, index) => lineXml(entry, { number: index + 1, passenger })).join('');
      return accessRS(`${results('Complete', success)}${lines}`);
    }
    session.inside = { key, index: 0 };
    return step(session);
  };

  const navigate = (session: Session, rq: XmlNode, action: string): string => {
    const command = NAVIGATION[action];
    if (command === undefined) return accessError(`sabre-client/testing: Navigation ${action} no está simulado`);
    calls.push({ command });
    const inside = session.inside;
    if (action === 'QXI') {
      if (inside === undefined) return accessError(OFF_QUEUE);
      session.inside = undefined;
      return accessRS(results('Complete', success));
    }
    // Fuera de una cola, producción responde `IGD` a `I`. Se supone lo mismo para `QR`.
    if (inside === undefined) return accessError('IGD');
    const current = queue(inside.key)[inside.index];
    if (current === undefined) return step(session);

    if (action === 'I') {
      inside.index += 1;
      return step(session);
    }
    const from = nodes(rq.QueueIdentifier).map((identifier) => requestedKey(identifier) ?? '');
    const targets = from.length === 0 ? [inside.key] : from;
    for (const key of targets) {
      const entries = queue(key);
      const position = key === inside.key ? inside.index : entries.findIndex((entry) => entry.locator === current.locator);
      if (position >= 0 && entries[position]?.locator === current.locator) entries.splice(position, 1);
    }
    // Si no salió de la cola en curso, el cursor avanza como con `I`.
    if (!targets.includes(inside.key)) inside.index += 1;
    return step(session);
  };

  const place = (session: Session, rq: XmlNode): string => {
    calls.push({ command: 'place' });
    const info = node(rq.QueueInfo);
    const targets = nodes(info?.QueueIdentifier).map((identifier) => ({
      key: requestedKey(identifier) ?? '',
      pcc: attr(identifier, 'PseudoCityCode'),
      instructionCode: attr(identifier, 'PrefatoryInstructionCode'),
    }));
    const locators = nodes(info?.UniqueID).map((id) => attr(id, 'ID') ?? '');
    const inside = session.inside;
    const moving = inside !== undefined && locators.length === 0;

    // Producción pide el PIC siempre, aunque el design lo dé como opcional (#97).
    if (targets.some((target) => target.instructionCode === undefined)) {
      return placeError(moving ? 'NEED INSTRUCTION NUMBER' : 'INSTRUCTION NUMBER NOT IN RANGE');
    }
    for (const target of targets) validateKey(target.key);
    if (targets.some((target) => target.key === MESSAGE_QUEUE)) return placeError('sabre-client/testing: place a la cola S no está simulado');

    const at = now();
    const add = (locator: string, target: (typeof targets)[number]): void => {
      const entries = queue(target.key);
      if (entries.some((entry) => entry.locator === locator)) return;
      entries.push({
        locator,
        placedAt: longDate(at),
        placedBy: target.pcc === undefined ? undefined : { pseudoCityCode: target.pcc },
      });
    };

    if (moving) {
      const current = queue(inside.key)[inside.index];
      if (current === undefined) return placeError('sabre-client/testing: no hay PNR en pantalla');
      // El PNR se mueve: sale de la cola en curso y queda en las de destino (#97).
      queue(inside.key).splice(inside.index, 1);
      for (const target of targets) add(current.locator, target);
      const next = queue(inside.key)[inside.index];
      if (next === undefined) {
        session.inside = undefined;
        return placeRS(results('Complete', `${success}${hostResult('Warning', END_OF_DISPLAY)}`));
      }
      return placeRS(`${results('Complete', success)}${textLines(pnrs.get(next.locator)!.paragraph)}`);
    }

    // El fake no lleva el AAA fuera de una cola: sin localizadores no hay qué colocar.
    if (locators.length === 0) return placeError('sabre-client/testing: place fuera de una cola necesita locators');
    if (locators.some((locator) => !pnrs.has(locator))) return placeError('BAD PNR LOCATOR');
    const placements: string[] = [];
    for (const locator of locators) {
      for (const target of targets) {
        add(locator, target);
        const identifier = keyAttribute(target.key, true);
        const pcc = target.pcc === undefined ? '' : ` PseudoCityCode="${escape(target.pcc)}"`;
        placements.push(`<QueueInfo DateTime="${shortDate(at)}"><QueueIdentifier ${identifier}${pcc}/><UniqueID ID="${escape(locator)}"/></QueueInfo>`);
      }
    }
    return placeRS(`${results('Complete', success)}${placements.join('')}`);
  };

  // --- Get Queue Activity y Get Itinerary History ------------------------------------------

  const analyze = (session: Session, rq: XmlNode): string => {
    calls.push({ command: 'activity' });
    const pcc = attr(node(node(rq.QueueInfo)?.QueueIdentifier), 'PseudoCityCode') ?? '';
    const totals: Record<string, number> = { NumMessages: 0 };
    for (const [, element] of ACTIVITY_COUNTERS) totals[element] = 0;
    const identifiers: string[] = [];
    // Las colas del fake y las sembradas, una vez cada una. Como Sabre, se listan también colas
    // vacías con contadores, y no las que están en cero.
    for (const key of new Set([...queues.keys(), ...activity.keys()])) {
      const seeded = activity.get(key) ?? {};
      const counters: Record<string, number> = { NumMessages: waiting(session, key, queues.get(key) ?? []) };
      for (const [name, element] of ACTIVITY_COUNTERS) counters[element] = seeded[name] ?? 0;
      if (Object.values(counters).every((value) => value === 0)) continue;
      for (const [element, value] of Object.entries(counters)) totals[element] = (totals[element] ?? 0) + value;
      identifiers.push(
        `<QueueIdentifier ${keyAttribute(key)}>${Object.entries(counters).map(([element, value]) => `<${element} Count="${value}"/>`).join('')}</QueueIdentifier>`,
      );
    }
    const totalsXml = Object.entries(totals).map(([element, value]) => `<${element} Count="${value}"/>`).join('');
    return `<QueueAnalysisRS xmlns="${SWS_NAMESPACE}" xmlns:stl="${STL_NAMESPACE}" Version="2.0.0">${results('Complete', success)}<QueueInfo DateTime="${shortDate(now())}" PseudoCityCode="${escape(pcc)}">${identifiers.join('')}</QueueInfo><Totals>${totalsXml}</Totals></QueueAnalysisRS>`;
  };

  const history = (session: Session, rq: XmlNode): string => {
    const locator = attr(rq.UniqueID, 'ID') ?? '';
    calls.push({ command: 'history', locator });
    const historyRS = (inner: string): string =>
      `<TravelItineraryHistoryRS xmlns="${SWS_NAMESPACE}" xmlns:stl="${STL_NAMESPACE}" Version="2.4.0">${inner}</TravelItineraryHistoryRS>`;
    const historyError = (message: string): string => historyRS(results('NotProcessed', hostResult('Error', message)));

    // Dentro de una cola, Sabre rechaza el historial de otro PNR (CERT, Q-102) y acepta el del PNR
    // en pantalla (CERT, #167).
    const inside = session.inside;
    const current = inside === undefined ? undefined : queue(inside.key)[inside.index];
    if (current !== undefined && current.locator !== locator) return historyError(NOT_ALLOWED_INSIDE_QUEUE);

    const seeded = histories.get(locator);
    if (seeded !== undefined) return historyRS(`${results('Complete', success)}${seeded.map(historicalInfo).join('')}`);
    if (!pnrs.has(locator)) return historyError(`sabre-client/testing: el PNR ${locator} no está en el fake (qué responde Sabre no está simulado)`);
    const created: QueueFakeHistoryTransaction = { rph: 1, createdAt: longDate(now()), agent: 'AAA', pcc: 'XXXX', receivedFrom: 'SABRE-CLIENT/TESTING' };
    return historyRS(`${results('Complete', success)}${historicalInfo(created)}`);
  };

  // --- Despacho --------------------------------------------------------------------------

  const handle = (raw: string): Reply => {
    let document: XmlNode | undefined;
    try {
      document = node(node(parser.parse(raw))?.Envelope);
    } catch {
      document = undefined;
    }
    const header = node(document?.Header);
    const messageHeader = node(header?.MessageHeader);
    const action = text(messageHeader?.Action) ?? '';
    const conversationId = text(messageHeader?.ConversationId) ?? '';
    const token = text(node(header?.Security)?.BinarySecurityToken);
    const body = node(document?.Body);
    const [, payload] = Object.entries(body ?? {}).find(([name]) => !name.startsWith('@')) ?? [];
    const rq = node(payload) ?? {};

    if (action === 'SessionCreateRQ') {
      calls.push({ command: 'open' });
      tokens += 1;
      const newToken = `Shared/IDL:IceSess\\/SessMgr:1\\.0.IDL/Common/!ICESMS\\/FAKE!${tokens}!0`;
      sessions.set(newToken, { conversationId, inside: undefined });
      const version = attr(rq, 'Version') === '2.0.0' ? '2.0.0' : '1.0.0';
      return {
        status: 200,
        body: envelope(
          'SessionCreateRS',
          conversationId,
          newToken,
          `<SessionCreateRS xmlns="http://www.opentravel.org/OTA/2002/11" version="${version}" status="Approved"><ConversationId>${escape(conversationId)}</ConversationId></SessionCreateRS>`,
        ),
      };
    }

    const session = token === undefined ? undefined : sessions.get(token);
    if (session === undefined || token === undefined) return invalidToken(conversationId, token);

    switch (action) {
      case 'SessionCloseRQ':
        calls.push({ command: 'close' });
        sessions.delete(token);
        return reply('SessionCloseRS', session, token, '<SessionCloseRS xmlns="http://www.opentravel.org/OTA/2002/11" version="1" status="Approved"/>');
      case 'OTA_PingRQ': {
        calls.push({ command: 'ping' });
        const echo = text(rq.EchoData) ?? '';
        return reply(
          'OTA_PingRS',
          session,
          token,
          `<OTA_PingRS xmlns="http://www.opentravel.org/OTA/2003/05" TimeStamp="${now().toISOString().slice(0, 19)}Z" Version="1.0.0"><Success/><EchoData>${escape(echo)}</EchoData></OTA_PingRS>`,
        );
      }
      case 'QueueCountLLSRQ':
        calls.push({ command: 'count' });
        return reply('QueueCountLLSRS', session, token, count(session, rq));
      case 'QueueAccessLLSRQ':
        return reply('QueueAccessLLSRS', session, token, access(session, rq));
      case 'QueuePlaceLLSRQ':
        return reply('QueuePlaceLLSRS', session, token, place(session, rq));
      case 'QueueAnalysisLLSRQ':
        return reply('QueueAnalysisLLSRS', session, token, analyze(session, rq));
      case 'TravelItineraryHistoryLLSRQ':
        return reply('TravelItineraryHistoryLLSRS', session, token, history(session, rq));
      default:
        return {
          status: 500,
          body: envelope(
            'ErrorRS',
            conversationId,
            token,
            `<soap-env:Fault><faultcode>soap-env:Client.InvalidAction</faultcode><faultstring>sabre-client/testing: ${escape(action)} no está simulado</faultstring></soap-env:Fault>`,
          ),
        };
    }
  };

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const raw = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : String(init?.body ?? '');
    const { status, body } = handle(raw);
    return new Response(body, { status, headers: { 'Content-Type': 'text/xml;charset=UTF-8' } });
  };

  return {
    fetch: fakeFetch as typeof fetch,
    locators: (ref) => (queues.get(queueKey(ref)) ?? []).filter((entry) => entry.message === undefined).map((entry) => entry.locator),
    messages: () => (queues.get(MESSAGE_QUEUE) ?? []).map((entry) => [...(entry.message ?? [])]),
    get calls() {
      return [...calls];
    },
    get openSessions() {
      return sessions.size;
    },
    expireSessions() {
      sessions.clear();
    },
  };
}
