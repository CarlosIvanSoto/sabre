// Modelo `groupedItineraryResponse` compartido por Bargain Finder Max y Revalidate Itinerary,
// y su desnormalizador: resuelve cada `ref` al objeto completo antes de exponerlo.
// Ver sabre-wiki/wiki/concepts/modelo-de-itinerario.md.
//
// Sin schema formal: los campos salen de los ejemplos de BFM y Revalidate del wiki. Los que
// solo aparecieron en uno de los dos van como opcionales.
import { SabreError } from '../errors/index.js';

// ---------------------------------------------------------------------------
// Descriptores compartidos (arrays planos indexados por `id`)
// ---------------------------------------------------------------------------

export interface ScheduleEndpoint {
  airport: string;
  city?: string;
  country?: string;
  /** Hora local con offset, p. ej. `17:10:00+02:00`. */
  time: string;
  terminal?: string;
}

export interface ScheduleEquipment {
  code: string;
  typeForFirstLeg?: string;
  typeForLastLeg?: string;
}

export interface ScheduleCarrier {
  marketing: string;
  marketingFlightNumber: number;
  operating?: string;
  operatingFlightNumber?: number;
  alliances?: string;
  equipment?: ScheduleEquipment;
}

/** Vuelo/segmento operado (`scheduleDescs[]`). */
export interface ScheduleDesc {
  id: number;
  frequency?: string;
  stopCount?: number;
  eTicketable?: boolean;
  totalMilesFlown?: number;
  /** Minutos. */
  elapsedTime?: number;
  departure: ScheduleEndpoint;
  arrival: ScheduleEndpoint;
  carrier: ScheduleCarrier;
}

/** Tramo lógico (`legDescs[]`): agrupa schedules por `ref`. */
export interface LegDesc {
  id: number;
  /** Minutos. */
  elapsedTime?: number;
  schedules: Ref[];
}

/** Impuesto individual (`taxDescs[]`). */
export interface TaxDesc {
  id: number;
  code: string;
  amount: number;
  currency: string;
  description?: string;
  publishedAmount?: number;
  publishedCurrency?: string;
  station?: string;
  country?: string;
}

/** Resumen de impuestos por código (`taxSummaryDescs[]`). Misma forma que `TaxDesc`. */
export type TaxSummaryDesc = TaxDesc;

/** Cargo adicional (`obFeeDescs[]`). Significado exacto de "OB" sin confirmar. */
export interface ObFeeDesc {
  id: number;
  amount: number;
  currency: string;
}

export interface FareComponentDescSegment {
  segment: {
    stopover?: boolean;
  };
}

/** Componente de tarifa (`fareComponentDescs[]`). */
export interface FareComponentDesc {
  id: number;
  governingCarrier?: string;
  fareAmount?: number;
  fareCurrency?: string;
  fareBasisCode: string;
  farePassengerType?: string;
  publishedFareAmount?: number;
  publishedFareCurrency?: string;
  /** `FROM` / `TO`. */
  directionality?: string;
  applicablePricingCategories?: string;
  vendorCode?: string;
  fareTypeBitmap?: string;
  fareType?: string;
  fareTariff?: string;
  fareRule?: string;
  cabinCode?: string;
  segments?: FareComponentDescSegment[];
  // Vistos solo en Revalidate Itinerary.
  ticketDesignator?: string;
  mileageSurcharge?: number;
  mileage?: boolean;
  oneWayFare?: boolean;
  negotiatedFare?: boolean;
  privateFare?: boolean;
  notValidAfter?: string;
  /** Distinto de `directionality`; significado sin confirmar. */
  direction?: string;
}

/** Aerolínea validadora (`validatingCarrierDescs[]`). */
export interface ValidatingCarrierDesc {
  id: number;
  settlementMethod?: string;
  newVcxProcess?: boolean;
  default?: { code: string };
}

/** Franquicia de equipaje (`baggageAllowanceDescs[]`). */
export interface BaggageAllowanceDesc {
  id: number;
  pieceCount?: number;
}

// ---------------------------------------------------------------------------
// Piezas que no llevan referencias
// ---------------------------------------------------------------------------

/** Referencia a un descriptor por su `id`. */
export interface Ref {
  ref: number;
}

export interface ItineraryMessage {
  severity: string;
  type: string;
  code: string;
  text: string;
}

export interface LegDescription {
  departureDate: string;
  departureLocation: string;
  arrivalLocation: string;
}

export interface CurrencyConversion {
  from: string;
  to: string;
  exchangeRateUsed: number;
}

