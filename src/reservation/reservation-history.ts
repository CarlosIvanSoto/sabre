// Get Itinerary History (`TravelItineraryHistoryLLSRQ` 2.4.0): el historial de un PNR, el `*H` del
// host. Ver sabre-wiki/wiki/proyectos/sabre-client/decisiones/tier-4-colas-avanzadas.md (B1),
// wiki/sources/get-itinerary-history-v2-4-0-design.md y wiki/entities/get-itinerary-history.md.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreGatewayError, type SabreWarning } from '../errors/index.js';
import { asArray, respondedAtField, type SoapResponse, textOf, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';

export const RESERVATION_HISTORY_SERVICE = 'itineraryHistory';
const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';

export type ReservationHistoryOptions = RequestOptions;

/**
 * Un elemento con su acción y su texto: `GeneralInfo` o `RemarkInfo/Remark`. Sabre no publica el
 * catálogo de `action`. En CERT llegaron `A4S` (SSR), `A7` (ticketing), `A9` (teléfono), `AN`
 * (nombre), `APE` (email) y `ADT`. La `A` inicial es un alta y la `X`, una baja.
 */
export interface ReservationHistoryText {
  action: string;
  /** `Text`, tal cual. Puede traer datos del pasajero. */
  text: string;
}

/** Un `FlightSegment` del historial, tal como estaba en esa transacción. */
export interface ReservationHistoryFlightSegment {
  /** `@Action`: `AS` (alta) o `XS` (baja), según las respuestas y el design. */
  action: string;
  /** `@Status` en ese momento (`HK`, `HKNN`, `UN`…). */
  status?: string;
  /** `MarketingAirline@Code`. */
  marketingAirline?: string;
  /** `@FlightNumber`. */
  flightNumber?: string;
  /** `@ResBookDesigCode`: la clase. */
  bookingClass?: string;
  /** `OriginLocation@LocationCode`. */
  origin?: string;
  /** `DestinationLocation@LocationCode`. */
  destination?: string;
  /** `@DepartureDateTime` tal cual, sin año (`"12-19T13:10"`). Se resuelve con `resolveHostDate`. */
  departureDateTime?: string;
  /** `@ArrivalDateTime` tal cual, sin año. */
  arrivalDateTime?: string;
  /** `@NumberInParty`. */
  numberInParty?: number;
  /** `SupplierRef@ID`: el localizador de la aerolínea (`DCAA*DVDMYA`). */
  supplierRef?: string;
}

/** Una `AccountingInfo` del historial: la línea de contabilidad, sin sus importes. */
export interface ReservationHistoryAccounting {
  /** `@Action` (`HK` en el design). */
  action?: string;
  /** `@Type`: `R` reembolso, `G` cambio con reembolso, `E` cambio par, `A` cobro adicional, `L` descuento, `B` bulk. */
  type?: string;
  /** `@LinkCode`. */
  linkCode?: string;
}

/**
 * Una transacción del historial (`HistoricalInfo`): quién la firmó, cuándo y desde qué PCC
 * (`ItineraryRef/Source`), y los elementos que cambió. Lo que el SDK no tipa (asientos, autos,
 * hoteles, tren, seguros, facturas, importes) queda en la respuesta cruda (`onRawResponse`).
 */
export interface ReservationHistoryTransaction {
  /** `@RPH`: el número de la firma de la transacción (`HSTSIG`). */
  rph?: number;
  /** `Source@CreateDateTime`, tal cual: con año y sin zona (`"2026-11-04T17:15"`). */
  createdAt?: string;
  /** `Source@CreationAgent`: el sine del agente que firmó. */
  agent?: string;
  /** `Source@CreationAgentDutyCode`. */
  agentDutyCode?: string;
  /** `Source@CreationAgentFunctionCode`. */
  agentFunctionCode?: string;
  /** `Source@PseudoCityCode`: el PCC de la firma del agente. */
  pcc?: string;
  /**
   * `Source@AAA_PseudoCityCode`: el PCC del AAA del agente. El sample lo escribe
   * `AAAPseudoCityCode`, sin guion bajo; el SDK lee los dos.
   */
  aaaPcc?: string;
  /** `Source@ReceivedFrom`: el campo de recibido de la transacción. */
  receivedFrom?: string;
  /** `ItineraryInfo/ReservationItems/Item/FlightSegment`, en orden. */
  flightSegments: ReservationHistoryFlightSegment[];
  /** `GeneralInfo`, en orden: SSR, ticketing, teléfonos, nombres, emails… como texto. */
  generalInfo: ReservationHistoryText[];
  /** `RemarkInfo/Remark`, en orden. */
  remarks: ReservationHistoryText[];
  /** `AccountingInfo`, en orden. */
  accounting: ReservationHistoryAccounting[];
}

export interface ReservationHistoryResponse {
  /** Las transacciones (`HistoricalInfo`), en el orden de Sabre. */
  transactions: ReservationHistoryTransaction[];
  /** Los `stl:Warning` de la respuesta. No lanzan. */
  warnings: SabreWarning[];
  /** `eb:Timestamp` de la respuesta de Sabre, en ISO 8601 UTC. Falta si Sabre no lo manda. */
  respondedAt?: string;
}

const LOCATOR = /^[A-Z0-9]{6}$/;

/** Si un texto es un localizador de Sabre: 6 caracteres alfanuméricos en mayúscula. */
export function isRecordLocator(value: unknown): value is string {
  return typeof value === 'string' && LOCATOR.test(value);
}

/** Cuerpo de `TravelItineraryHistoryRQ` con el localizador (`JX HST*<localizador>`). */
export function reservationHistoryPayload(locator: string): string {
  return `<TravelItineraryHistoryRQ Version="2.4.0" xmlns="${NAMESPACE}"><UniqueID ID="${xmlEscape(locator)}"/></TravelItineraryHistoryRQ>`;
}

/** Es una lectura: se reintenta ante `USG_*_BUSY`, transitorios y red. */
export function reservationHistoryRequest(locator: string, options: ReservationHistoryOptions): SessionRequest {
  return {
    service: RESERVATION_HISTORY_SERVICE,
    action: 'TravelItineraryHistoryLLSRQ',
    payload: reservationHistoryPayload(locator),
    idempotent: true,
    operation: 'reservation.history',
    ...options,
  };
}

type XmlNode = Record<string, unknown>;

function node(value: unknown): XmlNode | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'object' && first !== null ? (first as XmlNode) : undefined;
}

