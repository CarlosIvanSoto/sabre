// `reservation.searchByUpdateDate` en el fake (#251, ADR-033): PNR sembrados por PCC creador, con
// los PCC que los pueden ver y sus instantes de modificación. Solo Web Standard APIs.
import type { TripSearchErrorReason } from '../reservation/search-by-update-date.js';

/** Un PNR para `reservation.searchByUpdateDate`. */
export interface QueueFakeTripSearchReservation {
  locator: string;
  /** El PCC que lo creó: con `anyBranch: false` solo sale para este PCC. */
  createdBy: string;
  /** Otros PCC que lo pueden ver (Branch Access): con `anyBranch: true` también sale para ellos. */
  visibleTo?: readonly string[];
  /**
   * Los instantes en que cambió (creación, remark, emisión, cancelación…), `Date` o ISO 8601 con
   * zona. Sale en una búsqueda si alguno cae dentro de la ventana.
   */
  updatedAt: Date | string | ReadonlyArray<Date | string>;
  /** Un PNR ya depurado ("Past Date"): sale con `INACTIVE` o `BOTH`, no con `ACTIVE`. */
  pastDate?: boolean;
}

export interface QueueFakeTripSearch {
  reservations?: readonly QueueFakeTripSearchReservation[];
  /**
   * El tope de la vista. Default 800 (la guía; el change log dice 500). Con más resultados que
   * `maxItems` (y `maxItems` dentro del tope), responde `200206` sin lista, como Sabre en CERT
   * (2026-11-16), y el SDK lanza `TOO_MANY_RESULTS`. Solo si `maxItems` pasa del tope y los
   * resultados también, trae los primeros con `TotalResults` y la advertencia `200006`, y el SDK
   * da `status: 'truncated'`: ese caso no se vio en Sabre (Q-136).
   */
  limit?: number;
  /** Errores forzados, en orden: cada búsqueda consume el primero que queda. */
  errors?: readonly TripSearchErrorReason[];
}

const LOCATOR = /^[A-Z0-9]{6}$/;
const PCC = /^[A-Z0-9]{3,4}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const NAMESPACE = 'http://webservices.sabre.com/triprecord';

/** El error que manda el fake por cada `reason`: código, severidad y texto de la guía. */
const FORCED: Readonly<Record<TripSearchErrorReason, [string, string, string]>> = {
  NO_PRIMARY_CRITERIA: ['200204', 'MINOR', 'There is no primary criteria specified'],
  CRITERIA_TOO_WEAK: ['200207', 'MODERATE', 'Primary criteria too weak – add more specific primary criterion'],
  TOO_MANY_RESULTS: ['200206', 'MODERATE', 'Too many results – specify more data'],
  SEARCH_TIMEOUT: ['200203', 'MODERATE', 'DB search timeout'],
  PCC_NOT_ACCESSIBLE: ['200208', 'MODERATE', 'Empty PCC list after Branch access check'],
  UNKNOWN: ['200202', 'MODERATE', 'Unable to process DB search'],
};

function fail(message: string): never {
  throw new TypeError(`sabre-client/testing: ${message}`);
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function localFormatter(timeZone: string, label: string): Intl.DateTimeFormat {
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
    fail(`${label}: '${timeZone}' no es una zona IANA válida`);
  }
}