export interface PassengerTotalFare {
  totalFare: number;
  totalTaxAmount?: number;
  currency: string;
  baseFareAmount?: number;
  baseFareCurrency?: string;
  equivalentAmount?: number;
  equivalentCurrency?: string;
  constructionAmount?: number;
  constructionCurrency?: string;
  exchangeRateOne?: number;
  // Comisión de agencia: vistos solo en Revalidate Itinerary.
  commissionPercentage?: number;
  commissionAmount?: number;
  cat35CommissionPercentage?: number;
  cat35CommissionAmount?: number;
  cat35MarkupAmount?: number;
  commissionAmountInEquivalent?: number;
  commissionSource?: string;
}

export interface TotalFare {
  totalPrice: number;
  totalTaxAmount?: number;
  currency: string;
  baseFareAmount?: number;
  baseFareCurrency?: string;
  constructionAmount?: number;
  constructionCurrency?: string;
  equivalentAmount?: number;
  equivalentCurrency?: string;
}

/** Disponibilidad del segmento dentro de un componente de tarifa. */
export interface FareComponentSegmentDetail {
  bookingCode?: string;
  cabinCode?: string;
  mealCode?: string;
  seatsAvailable?: number;
  availabilityBreak?: boolean;
  fareBreakPoint?: boolean;
}

export interface FareMessage {
  type: string;
  code: string;
  info: string;
}

// ---------------------------------------------------------------------------
// Respuesta tal cual la manda Sabre (con `ref`). Interna: el SDK expone la desnormalizada.
// ---------------------------------------------------------------------------

export interface RawFareComponent extends Ref {
  beginAirport?: string;
  endAirport?: string;
  segments?: Array<{ segment: FareComponentSegmentDetail }>;
}

export interface RawBaggageInformation {
  provisionType?: string;
  airlineCode?: string;
  /** Índices de segmento, no referencias a descriptores. */
  segments?: Array<{ id: number }>;
  allowance?: Ref;
}

export interface RawPassengerInfo {
  passengerType: string;
  passengerNumber?: number;
  nonRefundable?: boolean;
  fareComponents?: RawFareComponent[];
  taxes?: Ref[];
  taxSummaries?: Ref[];
  obFees?: Ref[];
  currencyConversion?: CurrencyConversion;
  passengerTotalFare?: PassengerTotalFare;
  baggageInformation?: RawBaggageInformation[];
  // Vistos solo en Revalidate Itinerary.
  fareMessages?: FareMessage[];
  fareCalcLine?: { info: string };
}

export interface RawFare {
  mandatoryInd?: boolean;
  validatingCarrierCode?: string;
  vita?: boolean;
  eTicketable?: boolean;
  lastTicketDate?: string;
  lastTicketTime?: string;
  governingCarriers?: string;
  passengerInfoList: Array<{ passengerInfo: RawPassengerInfo }>;
  totalFare?: TotalFare;
  validatingCarriers?: Ref[];
}

export interface RawPricingInformation {
  pricingSubsource?: string;
  /** Visto solo en Revalidate Itinerary, p. ej. `ATPCO`. */
  distributionModel?: string;
  fare: RawFare;
}

export interface RawItinerary {
  id: number;
  pricingSource?: string;
  /** Visto solo en Revalidate Itinerary. */
  currentItinerary?: boolean;
  legs: Ref[];
  pricingInformation: RawPricingInformation[];
}

export interface RawItineraryGroup {
  groupDescription: { legDescriptions: LegDescription[] };
  itineraries: RawItinerary[];
}

/** Contenido de `groupedItineraryResponse` tal cual llega de Sabre. */
export interface RawGroupedItineraryResponse {
  version: string;
  messages?: ItineraryMessage[];
  statistics?: { itineraryCount: number };
  scheduleDescs?: ScheduleDesc[];
  taxDescs?: TaxDesc[];
  taxSummaryDescs?: TaxSummaryDesc[];
  obFeeDescs?: ObFeeDesc[];
  fareComponentDescs?: FareComponentDesc[];
  validatingCarrierDescs?: ValidatingCarrierDesc[];
  baggageAllowanceDescs?: BaggageAllowanceDesc[];
  legDescs?: LegDesc[];
  itineraryGroups?: RawItineraryGroup[];
}

// ---------------------------------------------------------------------------
// Respuesta desnormalizada (superficie pública)
// ---------------------------------------------------------------------------

/** Tramo con sus schedules resueltos. */
export interface Leg extends Omit<LegDesc, 'schedules'> {
  schedules: ScheduleDesc[];
}

