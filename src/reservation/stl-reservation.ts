// Retrieve Itinerary y Update Itinerary en STL 1.19 (`GetReservationRQ` y `UpdateReservationRQ`,
// `pnrbuilder/v1_19`): los requests `Stateful`, el parser de las dos respuestas, `IgnoreTransactionRQ`
// y el error de negocio de las escrituras de ADR-034. Lo comparten `confirmAirSegments` (#268) y
// `removeAirSegments` (#269). Ver sabre-wiki/wiki/proyectos/sabre-client/decisiones/
// confirmar-cambio-de-horario.md, wiki/entities/update-itinerary.md y wiki/sources/update-itinerary-*.md.
import { SabreBusinessError, type SabreBusinessErrorOptions, SabreGatewayError } from '../errors/index.js';
import { asArray, type SoapResponse, textOf, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';

/** El servicio de los errores de las escrituras de ADR-034, también cuando falla la lectura previa. */
export const UPDATE_RESERVATION_SERVICE = 'updateReservation';
const PNRBUILDER_NAMESPACE = 'http://webservices.sabre.com/pnrbuilder/v1_19';
const SABRE_XML_NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';

// ---------- Tipos públicos ----------

/**
 * Un segmento aéreo del PNR (`Segment/Air` de STL 1.19), después del cambio. Las fechas van tal
 * cual las manda Sabre: hora local del aeropuerto, sin zona (`"2021-03-30T11:45:00"`).
 */
export interface ReservationAirSegment {
  /**
   * `Air@id`: el id del segmento en el PNR, el que se pasa en `expectedSegmentIds` o `segmentIds`.
   * En los ejemplos oficiales coincide con `Segment@id` y `Product@id`. **No es el `itemId` de
   * `booking.get`**: la relación entre los dos está sin confirmar (Q-140).
   */
  id: string;
  /** `Air@sequence`: el orden del segmento en el itinerario (1, 2…). */
  sequence: number;
  /** `MarketingAirlineCode`. */
  marketingCarrier?: string;
  /** `MarketingFlightNumber` (o `FlightNumber` si no viene). */
  flightNumber?: string;
  /** `DepartureAirport`. */
  from?: string;
  /** `ArrivalAirport`. */
  to?: string;
  /** `DepartureDateTime`, hora local sin zona. */
  departure?: string;
  /** `ArrivalDateTime`, hora local sin zona. */
  arrival?: string;
  /**
   * `ActionCode` en la lectura previa (`GetReservationRS`). Falta si el segmento no estaba en
   * esa lectura.
   */
  previousStatus?: string;
  /** `ActionCode` actual: `HK`, `TK`, `UN`, `HX`, `KK`… */
  status: string;
}

/** Un aviso de una escritura de ADR-034: de Sabre (`Warnings/Warning`) o del SDK (`NOT_APPLIED`). */
export interface ReservationUpdateWarning {
  /**
   * `NOT_APPLIED`: Sabre respondió `Success`, pero un segmento no quedó como se pidió (un
   * confirmado que no está en `HK`, o un borrado que sigue en el PNR). `SABRE_WARNING`: un
   * `Warnings/Warning` de Sabre sin código; si trae `Code`, va ese.
   */
  code: string;
  message: string;
  /** Los segmentos a los que se refiere, si se refiere a alguno. */
  segmentIds?: string[];
}

/**
 * Por qué una escritura de ADR-034 no se hizo:
 * - `SEGMENTS_CHANGED`: los `TK` del PNR no son exactamente `expectedSegmentIds`
 *   (`confirmAirSegments`). No se escribió nada.
 * - `SEGMENT_NOT_FOUND` / `SEGMENT_STATUS_NOT_ALLOWED`: un segmento a borrar no existe o no está
 *   en `allowedStatuses` (`removeAirSegments`). No se escribió nada.
 * - `SABRE_ERROR`: un `Errors/Error` de Sabre en la lectura (`GetReservationRS`) o en la escritura
 *   (`UpdateReservationRS` sin `Success`), con su `code` y su texto tal cual.
 */
export type ReservationUpdateErrorReason = 'SEGMENTS_CHANGED' | 'SEGMENT_NOT_FOUND' | 'SEGMENT_STATUS_NOT_ALLOWED' | 'SABRE_ERROR';

export interface SabreReservationUpdateErrorOptions extends Omit<SabreBusinessErrorOptions, 'service'> {
  reason: ReservationUpdateErrorReason;
  /** `Error/Severity` de Sabre, tal cual (`MODERATE`…). Solo con `SABRE_ERROR`. */
  severity?: string;
  /** Los ids que mandó el consumidor (`expectedSegmentIds` o `segmentIds`). */
  expectedSegmentIds?: readonly string[];
  /** Con `SEGMENTS_CHANGED`: los ids que están en `TK` en el PNR. */
  actualSegmentIds?: readonly string[];
}

/**
 * Una escritura de ADR-034 que **no se hizo**: lo dice Sabre (`SABRE_ERROR`) o el chequeo local
 * previo (`SEGMENTS_CHANGED`…). Es un `SabreBusinessError` con `service: 'updateReservation'` y
 * `retryable: false`; `code` es el de Sabre, o el mismo `reason` en los chequeos locales.
 */
export class SabreReservationUpdateError extends SabreBusinessError {
  override name = 'SabreReservationUpdateError';
  readonly reason: ReservationUpdateErrorReason;
  readonly severity: string | undefined;
  readonly expectedSegmentIds: readonly string[];
  readonly actualSegmentIds: readonly string[];

  constructor(message: string, options: SabreReservationUpdateErrorOptions) {
    super(message, { ...options, service: UPDATE_RESERVATION_SERVICE });
    this.reason = options.reason;
    this.severity = options.severity;
    this.expectedSegmentIds = options.expectedSegmentIds ?? [];
    this.actualSegmentIds = options.actualSegmentIds ?? [];
  }
}

// ---------- Requests ----------

/** `GetReservationRQ` `Stateful`, `FULL`, como los ejemplos oficiales: deja el PNR en el AAA. */
export function getReservationPayload(locator: string): string {
  return [
    `<GetReservationRQ Version="1.19.0" xmlns="${PNRBUILDER_NAMESPACE}">`,
    `<Locator>${xmlEscape(locator)}</Locator>`,
    '<RequestType>Stateful</RequestType>',
    '<ReturnOptions><SubjectAreas><SubjectArea>FULL</SubjectArea></SubjectAreas></ReturnOptions>',
    '</GetReservationRQ>',
  ].join('');
}

/**
 * `UpdateReservationRQ` `Stateful` con `commitTransaction="true"` (el ET va en la misma llamada) y
 * `RetrievePNR="true"`, como el ejemplo «Change Status». `items` son los `ReservationUpdateItem`
 * sin el `UpdateId`, que va de 1 en adelante. `ReceivedFrom` va como `<Name>`, como en el ejemplo
 * de `CONFIRM-ALL` y en la respuesta (el de Cancel usa `<AgentName>`: Q-141).
 */
export function updateReservationPayload(items: readonly string[], receivedFrom: string): string {
  return [
    `<UpdateReservationRQ Version="1.19.0" xmlns="${PNRBUILDER_NAMESPACE}">`,
    '<RequestType commitTransaction="true">Stateful</RequestType>',
    '<ReturnOptions RetrievePNR="true" IncludeUpdateDetails="true"><ViewName>Full</ViewName></ReturnOptions>',
    '<ReservationUpdateList>',
    ...items.map((item, index) => `<ReservationUpdateItem UpdateId="${index + 1}">${item}</ReservationUpdateItem>`),
    `<ReceivedFrom><Name>${xmlEscape(receivedFrom)}</Name></ReceivedFrom>`,
    '</ReservationUpdateList>',
    '</UpdateReservationRQ>',
  ].join('');
}

/** `AirItineraryUpdate/Action = CONFIRM-ALL`: pasa todos los `TK` a `HK`. */
export const CONFIRM_ALL_ITEM = '<AirItineraryUpdate><Action>CONFIRM-ALL</Action></AirItineraryUpdate>';

/** `IgnoreTransactionLLSRQ` 2.0.0 (el `I` del host): descarta lo que no se commiteó en el AAA. */
export function ignoreTransactionRequest(operation: string): SessionRequest {
  return {
    service: 'ignoreTransaction',
    action: 'IgnoreTransactionLLSRQ',
    payload: `<IgnoreTransactionRQ Version="2.0.0" xmlns="${SABRE_XML_NAMESPACE}"/>`,
    // Repetir un IG no cambia nada: no hay nada que commitear.
    idempotent: true,
    operation,
  };
}

// ---------- Respuestas ----------

type XmlNode = Record<string, unknown>;

const node = (value: unknown): XmlNode | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'object' && first !== null ? (first as XmlNode) : undefined;
};
const attribute = (value: unknown, name: string): string | undefined => {
  const found = node(value)?.[`@${name}`];
  if (typeof found !== 'string') return undefined;
  const trimmed = found.trim();
  return trimmed === '' ? undefined : trimmed;
};
const text = (value: unknown): string | undefined => {
  const found = textOf(Array.isArray(value) ? value[0] : value)?.trim();
  return found === undefined || found === '' ? undefined : found;
};

