// Search For Itineraries por fecha de modificación (`Trip_SearchRQ` 4.5.0, vista `TripSearchTN`).
// Ver sabre-wiki/wiki/proyectos/sabre-client/decisiones/trip-search-por-fecha-de-modificacion.md
// (ADR-033), wiki/sources/trip-searchrq-v4-5-0.md y wiki/entities/search-for-itineraries.md.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreBusinessError, type SabreBusinessErrorOptions, SabreGatewayError } from '../errors/index.js';
import { asArray, type SoapResponse, textOf, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';

export const TRIP_SEARCH_SERVICE = 'tripSearch';
const NAMESPACE = 'http://webservices.sabre.com/triprecord';
/** El tope de una búsqueda síncrona según la guía (el change log dice 500: Q-136). */
export const TRIP_SEARCH_MAX_ITEMS = 800;

export type TripSearchType = 'ACTIVE' | 'INACTIVE' | 'BOTH';

export interface SearchByUpdateDateRequest {
  /** PCC de la búsqueda (`PosCriteria/Pcc`), de 3 o 4 caracteres. Va por operación, sin cambiar de AAA. */
  pcc: string;
  /** Inicio de la ventana: un instante, `Date` o ISO 8601 **con** `Z` u offset. */
  from: Date | string;
  /** Fin de la ventana: un instante posterior a `from`. */
  to: Date | string;
  /**
   * Zona IANA del PCC, p. ej. `'America/Mexico_City'`. **Obligatoria y sin default**: Sabre lee
   * `After`/`Before` en hora local, sin zona, y el SDK no conoce la del PCC.
   */
  timeZone: string;
  /**
   * `true` (default): todos los PNR que el PCC puede ver. `false`: solo los que creó ese PCC, así
   * que se pierden los creados por otro PCC y emitidos por este (producción, 2026-11-16).
   */
  anyBranch?: boolean;
  /** `ACTIVE` (default), `INACTIVE` (PNR ya depurados, "Past Date") o `BOTH`. */
  searchType?: TripSearchType;
  /**
   * `MaxItemsReturned`, de 1 a 800. Default 800. Si hay más PNR que esto, Sabre no corta: responde
   * `200206` sin lista y el SDK lanza `SabreTripSearchError` con `TOO_MANY_RESULTS` (CERT,
   * 2026-11-16). Hay que partir la ventana.
   */
  maxItems?: number;
}

export type SearchByUpdateDateOptions = RequestOptions;

export interface SearchByUpdateDateReservation {
  locator: string;
  /** Solo si la vista lo trae. **`TripSearchTN`, la que manda el SDK, no lo trae**: no contar con él. */
  updatedAt?: string;
  /** `Reservation@PastDate`: un PNR ya depurado (con `searchType` `INACTIVE` o `BOTH`). */
  pastDate?: boolean;
}

/** Una advertencia de la búsqueda: de Sabre, de un `Reservation@Error` o `TIMEZONE_MISMATCH`. */
export interface SearchByUpdateDateWarning {
  /** `ErrorCode` de Sabre (`200005`, `200006`), `RESERVATION_ERROR` o `TIMEZONE_MISMATCH`. */
  code?: string;
  message: string;
}

export interface SearchByUpdateDateResult {
  /**
   * `truncated` si `totalResults > numberResults`, `NumberPages > 1` o llega la advertencia
   * `200006` ("Number of results exceeded view limit or requested PNRs limit"). No es un error:
   * hay que partir la ventana y volver a pedir. **No es lo que pasa al exceder `maxItems`**: ahí
   * Sabre responde `200206` y el SDK lanza `TOO_MANY_RESULTS` (CERT, 2026-11-16). `truncated`
   * queda para la forma que describe la guía, que todavía no se vio en Sabre (Q-136).
   */
  status: 'complete' | 'truncated';
  pcc: string;
  anyBranch: boolean;
  /**
   * `from` y `to` como instantes UTC (ISO con `Z`, al segundo) y `after`/`before` tal como se
   * mandaron a Sabre, en hora local de `timeZone`.
   */
  window: { from: string; to: string; after: string; before: string; timeZone: string };
  /** Sin repetidos, en el orden de la respuesta. */
  reservations: SearchByUpdateDateReservation[];
  numberResults: number;
  totalResults: number;
  warnings: SearchByUpdateDateWarning[];
  /** `eb:Timestamp` de la respuesta, en UTC con `Z`. Base del corte de la pasada siguiente. */
  respondedAt: string;
  /**
   * Offset de la hora local de Sabre en ese instante, en minutos (`-360` es UTC-6): el `TimeStamp`
   * de la raíz (local, sin zona) menos `eb:Timestamp` (UTC), redondeado a 15 min. Falta si la
   * respuesta no trae alguno de los dos.
   */
  sabreLocalOffsetMinutes?: number;
}

/** Por qué falló una búsqueda (ADR-033). */
export type TripSearchErrorReason =
  | 'NO_PRIMARY_CRITERIA'
  | 'CRITERIA_TOO_WEAK'
  | 'TOO_MANY_RESULTS'
  | 'SEARCH_TIMEOUT'
  | 'PCC_NOT_ACCESSIBLE'
  | 'UNKNOWN';

export interface SabreTripSearchErrorOptions extends Omit<SabreBusinessErrorOptions, 'service'> {
  reason: TripSearchErrorReason;
  /** `Error@Severity`, tal cual (`MINOR`, `MODERATE`…). */
  severity?: string;
}

/**
 * Un `Errors/Error` de `Trip_SearchRS`. Es un `SabreBusinessError` (`service: 'tripSearch'`) con
 * `reason` tipado; `code`, `severity` y el texto (`message`) son los de Sabre. Se clasifica por
 * código y, si no lo hay, por el texto. Los errores no se vieron con un caso real: la forma sale
 * de la guía, y uno con otra forma sale como `UNKNOWN`.
 */
export class SabreTripSearchError extends SabreBusinessError {
  override name = 'SabreTripSearchError';
  readonly reason: TripSearchErrorReason;
  readonly severity: string | undefined;

  constructor(message: string, options: SabreTripSearchErrorOptions) {
    super(message, { ...options, service: TRIP_SEARCH_SERVICE });
    this.reason = options.reason;
    this.severity = options.severity;
  }
}

// ---------- Request ----------

const PCC = /^[A-Z0-9]{3,4}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const SEARCH_TYPES: readonly TripSearchType[] = ['ACTIVE', 'INACTIVE', 'BOTH'];

function fail(message: string): never {
  throw new TypeError(`sabre-client: reservation.searchByUpdateDate: ${message}`);
}

function instantOf(value: unknown, field: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(`${field} es un Date inválido`);
    return value;
  }
  if (typeof value !== 'string') fail(`${field} debe ser un Date o un string ISO 8601 con zona`);
  if (!INSTANT.test(value)) fail(`${field} debe ser ISO 8601 con Z u offset (recibido: ${value}): sin zona es ambiguo`);
  const time = Date.parse(value);
  if (Number.isNaN(time)) fail(`${field} no es una fecha válida (recibido: ${value})`);
  return new Date(time);
}