/** Segmento de un componente de tarifa: lo del descriptor más la disponibilidad del itinerario. */
export interface FareComponentSegment {
  segment: FareComponentDescSegment['segment'] & FareComponentSegmentDetail;
}

/** Componente de tarifa resuelto: descriptor + datos propios del itinerario. */
export interface FareComponent extends Omit<FareComponentDesc, 'segments'> {
  beginAirport?: string;
  endAirport?: string;
  segments?: FareComponentSegment[];
}

export interface BaggageInformation extends Omit<RawBaggageInformation, 'allowance'> {
  allowance?: BaggageAllowanceDesc;
}

export interface PassengerInfo
  extends Omit<RawPassengerInfo, 'fareComponents' | 'taxes' | 'taxSummaries' | 'obFees' | 'baggageInformation'> {
  fareComponents?: FareComponent[];
  taxes?: TaxDesc[];
  taxSummaries?: TaxSummaryDesc[];
  obFees?: ObFeeDesc[];
  baggageInformation?: BaggageInformation[];
}

export interface Fare extends Omit<RawFare, 'passengerInfoList' | 'validatingCarriers'> {
  passengerInfoList: Array<{ passengerInfo: PassengerInfo }>;
  validatingCarriers?: ValidatingCarrierDesc[];
}

export interface PricingInformation extends Omit<RawPricingInformation, 'fare'> {
  fare: Fare;
}

export interface Itinerary extends Omit<RawItinerary, 'legs' | 'pricingInformation'> {
  legs: Leg[];
  pricingInformation: PricingInformation[];
}

export interface ItineraryGroup {
  groupDescription: { legDescriptions: LegDescription[] };
  itineraries: Itinerary[];
}

/**
 * `groupedItineraryResponse` con cada `ref` resuelto al objeto completo. Los arrays de
 * descriptores (`scheduleDescs`, `legDescs`, …) ya no se exponen: su contenido vive
 * dentro de cada itinerario.
 */
export interface GroupedItineraryResponse {
  version: string;
  messages: ItineraryMessage[];
  statistics?: { itineraryCount: number };
  itineraryGroups: ItineraryGroup[];
}

// ---------------------------------------------------------------------------
// Desnormalizador
// ---------------------------------------------------------------------------

/**
 * Resuelve cada `{ ref, ...resto }` a `{ ...descriptor, ...resto }` (sin `ref`; el `id` del
 * descriptor se conserva). En los componentes de tarifa, `segments` se fusiona elemento a
 * elemento: el descriptor aporta `stopover` y el itinerario la disponibilidad; si los dos
 * traen `segments` con distinto largo, la respuesta es malformada.
 *
 * Un `ref` sin descriptor con ese `id` es una respuesta malformada: lanza `SabreError`
 * no reintentable en vez de devolver un objeto a medias. No muta la entrada.
 */
export function denormalizeGroupedItineraryResponse(
  raw: RawGroupedItineraryResponse,
  service: string,
): GroupedItineraryResponse {
  const resolver = new Resolver(raw, service);
  return {
    version: raw.version,
    messages: raw.messages ?? [],
    ...(raw.statistics === undefined ? {} : { statistics: raw.statistics }),
    itineraryGroups: (raw.itineraryGroups ?? []).map((group) => ({
      groupDescription: group.groupDescription,
      itineraries: group.itineraries.map((itinerary) => resolver.itinerary(itinerary)),
    })),
  };
}

class Resolver {
  readonly #service: string;
  readonly #schedules: Map<number, ScheduleDesc>;
  readonly #legs: Map<number, LegDesc>;
  readonly #taxes: Map<number, TaxDesc>;
  readonly #taxSummaries: Map<number, TaxSummaryDesc>;
  readonly #obFees: Map<number, ObFeeDesc>;
  readonly #fareComponents: Map<number, FareComponentDesc>;
  readonly #validatingCarriers: Map<number, ValidatingCarrierDesc>;
  readonly #baggageAllowances: Map<number, BaggageAllowanceDesc>;

  constructor(raw: RawGroupedItineraryResponse, service: string) {
    this.#service = service;
    this.#schedules = byId(raw.scheduleDescs);
    this.#legs = byId(raw.legDescs);
    this.#taxes = byId(raw.taxDescs);
    this.#taxSummaries = byId(raw.taxSummaryDescs);
    this.#obFees = byId(raw.obFeeDescs);
    this.#fareComponents = byId(raw.fareComponentDescs);
    this.#validatingCarriers = byId(raw.validatingCarrierDescs);
    this.#baggageAllowances = byId(raw.baggageAllowanceDescs);
  }

