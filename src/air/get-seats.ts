// Get Seats v3 (`POST /v3/offers/getseats/...`).
// Ver sabre-wiki/wiki/entities/get-seats.md y sabre-wiki/wiki/sdk/get-seats-en-el-sdk.md.
import { isObject, nonEmpty, toBusinessError, toWarning } from '../booking/booking-errors.js';
import { type SabreBusinessError, SabreError, type SabreWarning } from '../errors/index.js';
import type { RestTransport } from '../http/rest-transport.js';
import type { RequestOptions } from './bargain-finder-max.js';

/** `service` de errores y logs; distinto por endpoint para que no quede oculto (ADR, opción C). */
export const GET_SEATS_BY_PAYLOAD_SERVICE = 'getSeatsByPayload';
const BY_PAYLOAD_PATH = '/v3/offers/getseats/byReservationPayload';
export const GET_SEATS_BY_PNR_LOCATOR_SERVICE = 'getSeatsByPnrLocator';
const BY_PNR_LOCATOR_PATH = '/v3/offers/getseats/byPnrLocator';
/** Campos del payload que no pueden ir junto con `pnrLocator`. */
const PAYLOAD_FIELDS = ['segments', 'passengers', 'returnSeatMapsOnlyForSegmentRefs'] as const;

// ─── Request ────────────────────────────────────────────────────────────────

/** `KeyValuePair` del spec. */
export interface SeatKeyValuePair {
  key: string;
  value: string;
}

/** `LoyaltyProgramAccount` del spec. */
export interface SeatLoyaltyProgramAccount {
  airlineCode?: string;
  accountNumber?: string;
  programName?: string;
}

/** `SegmentBase` del spec. Fechas `YYYY-MM-DD` y horas `HH:MM`, locales del aeropuerto. */
export interface SeatSegment {
  /** Identifica el segmento dentro del mensaje (`IdType`: `^[a-zA-Z_][a-zA-Z0-9_\-.]*$`). */
  id: string;
  bookingAirlineCode: string;
  bookingFlightNumber: number;
  departureAirportCode: string;
  arrivalAirportCode: string;
  departureDate: string;
  bookingClassCode: string;
  departureTime?: string;
  arrivalDate?: string;
  arrivalTime?: string;
  operatingAirlineCode?: string;
  operatingFlightNumber?: number;
  operatingBookingClassCode?: string;
  cabinCode?: string;
}

/** `SegmentPayloadRq` del spec. */
export interface SeatSegmentPayloadRq extends SeatSegment {
  /** Si el segmento tiene el tag `/RCRQ`. */
  hasRecordCreateTag?: boolean;
}

/** `FareSegmentAssociation` del spec. */
export interface SeatFareSegmentAssociation {
  segmentRef: string;
  fareComponentRef: string;
}

/** `SpecialServiceRequest` del spec. */
export interface SeatSpecialServiceRequest {
  codes: string[];
  segmentRef?: string;
}

/** `PassengerBase` del spec. */
export interface SeatPassenger {
  id: string;
  passengerType?: string;
  givenName?: string;
  surname?: string;
  loyaltyProgramAccounts?: SeatLoyaltyProgramAccount[];
}

/** `PassengerPayloadRq` del spec. */
export interface SeatPassengerPayloadRq extends SeatPassenger {
  fareSegmentAssociation?: SeatFareSegmentAssociation[];
  specialServiceRequests?: SeatSpecialServiceRequest[];
  /** Pasajero con un infante sin asiento. Por defecto `false`. */
  isAccompaniedByInfant?: boolean;
  customAttributes?: SeatKeyValuePair[];
}

/** `FareDetail` del spec. */
export interface SeatFareDetail {
  fareType?: string;
  fareTariff?: string;
  fareRule?: string;
  fareIndicator?: number;
  fareTypeBitmap?: string;
  hasPrivateTariff?: boolean;
}

/** `FareComponent` del spec. */
export interface SeatFareComponent {
  fareComponentId: string;
  fareBasis: string;
  governingCarrier?: string;
  /** Número como string, p. ej. `'500.00'`. Exige `totalPriceCurrencyCode`. */
  totalPrice?: string;
  totalPriceCurrencyCode?: string;
  brandCode?: string;
  fareDetail?: SeatFareDetail;
}