/** El formateador de `timeZone`; una zona que `Intl` no conoce lanza `TypeError`. */
function formatterOf(timeZone: unknown): Intl.DateTimeFormat {
  if (typeof timeZone !== 'string' || timeZone === '') fail('timeZone es obligatoria: la zona IANA del PCC, p. ej. America/Mexico_City');
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    fail(`timeZone no es una zona IANA válida (recibido: ${timeZone})`);
  }
}

/** La hora local de `instant` en la zona del formateador, `YYYY-MM-DDTHH:MM:SS`. */
function localTime(formatter: Intl.DateTimeFormat, instant: Date): string {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Offset de la zona en `instant`, en minutos (`-360` es UTC-6). */
function offsetMinutes(formatter: Intl.DateTimeFormat, instant: Date): number {
  const seconds = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((Date.parse(`${localTime(formatter, instant)}Z`) - seconds) / 60_000);
}

const utcSeconds = (instant: Date) => instant.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** @internal Lo validado del request, con los valores por defecto. */
export interface ResolvedSearchByUpdateDate {
  pcc: string;
  anyBranch: boolean;
  searchType: TripSearchType;
  maxItems: number;
  formatter: Intl.DateTimeFormat;
  window: SearchByUpdateDateResult['window'];
}

/** Valida el request sin red y lo resuelve: `TypeError` si algo no tiene la forma esperada. */
export function resolveSearchByUpdateDateRequest(request: SearchByUpdateDateRequest): ResolvedSearchByUpdateDate {
  if (typeof request !== 'object' || request === null) fail('recibe { pcc, from, to, timeZone, anyBranch?, searchType?, maxItems? }');
  const { pcc, anyBranch = true, searchType = 'ACTIVE', maxItems = TRIP_SEARCH_MAX_ITEMS } = request;
  if (typeof pcc !== 'string' || !PCC.test(pcc)) fail('pcc debe tener 3 o 4 letras mayúsculas o dígitos');
  const formatter = formatterOf(request.timeZone);
  const from = instantOf(request.from, 'from');
  const to = instantOf(request.to, 'to');
  if (from.getTime() >= to.getTime()) fail('from debe ser anterior a to');
  if (typeof anyBranch !== 'boolean') fail('anyBranch debe ser un boolean');
  if (!SEARCH_TYPES.includes(searchType)) fail(`searchType debe ser ${SEARCH_TYPES.join(', ')}`);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > TRIP_SEARCH_MAX_ITEMS) fail(`maxItems debe ser un entero de 1 a ${TRIP_SEARCH_MAX_ITEMS}`);
  return {
    pcc,
    anyBranch,
    searchType,
    maxItems,
    formatter,
    window: { from: utcSeconds(from), to: utcSeconds(to), after: localTime(formatter, from), before: localTime(formatter, to), timeZone: request.timeZone },
  };
}