  itinerary(itinerary: RawItinerary): Itinerary {
    return {
      ...itinerary,
      legs: itinerary.legs.map((ref) => this.#leg(ref)),
      pricingInformation: itinerary.pricingInformation.map((pricing) => ({
        ...pricing,
        fare: this.#fare(pricing.fare),
      })),
    };
  }

  #leg(ref: Ref): Leg {
    const leg = this.#merge(this.#legs, 'legDescs', ref);
    return { ...leg, schedules: leg.schedules.map((schedule) => this.#merge(this.#schedules, 'scheduleDescs', schedule)) };
  }

  #fare(fare: RawFare): Fare {
    const { validatingCarriers, ...rest } = fare;
    return {
      ...rest,
      passengerInfoList: fare.passengerInfoList.map(({ passengerInfo, ...entry }) => ({
        ...entry,
        passengerInfo: this.#passengerInfo(passengerInfo),
      })),
      ...(validatingCarriers === undefined
        ? {}
        : {
            validatingCarriers: validatingCarriers.map((ref) =>
              this.#merge(this.#validatingCarriers, 'validatingCarrierDescs', ref),
            ),
          }),
    };
  }

  #passengerInfo(info: RawPassengerInfo): PassengerInfo {
    const { fareComponents, taxes, taxSummaries, obFees, baggageInformation, ...rest } = info;
    const result: PassengerInfo = { ...rest };
    if (fareComponents !== undefined) result.fareComponents = fareComponents.map((ref) => this.#fareComponent(ref));
    if (taxes !== undefined) result.taxes = taxes.map((ref) => this.#merge(this.#taxes, 'taxDescs', ref));
    if (taxSummaries !== undefined) {
      result.taxSummaries = taxSummaries.map((ref) => this.#merge(this.#taxSummaries, 'taxSummaryDescs', ref));
    }
    if (obFees !== undefined) result.obFees = obFees.map((ref) => this.#merge(this.#obFees, 'obFeeDescs', ref));
    if (baggageInformation !== undefined) {
      result.baggageInformation = baggageInformation.map(({ allowance, ...bag }) => ({
        ...bag,
        ...(allowance === undefined
          ? {}
          : { allowance: this.#merge(this.#baggageAllowances, 'baggageAllowanceDescs', allowance) }),
      }));
    }
    return result;
  }

  #fareComponent(ref: RawFareComponent): FareComponent {
    const desc = this.#lookup(this.#fareComponents, 'fareComponentDescs', ref.ref);
    const { ref: _ref, segments: siteSegments, ...site } = ref;
    const { segments: descSegments, ...descRest } = desc;
    if (descSegments !== undefined && siteSegments !== undefined && descSegments.length !== siteSegments.length) {
      throw this.#malformed(
        `fareComponents con ${siteSegments.length} segmentos y fareComponentDescs ${ref.ref} con ${descSegments.length}`,
      );
    }
    const segments = mergeSegments(descSegments, siteSegments);
    return { ...descRest, ...site, ...(segments === undefined ? {} : { segments }) };
  }

  /** `{ ref, ...resto }` → `{ ...descriptor, ...resto }`. */
  #merge<T extends { id: number }>(index: Map<number, T>, kind: string, ref: Ref): T {
    const { ref: id, ...site } = ref;
    return { ...this.#lookup(index, kind, id), ...site };
  }

  #lookup<T>(index: Map<number, T>, kind: string, id: number): T {
    const desc = index.get(id);
    if (desc === undefined) throw this.#malformed(`ref ${id} sin descriptor en ${kind}`);
    return desc;
  }

  #malformed(detail: string): SabreError {
    return new SabreError(`${this.#service}: respuesta malformada, ${detail}`, { retryable: false });
  }
}

function byId<T extends { id: number }>(descs: T[] | undefined): Map<number, T> {
  return new Map((descs ?? []).map((desc) => [desc.id, desc]));
}

function mergeSegments(
  desc: FareComponentDescSegment[] | undefined,
  site: Array<{ segment: FareComponentSegmentDetail }> | undefined,
): FareComponentSegment[] | undefined {
  if (desc === undefined && site === undefined) return undefined;
  // Los largos ya se validaron iguales cuando vienen los dos.
  const length = desc?.length ?? site?.length ?? 0;
  return Array.from({ length }, (_, i) => ({
    segment: { ...desc?.[i]?.segment, ...site?.[i]?.segment },
  }));
}