/** `SeatAvailabilityByPayloadRq` del spec 3.0: la reserva armada a mano. */
export interface SeatAvailabilityByPayloadRq {
  /** `id` de los segmentos para los que se piden mapas. */
  returnSeatMapsOnlyForSegmentRefs: string[];
  segments: SeatSegmentPayloadRq[];
  passengers: SeatPassengerPayloadRq[];
  returnSeatOffersOnlyForPassengerRefs?: string[];
  fareComponents?: SeatFareComponent[];
  /** ISO 4217. Si falta, Sabre la elige según otros factores. */
  currencyCode?: string;
  /** `true`: mapa de check-in; `false`: mapa de reserva. */
  isCheckinMode?: boolean;
  customAttributes?: SeatKeyValuePair[];
}

/**
 * `SeatAvailabilityByPnrLocatorRq` del spec 3.0: un PNR ya creado. Sabre lo lee sin estado,
 * así que no ve los cambios sin confirmar.
 */
export interface SeatAvailabilityByPnrLocatorRq {
  /** Localizador del PNR (`^[A-Z]{6}$`). */
  pnrLocator: string;
  /** IDs de segmento del PNR para los que se piden mapas. */
  returnSeatMapsOnlyForSegmentIds?: string[];
  /** Name reference numbers del PNR, p. ej. `'01.01'`. */
  returnSeatOffersOnlyForPassengerNameReferenceNumbers?: string[];
  currencyCode?: string;
  isCheckinMode?: boolean;
  customAttributes?: SeatKeyValuePair[];
}

/** Entrada de `sabre.air.getSeats`: con `pnrLocator` va a `byPnrLocator`; sin él, a `byReservationPayload`. */
export type GetSeatsRequest = SeatAvailabilityByPayloadRq | SeatAvailabilityByPnrLocatorRq;

// ─── Response ───────────────────────────────────────────────────────────────

/** `FlightLeg` del spec. */
export interface SeatFlightLeg {
  id: string;
  departureAirportCode: string;
  arrivalAirportCode: string;
  departureScheduledDateTime?: string;
  aircraftCode?: string;
}

/** `SegmentRs` del spec. */
export interface SeatSegmentRs extends SeatSegment {
  isChangeOfGauge?: boolean;
  flightLegs?: SeatFlightLeg[];
  /**
   * El segmento en la reserva (p. ej. `"10"`). Coincide con `flights[].itemId` y
   * `allSegments[].id` de Get Booking, así que sirve para cruzar el mapa con la reserva. No está en
   * el spec 3.0: llega en `byPnrLocator` (CERT, 2026-11-04, sabre-playground #11).
   */
  reservationSegmentId?: string;
}

/** `PassengerRs` del spec. */
export type SeatPassengerRs = SeatPassenger;

/** `TaxType` del spec. */
export interface SeatTax {
  taxAmount?: number | string;
  taxCode?: string;
  description?: string;
}

/**
 * `PriceBreakdown` del spec, en la moneda del `PriceDefinition`. El spec dice string, pero en
 * producción los importes llegaron como número (`1200`, 2026-10-31): se acepta cualquiera.
 */
export interface SeatPriceBreakdown {
  /** Con impuestos. */
  amount: number | string;
  amountWithoutTaxes?: number | string;
  taxesTotal?: number | string;
  taxes?: SeatTax[];
  isTaxExempt?: boolean;
}

/** `PriceDefinition` del spec. */
export interface SeatPriceDefinition {
  id: string;
  currencyCode: string;
  totalPrice: SeatPriceBreakdown;
  referenceBasePrice?: SeatPriceBreakdown;
}

/** `OfferItemDetails` del spec. */
export interface SeatOfferItemDetails {
  serviceDefinitionRef: string;
  /** `id` de un `PriceDefinition` del mismo mensaje: ahí está el precio del asiento. */
  priceDefinitionRef?: string;
  segmentRefs: string[];
  passengerRefs: string[];
  refundableReissuableIndicator?: 'Yes' | 'No' | 'Reuse';
  isInterlineable?: boolean;
  sectorPortionIndicator?: 'Sector' | 'Portion' | 'Journey';
  feeApplicationMethod?: string;
  purchaseByDateTime?: string;
  annotations?: SeatKeyValuePair[];
}

/** `OfferItem` del spec: ítem reservable asignado a asientos. */
export interface SeatOfferItem extends SeatOfferItemDetails {
  id: string;
}

/** `DisplayOnlyItem` del spec: ítem solo informativo. */
export interface SeatDisplayOnlyItem extends SeatOfferItemDetails {
  id: string;
  displayOnlyReason?: 'Unavailable' | 'Unable To Book' | 'Restricted' | 'Unknown';
  displayOnlySource?: string;
  displayOnlyReasonDetails?: SeatKeyValuePair[];
}