/** Cuerpo de `Trip_SearchRQ`. Nunca lleva `ResultAction`: podría colocar los PNR en una cola. */
export function searchByUpdateDatePayload(resolved: ResolvedSearchByUpdateDate): string {
  const { pcc, anyBranch, searchType, maxItems, window } = resolved;
  return [
    `<Trip_SearchRQ Version="4.5.0" xmlns="${NAMESPACE}"><ReadRequests><ReservationReadRequest>`,
    `<DateCriteria><UpdateDate After="${xmlEscape(window.after)}" Before="${xmlEscape(window.before)}"/></DateCriteria>`,
    `<PosCriteria AnyBranch="${anyBranch}"><Pcc>${xmlEscape(pcc)}</Pcc></PosCriteria>`,
    `<ReturnOptions ViewName="TripSearchTN" ResponseFormat="STL" SearchType="${searchType}" MaxItemsReturned="${maxItems}"/>`,
    '</ReservationReadRequest></ReadRequests></Trip_SearchRQ>',
  ].join('');
}

/** Es una lectura: entra en la política de reintentos de transporte. No hay reintentos de negocio. */
export function searchByUpdateDateRequest(resolved: ResolvedSearchByUpdateDate, options: SearchByUpdateDateOptions): SessionRequest {
  return {
    service: TRIP_SEARCH_SERVICE,
    action: 'Trip_SearchRQ',
    payload: searchByUpdateDatePayload(resolved),
    idempotent: true,
    operation: 'reservation.searchByUpdateDate',
    ...options,
  };
}

// ---------- Respuesta ----------

type XmlNode = Record<string, unknown>;

const node = (value: unknown): XmlNode | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'object' && first !== null ? (first as XmlNode) : undefined;
};
const attribute = (value: unknown, name: string): string | undefined => {
  const found = node(value)?.[`@${name}`];
  return typeof found === 'string' ? found : undefined;
};
const integer = (value: string | undefined): number | undefined => (value !== undefined && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined);
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

