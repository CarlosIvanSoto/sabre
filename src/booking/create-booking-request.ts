// Tipos del request de Create Booking (Booking Management API v1, Swagger v1.33).
// Ver sabre-wiki/wiki/entities/booking-management-api.md, sección "Request ATPCO por flightDetails".
//
// Tier 1: se tipa el camino ATPCO (`flightDetails`), viajeros, contacto y agencia. Los caminos
// NDC (`flightOffer`), hotel, auto y perfiles quedan fuera del tipo.

export type CreateBookingErrorPolicy =
  | 'HALT_ON_ERROR'
  | 'DO_NOT_HALT_ON_FLIGHT_PRICING_ERROR'
  | 'DO_NOT_HALT_ON_HOTEL_BOOKING_ERROR'
  | 'DO_NOT_HALT_ON_ANCILLARY_BOOKING_ERROR'
  | 'DO_NOT_HALT_ON_SEAT_BOOKING_ERROR'
  | 'HALT_ON_INVALID_MINIMUM_CONNECTING_TIME_ERROR'
  | 'DO_NOT_HALT_ON_CAR_BOOKING_ERROR'
  | 'DO_NOT_HALT_ON_IDENTITY_DOCUMENT_WARNING';

/** Body de `POST /v1/trip/orders/createBooking`. Ningún campo es obligatorio en el primer nivel. */
export interface CreateBookingRequest {
  /** Por defecto Sabre aplica `HALT_ON_ERROR`. */
  errorHandlingPolicy?: CreateBookingErrorPolicy[];
  /** Cambia el PCC. Sabre no revierte el contexto después de reservar. */
  targetPcc?: string;
  /** Por defecto `'Create Booking'`. */
  receivedFrom?: string;
  asynchronousUpdateWaitTime?: number;
  agency?: BookingAgency;
  flightDetails?: FlightDetails;
  travelers?: BookTraveler[];
  /** El primer teléfono debe ser el de la agencia y después el del viajero. */
  contactInfo?: BookContactInformation;
  /** `Payment` del spec (formas de pago). Sin tipar en el Tier 1. */
  payment?: Record<string, unknown>;
  /** `BookRemark[]` del spec. Sin tipar en el Tier 1. */
  remarks?: Array<Record<string, unknown>>;
  /** `OtherServiceInformation[]` del spec (OSI). Sin tipar en el Tier 1. */
  otherServices?: Array<Record<string, unknown>>;
  /** `YYYY-MM-DD`. */
  retentionEndDate?: string;
  retentionLabel?: string;
  sendLoyaltiesToAllAirlines?: boolean;
}

export type FlightStatusCode = 'NO' | 'NN' | 'UC' | 'US' | 'UN' | 'UU' | 'LL' | 'HL';

/** Reserva ATPCO/LCC: vuelos a reservar y cómo cotizarlos. */
export interface FlightDetails {
  /** 1–16 vuelos. */
  flights: FlightToBook[];
  /** 1–10 bloques: uno por tipo de pasajero si se quieren mark-ups o comisiones distintos. */
  flightPricing?: PricingDetails[];
  /** Si va vacío, Sabre se detiene ante `NO`, `UC`, `US`, `UN`, `UU`, `LL` o `HL`. */
  haltOnFlightStatusCodes?: FlightStatusCode[];
  /** Vuelve a reservar los vuelos no confirmados en la tarifa más baja. Puede subir el precio. */
  retryBookingUnconfirmedFlights?: boolean;
}

export interface FlightToBook {
  /** Número de vuelo de la aerolínea comercializadora (1–9999). */
  flightNumber: number;
  /** Código IATA de 2 caracteres de la aerolínea comercializadora. */
  airlineCode: string;
  fromAirportCode: string;
  toAirportCode: string;
  /** `YYYY-MM-DD`, hora local del aeropuerto. */
  departureDate: string;
  /** `HH:MM`, sin segundos ni offset. */
  departureTime: string;
  bookingClass: string;
  /** Obligatorio en el spec aunque su descripción diga "default `NN`". */
  flightStatusCode: string;
  isMarriageGroup?: boolean;
  /** Por defecto `ATPCO`. */
  source?: 'ATPCO' | 'LCC';
  seats?: BookSeat[];
  changeOfGaugeSeats?: BookGenericSeat[];
  /** Solo para reservas pasivas. */
  confirmationId?: string;
  /** Solo para reservas pasivas, `YYYY-MM-DD`. */
  arrivalDate?: string;
  /** Solo para reservas pasivas, `HH:MM`. */
  arrivalTime?: string;
}

export interface BookGenericSeat {
  /** Índice 1-based del viajero en `travelers[]`. */
  travelerIndex: number;
  /** P. ej. `12A`. No se combina con `areaPreferences`. */
  number?: string;
}

export type SeatAreaPreference = 'AISLE' | 'BULKHEAD' | 'FRONT' | 'LEFT_SIDE' | 'RIGHT_SIDE' | 'TAIL' | 'WINDOW';

export interface BookSeat extends BookGenericSeat {
  /** Hasta 3 preferencias que no choquen. No se combina con `number`. */
  areaPreferences?: SeatAreaPreference[];
}