/** `ServiceDefinition` del spec. */
export interface SeatServiceDefinition {
  id: string;
  serviceCode?: string;
  airlineCode?: string;
  commercialName?: string;
  /** Group code de ATPCO. */
  groupCode?: string;
  emdType?: 'Standalone' | 'Flight Coupon Associated' | 'Standalone Ticket Associated' | 'Other Than Emd' | 'Eticket';
  emdTypeCode?: number;
  specialServiceCode?: string;
  reasonForIssuance?: string;
  reasonForIssuanceCode?: string;
  isCommissionable?: boolean;
  isFeeGuaranteed?: boolean;
}

/** `SeatCharacteristic` / `RowCharacteristic` del spec (PADIS 9825). */
export interface SeatCharacteristic {
  code: string;
  description?: string;
}

/** `SeatType` del spec. El número de asiento es `row` de la fila más `column`. */
export interface Seat {
  column: string;
  /** PADIS 9865: `F` libre, `O` ocupado, … */
  occupationStatusCode?: string;
  characteristics?: SeatCharacteristic[];
  isOperative?: boolean;
  /** Ítems reservables (`offerItems[].id`) del asiento. */
  offerItemRefIds?: string[];
  /** Ítems solo informativos (`displayOnlyItems[].id`) del asiento. */
  displayOnlyItemRefIds?: string[];
}

/** `SeatRow` del spec. */
export interface SeatRow {
  row: number;
  characteristics?: SeatCharacteristic[];
  seats: Seat[];
}

/** `CabinLayoutRowPosition` del spec. */
export interface SeatCabinRowPosition {
  firstRow: number;
  lastRow: number;
}

/** `Facility` del spec. */
export interface SeatCabinFacility {
  firstRow: number;
  lastRow: number;
  columnIds?: string[];
  orientationCode: string;
  positionCodes: string[];
  facilityTypeCode: string;
}

/**
 * Un pasillo de la cabina: entre qué filas está y entre qué columnas (p. ej. `leftFromColumn: "D"`,
 * `rightFromColumn: "C"`). No está en el spec 3.0: llega en `byPnrLocator` y en
 * `byReservationPayload`, en CERT y en producción.
 */
export interface SeatCabinAisle {
  firstRow: number;
  lastRow: number;
  leftFromColumn: string;
  rightFromColumn: string;
}

/** `CabinLayoutType` del spec, más `aisles`, que el spec no trae. */
export interface SeatCabinLayout {
  columns: Array<{ id: string; position?: string[] }>;
  rows: SeatCabinRowPosition;
  wingRowPosition?: SeatCabinRowPosition[];
  exitRowPosition?: SeatCabinRowPosition[];
  seatCount?: number;
  authorizedSeatCount?: number;
  missingRowNumbers?: number[];
  missingSeats?: string[];
  facilities?: SeatCabinFacility[];
  deckCode?: string;
  /** Los pasillos. No está en el spec 3.0 (ver `SeatCabinAisle`). */
  aisles?: SeatCabinAisle[];
}

/** `CabinCompartment` del spec. */
export interface SeatCabinCompartment {
  firstRow?: number;
  lastRow?: number;
  columnIds?: string[];
  cabinCode?: string;
  cabinName?: string;
  cabinLayout?: SeatCabinLayout;
  seatRows?: SeatRow[];
}

/** `SeatMap` del spec. */
export interface SeatMap {
  /** `id` del segmento, del request o de `segments[]` de la respuesta. */
  segmentRef: string;
  /**
   * `id` de un `flightLegs[]` del segmento. En un vuelo directo, `byPnrLocator` lo manda como
   * `null` y `byReservationPayload` no lo manda (CERT, 2026-11-04, sabre-playground #11).
   */
  flightLegRef?: string | null;
  cabinCompartments?: SeatCabinCompartment[];
}

/** `SeatAvailabilityResponse` del spec 3.0. */
export interface SeatAvailabilityResponse {
  /** Solo lo usa `seatOffers` (NDC); por ATPCO el asiento se reserva por número. */
  offerId?: string;
  offerExpirationDateTime?: string;
  segments: SeatSegmentRs[];
  passengers: SeatPassengerRs[];
  serviceDefinitions: SeatServiceDefinition[];
  priceDefinitions?: SeatPriceDefinition[];
  offerItems: SeatOfferItem[];
  displayOnlyItems?: SeatDisplayOnlyItem[];
  seatMaps: SeatMap[];
}

/** `Error` / `Warning` del spec: la misma forma que los de Booking Management. */
export interface SeatAvailabilityIssue {
  category: string;
  type: string;
  description?: string;
  fieldName?: string;
  fieldPath?: string;
  /** Puede traer datos del request: no se copia a los errores del SDK. */
  fieldValue?: string;
}