interface TripSearchMessage {
  code?: string;
  severity?: string;
  message: string;
}

/** `Errors/Error` y `Warnings/Warning`, con el código, la severidad y el texto como atributos o elementos. */
function messagesOf(payload: XmlNode): TripSearchMessage[] {
  const entries = [...asArray(node(payload.Errors)?.Error), ...asArray(node(payload.Warnings)?.Warning)];
  return entries.map((entry) => {
    const element = node(entry);
    const code = attribute(entry, 'ErrorCode') ?? attribute(entry, 'Code') ?? textOf(element?.ErrorCode)?.trim();
    const severity = attribute(entry, 'Severity');
    const message = clean(attribute(entry, 'ErrorMessage') ?? attribute(entry, 'Message') ?? textOf(element?.ErrorMessage) ?? textOf(entry) ?? '');
    const found: TripSearchMessage = { message };
    if (code !== undefined && code !== '') found.code = code;
    if (severity !== undefined) found.severity = severity;
    return found;
  });
}

const MAX_EXCEEDED = /max(imum)? number of requested pnrs exceeded/i;
const TRUNCATED = /number of results exceeded/i;
const isMaxExceeded = (message: TripSearchMessage) => message.code === '200005' || MAX_EXCEEDED.test(message.message);
const isTruncation = (message: TripSearchMessage) => message.code === '200006' || TRUNCATED.test(message.message);

const REASONS_BY_CODE: Record<string, TripSearchErrorReason> = {
  '200204': 'NO_PRIMARY_CRITERIA',
  '200205': 'NO_PRIMARY_CRITERIA',
  '200207': 'CRITERIA_TOO_WEAK',
  '200206': 'TOO_MANY_RESULTS',
  '200203': 'SEARCH_TIMEOUT',
  '200208': 'PCC_NOT_ACCESSIBLE',
  '200102': 'PCC_NOT_ACCESSIBLE',
};
const REASONS_BY_TEXT: ReadonlyArray<[RegExp, TripSearchErrorReason]> = [
  [/no primary criteria|no pos criteria/i, 'NO_PRIMARY_CRITERIA'],
  [/criteria too weak/i, 'CRITERIA_TOO_WEAK'],
  [/too many results/i, 'TOO_MANY_RESULTS'],
  [/timeout|timed out/i, 'SEARCH_TIMEOUT'],
  [/empty pcc list/i, 'PCC_NOT_ACCESSIBLE'],
];

/** El `reason` de un error: por código y, si el código no se conoce, por el texto. */
export function tripSearchReasonOf(code: string | undefined, message: string): TripSearchErrorReason {
  const byCode = code === undefined ? undefined : REASONS_BY_CODE[code];
  return byCode ?? REASONS_BY_TEXT.find(([pattern]) => pattern.test(message))?.[1] ?? 'UNKNOWN';
}

function tripSearchError(message: TripSearchMessage, response: SoapResponse, rest: SabreTripSearchError[] = []): SabreTripSearchError {
  const code = message.code ?? 'UNKNOWN';
  const options: SabreTripSearchErrorOptions = { code, reason: tripSearchReasonOf(message.code, message.message), raw: response.raw, errors: rest };
  if (message.severity !== undefined) options.severity = message.severity;
  return new SabreTripSearchError(`${TRIP_SEARCH_SERVICE}: ${code} ${message.message}`.trim(), options);
}

function malformed(detail: string, response: SoapResponse): SabreGatewayError {
  return new SabreGatewayError(`${TRIP_SEARCH_SERVICE}: respuesta no reconocida (${detail})`, { protocol: 'soap', retryable: false, raw: response.raw });
}