/** Un `Errors/Error` de STL 1.19: `Code`, `Message` y `Severity` como elementos (o atributos). */
export interface StlError {
  code: string;
  message: string;
  severity?: string;
}

/** Lo que el SDK lee de `GetReservationRS` o `UpdateReservationRS`. */
export interface StlReservationResponse {
  /** `Success` presente (solo en `UpdateReservationRS`). */
  success: boolean;
  errors: StlError[];
  warnings: ReservationUpdateWarning[];
  /** `BookingDetails/RecordLocator`, si viene `Reservation`. */
  locator: string | undefined;
  /** Los segmentos aéreos, en el orden del PNR; `undefined` si no viene `Reservation`. */
  segments: ReservationAirSegment[] | undefined;
  /** `Results/UpdateResult`: uno por `UpdateId` (no llega con `CONFIRM-ALL`). */
  updateResults: { updateId: string; status: string | undefined }[];
}

/**
 * Lee `GetReservationRS` o `UpdateReservationRS` (STL 1.19). Un payload con otro nombre, o un
 * segmento aéreo sin `id`, `sequence` o `ActionCode`, lanza `SabreGatewayError` (respuesta no
 * reconocida): quien llama decide si eso es un fallo seguro o un incierto.
 */
export function parseStlReservation(response: SoapResponse, expected: 'GetReservationRS' | 'UpdateReservationRS'): StlReservationResponse {
  const { payload } = response;
  if (response.payloadName !== expected) throw unrecognized(`se esperaba ${expected} y llegó ${response.payloadName}`, response);
  const reservation = node(payload.Reservation);
  return {
    success: 'Success' in payload,
    errors: asArray(node(payload.Errors)?.Error).map(stlError),
    warnings: [...response.warnings.map((warning) => ({ code: warning.code, message: warning.message })), ...asArray(node(payload.Warnings)?.Warning).map(stlWarning)],
    locator: reservation === undefined ? undefined : text(node(reservation.BookingDetails)?.RecordLocator),
    segments: reservation === undefined ? undefined : airSegments(reservation, response),
    updateResults: asArray(node(payload.Results)?.UpdateResult).map((result) => ({
      updateId: attribute(result, 'UpdateId') ?? '',
      status: attribute(result, 'Status'),
    })),
  };
}