/** `SeatAvailabilityRs` tal cual llega de Sabre. */
export interface RawSeatAvailabilityRs {
  response?: SeatAvailabilityResponse;
  errors?: SeatAvailabilityIssue[];
  warnings?: SeatAvailabilityIssue[];
}

/**
 * Resultado de `sabre.air.getSeats`: el `SeatAvailabilityRs` del spec con `errors[]` y
 * `warnings[]` reemplazados por los del SDK.
 */
export interface GetSeatsResponse {
  response: SeatAvailabilityResponse;
  /** `warnings[]` de Sabre. Nunca se lanzan. */
  warnings: SabreWarning[];
  /** `errors[]` que llegaron junto con un `response`: el mapa existe, pero puede faltar algo. */
  errors: SabreBusinessError[];
}

// ─── Operación ──────────────────────────────────────────────────────────────

/**
 * Get Seats: una sola función que elige el endpoint según si el request trae `pnrLocator`
 * (opción C de sabre-wiki/wiki/sdk/get-seats-en-el-sdk.md). Lectura: se puede reintentar.
 */
export async function getSeats(
  transport: RestTransport,
  request: GetSeatsRequest,
  options: RequestOptions = {},
): Promise<GetSeatsResponse> {
  if (!isObject(request)) {
    throw new TypeError('sabre-client: air.getSeats espera un objeto');
  }
  if ('pnrLocator' in request) {
    // Una mezcla nunca cae en silencio en un endpoint (ADR, opción C).
    if (!nonEmpty(request.pnrLocator)) {
      throw new TypeError('sabre-client: air.getSeats con pnrLocator vacío');
    }
    const mixed = PAYLOAD_FIELDS.filter((field) => field in request);
    if (mixed.length > 0) {
      throw new TypeError(`sabre-client: air.getSeats con pnrLocator no acepta ${mixed.join(', ')}`);
    }
    return send(transport, BY_PNR_LOCATOR_PATH, GET_SEATS_BY_PNR_LOCATOR_SERVICE, request, options);
  }
  if (!Array.isArray(request.segments) || !Array.isArray(request.passengers)) {
    throw new TypeError('sabre-client: air.getSeats espera { segments: [...], passengers: [...], ... } o { pnrLocator }');
  }
  return send(transport, BY_PAYLOAD_PATH, GET_SEATS_BY_PAYLOAD_SERVICE, request, options);
}

async function send(
  transport: RestTransport,
  path: string,
  service: string,
  request: GetSeatsRequest,
  options: RequestOptions,
): Promise<GetSeatsResponse> {
  const body = await transport.request<RawSeatAvailabilityRs>({
    method: 'POST',
    path,
    service,
    idempotent: true,
    body: request,
    classify: (raw) => classifyGetSeats(raw, service),
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onRawResponse === undefined
      ? {}
      : { operation: `air.${service}`, onRawResponse: options.onRawResponse }),
  });
  return {
    response: body.response!,
    warnings: issues(body.warnings).map((item) => toWarning(service, item)),
    errors: issues(body.errors).map((item) => toBusinessError(service, item)),
  };
}

/**
 * Paso 3 del orden de detección, con la política para servicios sin catálogo
 * (sabre-wiki/wiki/sdk/manejo-y-mapeo-de-errores.md): lo que decide si se lanza es si hay
 * `response`.
 *
 * - Hay `response`: no hay error; `errors[]` y `warnings[]` van adjuntos al resultado.
 * - No hay `response`: `SabreBusinessError` con el primer elemento de `errors[]`, y el resto
 *   de los errores y los `warnings[]` adjuntos. Sin catálogo, nada es reintentable.
 */
export function classifyGetSeats(body: unknown, service: string): SabreError | undefined {
  if (!isObject(body)) {
    return new SabreError(`${service}: respuesta malformada, se esperaba un objeto`, { retryable: false, raw: body });
  }
  const rs = body as RawSeatAvailabilityRs;
  if (isObject(rs.response)) return undefined;

  const [first, ...rest] = issues(rs.errors);
  if (first !== undefined) {
    return toBusinessError(service, first, {
      warnings: issues(rs.warnings).map((item) => toWarning(service, item)),
      errors: rest.map((item) => toBusinessError(service, item)),
    });
  }
  return new SabreError(`${service}: respuesta malformada, sin response ni errors`, { retryable: false, raw: body });
}

function issues(list: SeatAvailabilityIssue[] | undefined): SeatAvailabilityIssue[] {
  return Array.isArray(list) ? list.filter(isObject) as SeatAvailabilityIssue[] : [];
}