/** El `TimeStamp` de la raíz (hora local, sin zona) menos `respondedAt` (UTC), redondeado a 15 min. */
function sabreLocalOffset(payload: XmlNode, respondedAt: string): number | undefined {
  const local = attribute(payload, 'TimeStamp');
  if (local === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(local)) return undefined;
  const minutes = (Date.parse(`${local}Z`) - Date.parse(respondedAt)) / 60_000;
  if (!Number.isFinite(minutes)) return undefined;
  const rounded = Math.round(minutes / 15) * 15;
  return rounded === 0 ? 0 : rounded;
}

const formatOffset = (minutes: number) => {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
};

/**
 * Lee `Trip_SearchRS`. Un `Errors/Error` que no es una advertencia de tope lanza
 * `SabreTripSearchError`; `200005` y `200006` van a `warnings` (llegue como `Error` o como
 * `Warning`), y `200006` marca `truncated`.
 */
export function parseSearchByUpdateDateResponse(response: SoapResponse, resolved: ResolvedSearchByUpdateDate): SearchByUpdateDateResult {
  const { payload } = response;
  const messages = messagesOf(payload);
  const notices = messages.filter((message) => isMaxExceeded(message) || isTruncation(message));
  const errors = messages.filter((message) => !notices.includes(message));
  const [first, ...rest] = errors;
  if (first !== undefined) throw tripSearchError(first, response, rest.map((error) => tripSearchError(error, response)));

  const list = node(payload.ReservationsList);
  if (list === undefined) throw malformed('Trip_SearchRS sin ReservationsList ni Errors', response);
  const respondedAt = response.respondedAt;
  if (respondedAt === undefined) throw malformed('sin eb:Timestamp', response);

  const warnings: SearchByUpdateDateWarning[] = [
    ...response.warnings.map((warning) => (warning.code === undefined ? { message: warning.message } : { code: warning.code, message: warning.message })),
    ...notices.map((notice) => (notice.code === undefined ? { message: notice.message } : { code: notice.code, message: notice.message })),
  ];

  const seen = new Set<string>();
  const reservations: SearchByUpdateDateReservation[] = [];
  let listed = 0;
  for (const group of asArray(list.Reservations)) {
    for (const reservation of asArray(node(group)?.Reservation)) {
      const locator = attribute(reservation, 'Locator')?.trim();
      if (locator === undefined || locator === '') continue;
      listed += 1;
      const error = attribute(reservation, 'Error');
      if (error !== undefined && error.trim() !== '') warnings.push({ code: 'RESERVATION_ERROR', message: `${locator}: ${clean(error)}` });
      if (seen.has(locator)) continue;
      seen.add(locator);
      const pastDate = attribute(reservation, 'PastDate');
      reservations.push(pastDate === 'true' ? { locator, pastDate: true } : pastDate === 'false' ? { locator, pastDate: false } : { locator });
    }
  }

  const numberResults = integer(attribute(list, 'NumberResults')) ?? listed;
  const totalResults = integer(attribute(list, 'TotalResults')) ?? numberResults;
  const numberPages = integer(attribute(list, 'NumberPages')) ?? 1;
  const truncated = totalResults > numberResults || numberPages > 1 || notices.some(isTruncation);

  const offset = sabreLocalOffset(payload, respondedAt);
  if (offset !== undefined) {
    const expected = offsetMinutes(resolved.formatter, new Date(respondedAt));
    if (offset !== expected) {
      warnings.push({
        code: 'TIMEZONE_MISMATCH',
        message: `Sabre respondió en ${formatOffset(offset)} y ${resolved.window.timeZone} es ${formatOffset(expected)} en ese instante: la ventana puede estar corrida ${Math.abs(offset - expected)} min`,
      });
    }
  }

  const result: SearchByUpdateDateResult = {
    status: truncated ? 'truncated' : 'complete',
    pcc: resolved.pcc,
    anyBranch: resolved.anyBranch,
    window: resolved.window,
    reservations,
    numberResults,
    totalResults,
    warnings,
    respondedAt,
  };
  if (offset !== undefined) result.sabreLocalOffsetMinutes = offset;
  return result;
}