export interface PricingDetails {
  /** 1–2 umbrales. Si el precio los excede, Sabre corta con `UNABLE_TO_PRICE_FLIGHTS_THRESHOLD_EXCEEDED`. */
  priceComparisons?: PriceComparison[];
  qualifiers?: PricingQualifiers;
}

export type PriceComparisonType = 'INCREASE_BY_AMOUNT' | 'INCREASE_BY_PERCENT' | 'DECREASE_BY_AMOUNT' | 'DECREASE_BY_PERCENT';

/** Sin campo de moneda: se compara contra el precio en la moneda del pricing (sin confirmar). */
export interface PriceComparison {
  /** Monto decimal como string, incluye ancillaries. */
  desiredAmount: string;
  comparisonType: PriceComparisonType;
  /** Umbral en monto. No se combina con `percent`. */
  amount?: string;
  /** Umbral en porcentaje. No se combina con `amount`. */
  percent?: string;
}

/**
 * Subconjunto de `PricingQualifiers` (unos 40 campos en el spec) que usa el Tier 1. Los
 * índices de vuelo son 1-based.
 */
export interface PricingQualifiers {
  passengersPricing?: PassengerPricing[];
  validatingAirlineCode?: string;
  currencyPricing?: string;
  brandedFares?: BrandedFare[];
  specificFares?: SpecificFare[];
  flightIndices?: number[];
  rebookLowestFares?: boolean;
  cabinCode?: string;
  excludeBasicEconomyFares?: boolean;
  usePrivateFare?: boolean;
  usePublicFare?: boolean;
  useNetFare?: boolean;
  /** Por defecto `true`. */
  priceWithTaxes?: boolean;
  payment?: PaymentMethod;
  commissionAmount?: string;
  commissionPercentage?: string;
  tourCode?: string;
  travelerIndices?: number[];
}

export interface PassengerPricing {
  /** `ADT`; para infantes `INF`. */
  passengerCode?: string;
  /** Con la "p" minúscula, tal cual en el spec. */
  numberOfpassengers?: number;
  forcePassengerCode?: boolean;
}

export interface BrandedFare {
  brandCode: string;
  flightIndices?: number[];
}

export interface SpecificFare {
  fareBasisCode: string;
  flightIndices?: number[];
}

/** Índices 1-based de `payment.formsOfPayment[]`. */
export interface PaymentMethod {
  primaryFormOfPayment: number;
  secondaryFormOfPayment?: number;
  amountOnSecondFormOfPayment?: string;
}

export type TravelerTitle =
  | 'Mr'
  | 'Mrs'
  | 'Ms'
  | 'Dr'
  | 'Miss'
  | 'Mstr'
  | 'Mlle'
  | 'Sir'
  | 'Father'
  | 'Sister'
  | 'Brother'
  | 'Reverend'
  | 'Lt'
  | 'Capt'
  | 'Congressman'
  | 'Duke'
  | 'Duchess'
  | 'Prof';

export interface BookTraveler {
  title?: TravelerTitle;
  givenName?: string;
  /** Sin dígitos. */
  surname?: string;
  /** `YYYY-MM-DD`. Obligatorio para infantes (SSR `INFT`). */
  birthDate?: string;
  /** `ADT`; para infantes `INF`, `INY` o `INS`. */
  passengerCode?: string;
  nameReferenceCode?: string;
  emails?: string[];
  phones?: TravelerPhone[];
  /** `BookIdentityDocument[]` del spec. Sin tipar en el Tier 1. */
  identityDocuments?: Array<Record<string, unknown>>;
  /** `LoyaltyProgram[]` del spec. Sin tipar en el Tier 1. */
  loyaltyPrograms?: Array<Record<string, unknown>>;
  /** `BookSpecialService[]` del spec (SSR). Sin tipar en el Tier 1. */
  specialServices?: Array<Record<string, unknown>>;
  formOfPaymentIndices?: number[];
  /** Índice 1-based del infante asignado a este adulto. */
  infantTravelerIndex?: number;
  employerIndex?: number;
}

export interface TravelerPhone {
  /** Solo dígitos, `+` y `-`. */
  number: string;
  /** `H` casa, `B` trabajo, `C` celular, `M` móvil. */
  label?: 'H' | 'B' | 'C' | 'M';
}

export interface BookContactInformation {
  emails?: string[];
  /** Solo dígitos, `+` y `-`. */
  phones?: string[];
  faxes?: string[];
  emergencyPhones?: string[];
}

export type TicketingPolicy = 'TODAY' | 'ALREADY_TICKETED' | 'FUTURE_TICKETING' | 'TICKETING_TIME_LIMIT';

/** `Agency` del spec. Dirección y contactos sin tipar en el Tier 1. */
export interface BookingAgency {
  ticketingPolicy?: TicketingPolicy;
  agencyCustomerNumber?: string;
  address?: Record<string, unknown>;
  contactInfo?: Record<string, unknown>;
  futureTicketingPolicy?: Record<string, unknown>;
  ticketingTimeLimitPolicy?: Record<string, unknown>;
}