function stlError(entry: unknown): StlError {
  const element = node(entry) ?? {};
  const code = text(element.Code) ?? attribute(entry, 'Code') ?? 'UNKNOWN';
  const message = text(element.Message) ?? attribute(entry, 'Message') ?? text(entry) ?? 'sin detalle';
  const severity = text(element.Severity) ?? attribute(entry, 'Severity');
  return severity === undefined ? { code, message } : { code, message, severity };
}

function stlWarning(entry: unknown): ReservationUpdateWarning {
  const element = node(entry) ?? {};
  const code = text(element.Code) ?? attribute(entry, 'Code') ?? 'SABRE_WARNING';
  const message = text(element.Message) ?? text(entry) ?? 'sin detalle';
  return { code, message };
}

function airSegments(reservation: XmlNode, response: SoapResponse): ReservationAirSegment[] {
  const segments = asArray(node(node(reservation.PassengerReservation)?.Segments)?.Segment);
  const result: ReservationAirSegment[] = [];
  for (const segment of segments) {
    // Un `Segment` puede ser de hotel, auto, ARNK…: solo cuentan los que traen `Air`.
    const air = node(node(segment)?.Air);
    if (air === undefined) continue;
    const id = attribute(air, 'id') ?? attribute(segment, 'id');
    const sequenceText = attribute(air, 'sequence') ?? attribute(segment, 'sequence');
    const status = text(air.ActionCode);
    if (id === undefined || sequenceText === undefined || !/^\d+$/.test(sequenceText) || status === undefined) {
      throw unrecognized('un segmento aéreo sin id, sequence o ActionCode', response);
    }
    const fields = {
      marketingCarrier: text(air.MarketingAirlineCode),
      flightNumber: text(air.MarketingFlightNumber) ?? text(air.FlightNumber),
      from: text(air.DepartureAirport),
      to: text(air.ArrivalAirport),
      departure: text(air.DepartureDateTime),
      arrival: text(air.ArrivalDateTime),
    };
    const found: ReservationAirSegment = { id, sequence: Number(sequenceText), status };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) (found as unknown as Record<string, string>)[key] = value;
    result.push(found);
  }
  return result;
}

/** `SabreGatewayError` de una respuesta que el SDK no entiende. */
export function unrecognized(detail: string, response: Pick<SoapResponse, 'status' | 'raw'>): SabreGatewayError {
  return new SabreGatewayError(`${UPDATE_RESERVATION_SERVICE}: respuesta no reconocida (${detail})`, {
    protocol: 'soap',
    status: response.status,
    retryable: false,
    raw: response.raw,
  });
}

/** El `SabreReservationUpdateError` de un `Errors/Error` de Sabre; los demás van en `errors`. */
export function sabreErrorOf(errors: readonly StlError[], response: Pick<SoapResponse, 'raw'>, warnings?: SabreBusinessErrorOptions['warnings']): SabreReservationUpdateError {
  const make = (error: StlError, rest: SabreReservationUpdateError[] = []) =>
    new SabreReservationUpdateError(`${UPDATE_RESERVATION_SERVICE}: ${error.code} ${error.message}`, {
      reason: 'SABRE_ERROR',
      code: error.code,
      raw: response.raw,
      errors: rest,
      ...(error.severity === undefined ? {} : { severity: error.severity }),
      ...(warnings === undefined ? {} : { warnings }),
    });
  const [first, ...rest] = errors;
  if (first === undefined) throw new Error('sabre-client: sabreErrorOf sin errores');
  return make(first, rest.map((error) => make(error)));
}