function attribute(value: unknown, name: string): string | undefined {
  const text = node(value)?.[`@${name}`];
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Los campos opcionales que llegaron, sin claves en `undefined`. */
function defined<T extends Record<string, unknown>>(fields: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

function integer(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

/**
 * Lee `TravelItineraryHistoryRS`. Un `GeneralInfo`, `Remark` o `FlightSegment` sin `@Action` es una
 * respuesta que el SDK no entiende: lanza `SabreGatewayError`.
 */
export function parseReservationHistoryResponse(response: SoapResponse): ReservationHistoryResponse {
  const transactions = asArray(response.payload.HistoricalInfo).map((info) => transaction(node(info) ?? {}, response));
  return { transactions, warnings: response.warnings, ...respondedAtField(response.raw) };
}

function transaction(info: XmlNode, response: SoapResponse): ReservationHistoryTransaction {
  const source = node(node(info.ItineraryRef)?.Source);
  const flightSegments = asArray(node(node(info.ItineraryInfo)?.ReservationItems)?.Item).flatMap((item) =>
    asArray(node(item)?.FlightSegment).map((segment) => flightSegment(node(segment) ?? {}, response)),
  );
  return {
    ...defined({
      rph: integer(attribute(info, 'RPH')),
      createdAt: attribute(source, 'CreateDateTime'),
      agent: attribute(source, 'CreationAgent'),
      agentDutyCode: attribute(source, 'CreationAgentDutyCode'),
      agentFunctionCode: attribute(source, 'CreationAgentFunctionCode'),
      pcc: attribute(source, 'PseudoCityCode'),
      aaaPcc: attribute(source, 'AAA_PseudoCityCode') ?? attribute(source, 'AAAPseudoCityCode'),
      receivedFrom: attribute(source, 'ReceivedFrom'),
    }),
    flightSegments,
    generalInfo: asArray(info.GeneralInfo).map((entry) => textEntry(entry, 'GeneralInfo', response)),
    remarks: asArray(node(info.RemarkInfo)?.Remark).map((entry) => textEntry(entry, 'Remark', response)),
    accounting: asArray(info.AccountingInfo).map((entry) =>
      defined({ action: attribute(entry, 'Action'), type: attribute(entry, 'Type'), linkCode: attribute(entry, 'LinkCode') }),
    ),
  };
}

function textEntry(entry: unknown, label: string, response: SoapResponse): ReservationHistoryText {
  const action = attribute(entry, 'Action');
  if (action === undefined) throw malformed(`${label} sin Action`, response);
  const texts = asArray(node(entry)?.Text).map((text) => textOf(text) ?? '');
  return { action, text: texts.join('\n') };
}

function flightSegment(segment: XmlNode, response: SoapResponse): ReservationHistoryFlightSegment {
  const action = attribute(segment, 'Action');
  if (action === undefined) throw malformed('FlightSegment sin Action', response);
  return {
    action,
    ...defined({
      status: attribute(segment, 'Status'),
      marketingAirline: attribute(segment.MarketingAirline, 'Code'),
      flightNumber: attribute(segment, 'FlightNumber') ?? attribute(segment.MarketingAirline, 'FlightNumber'),
      bookingClass: attribute(segment, 'ResBookDesigCode'),
      origin: attribute(segment.OriginLocation, 'LocationCode'),
      destination: attribute(segment.DestinationLocation, 'LocationCode'),
      departureDateTime: attribute(segment, 'DepartureDateTime'),
      arrivalDateTime: attribute(segment, 'ArrivalDateTime'),
      numberInParty: integer(attribute(segment, 'NumberInParty')),
      supplierRef: attribute(segment.SupplierRef, 'ID'),
    }),
  };
}

function malformed(detail: string, response: SoapResponse): SabreGatewayError {
  return new SabreGatewayError(`${RESERVATION_HISTORY_SERVICE}: respuesta no reconocida (${detail})`, {
    protocol: 'soap',
    status: response.status,
    retryable: false,
    raw: response.raw,
  });
}