function localOf(formatter: Intl.DateTimeFormat, instant: Date): string {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Una hora local sin zona como instante en la zona del formateador (dos pasadas por el offset). */
function instantOf(formatter: Intl.DateTimeFormat, local: string): number {
  const wall = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  let instant = wall;
  for (let pass = 0; pass < 2; pass += 1) instant = wall - (Date.parse(`${localOf(formatter, new Date(instant))}Z`) - Math.floor(instant / 1000) * 1000);
  return instant;
}

interface Seeded {
  locator: string;
  createdBy: string;
  visibleTo: Set<string>;
  updates: number[];
  pastDate: boolean;
}

function toInstant(value: unknown, label: string): number {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (typeof value === 'string' && INSTANT.test(value) && !Number.isNaN(Date.parse(value))) return Date.parse(value);
  fail(`${label} debe ser un Date o un ISO 8601 con zona`);
}

/** Lo que el fake necesita de un `Trip_SearchRQ` ya parseado, y lo que devuelve. */
export interface TripSearchFakeRequest {
  after?: string;
  before?: string;
  pcc?: string;
  anyBranch?: string;
  searchType?: string;
  maxItems?: string;
}

/**
 * El manejador de `Trip_SearchRQ`: valida la siembra al crearse y devuelve el cuerpo de
 * `Trip_SearchRS`. `timeZone` es la de `tripSearchTimeZone`; sin ella, el fake no simula la
 * búsqueda.
 */
export function createTripSearchHandler(options: QueueFakeTripSearch | undefined, timeZone: string | undefined, now: () => Date) {
  const formatter = timeZone === undefined ? undefined : localFormatter(timeZone, 'tripSearchTimeZone');
  if (options !== undefined && formatter === undefined) {
    fail('tripSearch necesita tripSearchTimeZone: la zona IANA en que Sabre lee la ventana, p. ej. America/Mexico_City (no tiene default)');
  }
  const limit = options?.limit ?? 800;
  if (!Number.isInteger(limit) || limit < 1) fail('tripSearch.limit debe ser un entero ≥ 1');
  const errors = [...(options?.errors ?? [])];
  for (const [index, reason] of errors.entries()) if (!(reason in FORCED)) fail(`tripSearch.errors[${index}]: '${String(reason)}' no es un reason de Trip Search`);
  const seeded: Seeded[] = (options?.reservations ?? []).map((reservation, index) => {
    const label = `tripSearch.reservations[${index}]`;
    if (typeof reservation !== 'object' || reservation === null) fail(`${label} debe ser un objeto`);
    if (!LOCATOR.test(reservation.locator)) fail(`${label}.locator debe tener 6 caracteres alfanuméricos en mayúscula`);
    if (!PCC.test(reservation.createdBy)) fail(`${label}.createdBy debe ser un PCC de 3 o 4 letras mayúsculas o dígitos`);
    const visibleTo = reservation.visibleTo ?? [];
    for (const pcc of visibleTo) if (!PCC.test(pcc)) fail(`${label}.visibleTo: '${pcc}' no es un PCC`);
    const updatedAt = Array.isArray(reservation.updatedAt) ? reservation.updatedAt : [reservation.updatedAt];
    if (updatedAt.length === 0) fail(`${label}.updatedAt necesita al menos un instante`);
    return {
      locator: reservation.locator,
      createdBy: reservation.createdBy,
      visibleTo: new Set(visibleTo),
      updates: updatedAt.map((value, at) => toInstant(value, `${label}.updatedAt${Array.isArray(reservation.updatedAt) ? `[${at}]` : ''}`)),
      pastDate: reservation.pastDate === true,
    };
  });

  const errorBody = (code: string, severity: string, message: string) =>
    `<Trip_SearchRS xmlns="${NAMESPACE}"${formatter === undefined ? '' : ` TimeStamp="${localOf(formatter, now())}"`} Version="4.5.0"><Errors><Error ErrorCode="${code}" Severity="${severity}" ErrorMessage="${escape(message)}"/></Errors></Trip_SearchRS>`;

  /** El cuerpo de `Trip_SearchRS`, o `undefined` si el fake no simula la búsqueda (sin zona). */
  return (rq: TripSearchFakeRequest): string | undefined => {
    if (formatter === undefined) return undefined;
    const forced = errors.shift();
    if (forced !== undefined) return errorBody(...FORCED[forced]);
    if (rq.pcc === undefined || rq.pcc === '') return errorBody('200205', 'MINOR', 'There is no POS criteria specified');
    if (rq.after === undefined || rq.before === undefined || !LOCAL.test(rq.after) || !LOCAL.test(rq.before)) {
      return errorBody('200204', 'MINOR', 'There is no primary criteria specified');
    }
    const from = instantOf(formatter, rq.after);
    const to = instantOf(formatter, rq.before);
    const anyBranch = rq.anyBranch === 'true';
    const searchType = rq.searchType ?? 'ACTIVE';
    const asked = Number(rq.maxItems ?? limit);
    const requested = Number.isInteger(asked) && asked > 0 ? asked : limit;
    const cap = Math.min(requested, limit);

    const visible = (pnr: Seeded) => pnr.createdBy === rq.pcc || (anyBranch && pnr.visibleTo.has(rq.pcc ?? ''));
    const ofType = (pnr: Seeded) => (searchType === 'BOTH' ? true : searchType === 'INACTIVE' ? pnr.pastDate : !pnr.pastDate);
    // Supuesto del fake: los dos bordes entran (la guía no lo dice).
    const matches = seeded.filter((pnr) => visible(pnr) && ofType(pnr) && pnr.updates.some((at) => at >= from && at <= to));
    // Como Sabre en CERT (2026-11-16): con más resultados que `MaxItemsReturned`, error sin lista.
    if (requested <= limit && matches.length > requested) {
      return errorBody('200206', 'WARNING', `Too many results - specify more data; wanted: ${requested} , found: ${matches.length}`);
    }
    const shown = matches.slice(0, cap);
    const notices = [
      ...(matches.length > cap ? ['<Error ErrorCode="200006" Severity="MINOR" ErrorMessage="Number of results exceeded view limit or requested PNRs limit"/>'] : []),
      ...(requested > limit && matches.length <= cap ? [`<Error ErrorCode="200005" Severity="MINOR" ErrorMessage="Max number of requested PNRs exceeded view limit [${limit}]"/>`] : []),
    ];
    const reservations = shown
      .map((pnr) => `<Reservation Locator="${pnr.locator}"${pnr.pastDate ? ' PastDate="true"' : ''}><stl19:GetReservationRS xmlns:stl19="http://webservices.sabre.com/pnrbuilder/v1_19" Version="1.19.0"/></Reservation>`)
      .join('');
    return [
      `<Trip_SearchRS xmlns="${NAMESPACE}" TimeStamp="${localOf(formatter, now())}" Target="Production" Version="4.5.0">`,
      '<Success>Success</Success>',
      notices.length === 0 ? '' : `<Errors>${notices.join('')}</Errors>`,
      `<ReservationsList NumberResults="${shown.length}" NumberPages="1" TotalResults="${matches.length}">`,
      shown.length === 0 ? '<Reservations/>' : `<Reservations>${reservations}</Reservations>`,
      '</ReservationsList></Trip_SearchRS>',
    ].join('');
  };
}
