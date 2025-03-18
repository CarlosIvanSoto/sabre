import { Tax, Value } from "../../common/interfaces"
/**
 * Identifica el código de estado del vuelo que se consideró inaceptable. Consulte la [página de códigos de estado de Sabre Central](https://central.sabre.com/s/article/status-codes---overview) para obtener más información sobre los diferentes códigos de estado.
 *
 * example: NO
 */
const HALT_ON_FLIGHT_STATUS_CODE = {
  NO: "NO",
  NN: "NN",
  UC: "UC",
  US: "US",
  UN: "UN",
  UU: "UU",
  LL: "LL",
  HL: "HL",
} as const

type HaltOnFlightStatusCodeEnum = keyof typeof HALT_ON_FLIGHT_STATUS_CODE
/**
 * Contiene todos los detalles de los vuelos a reservar.
 */
export interface FlightDetails {
  /**
   * Contiene vuelos individuales para reservar.
   *
   * minItems: 1
   * maxItems: 16
   */
  /**
   * Contiene información de vuelo.
   */
  flights?: FlightToBook[]
  /**
   * Contiene calificadores de precios. Si desea asignar diferentes márgenes o comisiones por tipo de pasajero específico, puede enviar instrucciones de precios separadas para cada tipo.
   *
   * minItems: 1
   * maxItems: 10
   */
  /**
   * Contiene campos opcionales necesarios para pasar información de precios que puede ser necesaria para completar la reserva.
   */
  flightPricing?: PricingDetails[]
  /**
   * Enumera códigos de estado de vuelo opcionales que se consideran inaceptables. El sistema dejará de procesar si encuentra un código de estado inaceptable dentro de un vuelo reservado. Si no se proporcionan códigos de estado, el sistema detendrá automáticamente el procesamiento cuando encuentre (`NO`, `UC`, `US`, `UN`, `UU`, `LL`, `HL`).
   */
  haltOnFlightStatusCodes?: HaltOnFlightStatusCodeEnum[]
  /**
   * Si es cierto, el sistema intentará volver a reservar vuelos no confirmados. Si alguno de los vuelos reservados devuelve un código de estado inaceptable (según lo definido por `HaltOnFlightStatusCodeEnum`), el sistema los cancelará y los volverá a reservar con la tarifa más baja disponible. Si los códigos de estado siguen siendo inaceptables después de que se haya completado el proceso, el sistema dejará de procesar y devolverá un mensaje de error. `retryBookingUnconfirmedFlights` puede resultar en un aumento de precio.
   *
   * example: True
   */
  retryBookingUnconfirmedFlights?: boolean
}
/**
 * Identifica el método de reserva de un vuelo. `ATPCO` es el método de reserva tradicional. "LCC" es el método de reserva de compra instantánea común en las aerolíneas de bajo coste como "U2" o "FR". Si no se especifica, el valor predeterminado es "ATPCO".
 *
 * example: ATPCO
 */
const FLIGHT_TO_BOOK_SOURCE = {
  ATPCO: "ATPCO",
  LCC: "LCC",
} as const
type FlightToBookSourceEnum = keyof typeof FLIGHT_TO_BOOK_SOURCE
/**
 * Contiene información de vuelo.
 */
interface FlightToBook {
  /**
   * El número de vuelo asociado con la aerolínea de marketing.
   *
   * format: int32
   * minimum: 1
   * maximum: 9999
   * example: 123
   */
  flightNumber: number
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea comercializadora.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  airlineCode: string
  /**
   * El código de aeropuerto IATA de tres letras del aeropuerto de origen.
   *
   * pattern: ^[A-Z]{3}$
   * example: DFW
   */
  fromAirportCode: string
  /**
   * El código de aeropuerto IATA de tres letras del aeropuerto de destino.
   *
   * pattern: ^[A-Z]{3}$
   * example: HNL
   */
  toAirportCode: string
  /**
   * La fecha de salida programada en formato `AAAA-MM-DD` en la zona horaria del aeropuerto.
   *
   * format: date
   * example: 2019-07-09
   */
  departureDate: string
  /**
   * La hora de salida programada en formato `HH:MM`.
   *
   * pattern: ^([0-1][0-9]|2[0-3]):[0-5][0-9]$
   * example: 09:15
   */
  departureTime: string
  /**
   * El código de reserva.
   *
   * pattern: ^[A-Za-z ]+$
   * example: Y
   */
  bookingClass: string
  /**
   * Si es cierto, el segmento de vuelo es parte de una conexión matrimonial.
   *
   * example: False
   */
  isMarriageGroup?: boolean
  /**
   * El código de estado deseado para el vuelo reservado. El valor predeterminado es "NN".
   *
   * pattern: ^[A-Za-z ]+$
   * example: NN
   */
  flightStatusCode: string
  /**
   * El ID de referencia de la reserva. Complete este valor si realizó una reserva directamente con la aerolínea y desea crear una reserva pasiva de Sabre.
   *
   * pattern: ^[A-Z0-9]{5,}$
   * example: NIEBNY
   */
  confirmationId?: string
  /**
   * La fecha de llegada en formato `AAAA-MM-DD` en la zona horaria del aeropuerto. Se utiliza con el fin de crear reservas pasivas.
   *
   * format: date
   * example: 2019-07-09
   */
  arrivalDate?: string
  /**
   * La hora de llegada en formato `HH:MM`. Se utiliza con el fin de crear reservas pasivas.
   *
   * pattern: ^([0-1][0-9]|2[0-3]):[0-5][0-9]$
   * example: 12:28
   */
  arrivalTime?: string
  /**
   * Identifica el método de reserva de un vuelo. `ATPCO` es el método de reserva tradicional. "LCC" es el método de reserva de compra instantánea común en las aerolíneas de bajo coste como "U2" o "FR". Si no se especifica, el valor predeterminado es "ATPCO".
   */
  source?: FlightToBookSourceEnum
  /**
   * Contiene detalles de un asiento particular a reservar o un área preferida en la cabina.
   */
  seats?: BookSeat[]
}
/**
 * Identifica la preferencia de área. No se puede combinar con "número". Puede combinar un máximo de tres valores que no entren en conflicto, como "FRONT" y "LEFT_SIDE", etc.
 *
 * example: AISLE
 */
const SEAT_AREA_PREFERENCE = {
  AISLE: "AISLE",
  BULKHEAD: "BULKHEAD",
  FRONT: "FRONT",
  LEFT_SIDE: "LEFT_SIDE",
  RIGHT_SIDE: "RIGHT_SIDE",
  TAIL: "TAIL",
  WINDOW: "WINDOW",
} as const
type SeatAreaPreferenceEnum = keyof typeof SEAT_AREA_PREFERENCE
/**
 * Contiene detalles de un asiento particular a reservar o un área preferida en la cabina.
 */
interface BookSeat {
  /**
   * El número de asiento a asignar. No se puede combinar con `areaPreference`.
   *
   * pattern: ^[0-9]+[A-Z]$
   * example: 13A
   */
  number?: string
  /**
   * El índice de viajero que coincide con el número de asiento en particular.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndex: number
  /**
   * Identifica la preferencia de área. No se puede combinar con "número". Puede combinar un máximo de tres valores que no entren en conflicto, como "FRONT" y "LEFT_SIDE", etc.
   *
   * minItems: 1
   * maxItems: 3
   */
  areaPreferences?: SeatAreaPreferenceEnum[]
}
/**
 * Contiene campos opcionales necesarios para pasar información de precios que puede ser necesaria para completar la reserva.
 */
interface PricingDetails {
  /**
   * Contiene detalles del umbral de precio de reserva aceptable con el que se validará. Si se excede el umbral, el sistema detiene el procesamiento y finaliza la transacción.
   *
   * minItems: 1
   * maxItems: 2
   */
  priceComparisons?: PriceComparison[]
  /**
   * Contiene todos los calificadores de precios opcionales.
   */
  qualifiers?: PricingQualifiers
}
/**
 * Identifica el método de comparación.
 *
 * example: INCREASE_BY_AMOUNT
 */
const COMPARASION_TYPE = {
  INCREASE_BY_AMOUNT: "INCREASE_BY_AMOUNT",
  INCREASE_BY_PERCENT: "INCREASE_BY_PERCENT",
  DECREASE_BY_AMOUNT: "DECREASE_BY_AMOUNT",
  DECREASE_BY_PERCENT: "DECREASE_BY_PERCENT",
} as const
type ComparisonTypeEnum = keyof typeof COMPARASION_TYPE
/**
 * Contiene detalles del umbral de precio de reserva aceptable con el que se validará. Si se excede el umbral, el sistema detiene el procesamiento y finaliza la transacción.
 */
interface PriceComparison {
  /**
   * La cantidad deseada que servirá como base para comparar precios.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 100.00
   */
  desiredAmount: string
  /**
   * Identifica el método de comparación.
   */
  comparisonType: ComparisonTypeEnum
  /**
   * El umbral monetario aceptable que puede superar la cantidad deseada. No se puede combinar con "porcentaje".
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 30.00
   */
  amount?: string
  /**
   * El umbral porcentual aceptable que puede superar la cantidad deseada. No se puede combinar con "cantidad".
   *
   * pattern: ^[0-9]{1,2}(\.[0-9]{1,2})?$
   * example: 10.00
   */
  percent?: string
}
/**
 * Identifica el código de estado del pasajero.
 */
const PASSENGER_STATUS = {
  RESIDENT: "RESIDENT",
  NATIONALITY: "NATIONALITY",
  EMPLOYEE: "EMPLOYEE",
} as const
type PassengerStatusEnum = keyof typeof PASSENGER_STATUS
/**
 * Debe combinarse con `tourCode`. Identifica las opciones que se imprimirán en el billete final. `REPLACE_WITH_BT`: suprimirá el importe de la tarifa y lo reemplazará con `BT`. `REPLACE_WITH_IT`: suprimirá el importe de la tarifa y lo reemplazará con `IT`. `SUPPRESS_IT` suprimirá `IT`. `SUPPRESS_IT_AND_FARE` suprimirá `IT` así como el importe de la tarifa.
 *
 * example: REPLACE_WITH_BT
 */
const TOUR_CODE_OVERRIDES_OPTION = {
  REPLACE_WITH_BT: "REPLACE_WITH_BT",
  REPLACE_WITH_IT: "REPLACE_WITH_IT",
  SUPPRESS_IT: "SUPPRESS_IT",
  SUPPRESS_IT_AND_FARE: "SUPPRESS_IT_AND_FARE",
}
type TourCodeOverridesOptionEnum = keyof typeof TOUR_CODE_OVERRIDES_OPTION
/**
 * Contiene todos los calificadores de precios opcionales.
 */
interface PricingQualifiers {
  /**
   * Permite tarificar la reserva incorporando códigos de cuenta.
   */
  accountCode?: AccountCode
  /**
   * Contiene calificadores de precios de nivel de venta ajustado.
   */
  adjustedSellingLevel?: AdjustedSellingLevel
  /**
   * Enumera los índices de vuelos dentro de una reserva. Los índices no se pueden repetir en `BrandedFare.flightIndices` o `SpecificFare.flightIndices` ya que estas propiedades son mutuamente excluyentes.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  flightIndices?: number[]
  /**
   * Permite tarificar en función de asociar la franquicia de equipaje a vuelos específicos.
   *
   * minItems: 1
   * maxItems: 16
   */
  /**
   * Contiene información sobre franquicia de equipaje (ya sea su peso o el número de piezas).
   */
  baggageAllowance?: BookBaggageAllowance[]
  /**
   * Si es "verdadero", el sistema buscará las tarifas más bajas disponibles aplicables para toda la reserva. Una vez completado, los vuelos se volverán a reservar automáticamente.
   *
   * example: False
   */
  rebookLowestFares?: boolean
  /**
   * Contiene un código de marca deseado que se utilizará para fijar el precio de la reserva.
   *
   * minItems: 1
   * maxItems: 16
   */
  /**
   * Contiene un código de marca deseado que se utilizará para fijar el precio de la reserva.
   */
  brandedFares?: BrandedFare[]
  /**
   * Muestra el índice del vuelo en el objeto `flightIndices`.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  breakFareFlightIndices?: number[]
  /**
   * Cotiza la reserva incorporando un código de cabina específico. Solo se puede combinar con `bargainFinderRebook`.
   *
   * example: YB
   * pattern: ^[A-Z]{2}$
   */
  cabinCode?: string
  /**
   * El monto de la comisión a reclamar. No se puede combinar con `commissionPercentage`.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 30.00
   */
  commissionAmount?: string
  /**
   * Enumera los contratos de comisión para procesar en el momento de fijar el precio.
   *
   * minItems: 1
   * maxItems: 4
   */
  /**
   * El contrato de comisión a procesar en el momento de fijar el precio.
   *
   * example: WHOLESALERCONTRACT01
   */
  commissionContractNames?: string[]
  /**
   * El porcentaje de comisión que se reclamará. No se puede combinar con `commissionAmount`.
   *
   * pattern: ^[0-9]{1,2}(\.[0-9]{1,2})?$
   * example: 10.00
   */
  commissionPercentage?: string
  /**
   * Contiene información para tarificar la reserva incorporando tarifas corporativas.
   */
  corporateFare?: CorporateFare
  /**
   * Cotiza la reserva incorporando un código de moneda específico.
   *
   * example: PLN
   * pattern: ^[A-Z]{3}$
   */
  currencyPricing?: string
  /**
   * Contiene información que agrega el contenido del texto de respaldo del boleto almacenado durante la fijación de precios.
   */
  endorsements?: Endorsements
  /**
   * Contiene información sobre sanciones aplicadas a reglas de tarifas específicas.
   */
  exchangePenalties?: PenaltyRestriction
  /**
   * Enumera los códigos de reserva de tarifas económicas básicas que se excluirán.
   *
   * minItems: 1
   * maxItems: 5
   */
  /**
   * El código de reserva de tarifa económica básica que se excluirá.
   *
   * pattern: ^[A-Z]{1,2}$
   * example: O
   */
  excludeBasicEconomyFares?: string[]
  /**
   * Enumera los códigos impositivos que se excluirán.
   *
   * minItems: 1
   * maxItems: 99
   */
  /**
   * El código tributario que se excluirá.
   *
   * pattern: ^[A-Z]{1,2}$
   * example: UB
   */
  exemptTaxes?: string[]
  /**
   * Si es "verdadero", el sistema excluirá las tarifas Fare Focus durante la fijación de precios.
   *
   * example: False
   */
  excludeFareFocusFares?: boolean
  /**
   * Si es "verdadero", el sistema fijará el precio de la reserva con una tarifa de excursión.
   *
   * example: False
   */
  useExcursionFare?: boolean
  /**
   * Muestra el índice del vuelo en el objeto `flightIndices`.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  forceConnectionFlightIndices?: number[]
  /**
   * Muestra el índice del vuelo en el objeto `flightIndices`.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  forceStopoverFlightIndices?: number[]
  /**
   * El código del hemisferio. Utilizado por agencias en Canadá/Bermuda.
   *
   * format: int32
   * example: 1
   * minimum: 0
   * maximum: 9
   */
  hemisphereCode?: number
  /**
   * El código de viaje. Utilizado por agencias en Canadá/Bermuda.
   *
   * format: int32
   * minimum: 0
   * maximum: 9
   * example: 1
   */
  journeyCode?: number
  /**
   * Si es "verdadero", el sistema considerará soluciones de boletos múltiples para encontrar el precio más bajo.
   *
   * example: False
   */
  considerMultiTicket?: boolean
  /**
   * Índice del viajero dentro de la lista de `viajeros`.
   */
  /**
   * Índice del viajero.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndices?: number[]
  /**
   * Si es "verdadero", el sistema fijará el precio de la reserva con una tarifa neta.
   *
   * example: False
   */
  useNetFare?: boolean
  /**
   * Contiene calificadores de precios de Automated Net Remit.
   */
  netRemit?: NetRemit
  /**
   * Si es "falso", el sistema fijará el precio de la reserva sin impuestos.
   *
   * example: False
   * default: True
   */
  priceWithTaxes?: boolean
  /**
   * Contiene el código impositivo y su importe.
   *
   * minItems: 1
   * maxItems: 99
   */
  /**
   * Contiene los códigos de impuestos deseados y sus montos anulados.
   */
  overrideTaxes?: Tax[]
  /**
   * Identifica el código de estado del pasajero.
   */
  passengerStatus?: PassengerStatusEnum
  /**
   * El código de país del estado del pasajero. Debe combinarse con `passengerStatus`.
   *
   * pattern: ^[A-Z]{2}$
   * example: US
   */
  passengerStatusCountryCode?: string
  /**
   * Le permite seleccionar un máximo de dos formas de pago de la lista `formsOfPayment`. Se permiten múltiples formas de pago solo si su ubicación depende del BSP y/o el país del punto de venta no impide el uso de dos tarjetas de crédito como forma de pago.
   */
  payment?: PaymentMethod
  /**
   * Si es "verdadero", el sistema fijará el precio de la reserva con una tarifa privada.
   *
   * example: False
   */
  usePrivateFare?: boolean
  /**
   * Si es "verdadero", el sistema fijará el precio de la reserva con una tarifa pública.
   *
   * example: False
   */
  usePublicFare?: boolean
  /**
   * Fija el precio de la reserva incorporando tarifas vinculadas a un código de regla de minorista específico.
   */
  retailerRule?: RetailerRule
  /**
   * Si es "verdadero", el sistema fijará el precio de la reserva incorporando una tarifa de viaje circular o alrededor del mundo.
   *
   * example: False
   */
  useRoundTheWorldFare?: boolean
  /**
   * Muestra el índice del vuelo en el objeto `flightIndices`.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  sideTripFlightIndices?: number[]
  /**
   * Contiene un código de base de tarifa deseada con validación automática completa de precios.
   *
   * minItems: 1
   * maxItems: 16
   */
  /**
   * Contiene un código de base de tarifa deseada con validación automática completa de precios.
   */
  specificFares?: SpecificFare[]
  /**
   * El nivel de descuento de las familias numerosas españolas.
   *
   * format: int32
   * minimum: 1
   * maximum: 2
   * example: 1
   */
  spanishLargeFamilyDiscountLevel?: number
  /**
   * El código de residente de la isla aplicable para el descuento.
   *
   * example: MLN
   */
  spanishIslandResidentDiscountCode?: string
  /**
   * El código de viaje que se agregará a la operación de fijación de precios.
   *
   * pattern: ^[A-Z0-9]{1,15}$
   * example: TEST1212
   */
  tourCode?: string
  /**
   * Debe combinarse con `tourCode`. Identifica las opciones que se imprimirán en el billete final. `REPLACE_WITH_BT`: suprimirá el importe de la tarifa y lo reemplazará con `BT`. `REPLACE_WITH_IT`: suprimirá el importe de la tarifa y lo reemplazará con `IT`. `SUPPRESS_IT` suprimirá `IT`. `SUPPRESS_IT_AND_FARE` suprimirá `IT` así como el importe de la tarifa.
   */
  tourCodeOverrides?: TourCodeOverridesOptionEnum
  /**
   * Muestra los precios de reserva según el tipo de viajero y la cantidad de viajeros.
   *
   * minItems: 1
   * maxItems: 16
   */
  /**
   * Contiene el "passengerCode" deseado y la cantidad utilizada para fijar el precio.
   */
  passengersPricing?: PassengerPricing[]
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea de validación deseada.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  validatingAirlineCode?: string
  /**
   * El método de liquidación que anulará el método predeterminado del país.
   *
   * example: TCH
   */
  settlementMethod?: string
}
/**
 * Permite tarificar la reserva incorporando códigos de cuenta.
 */
interface AccountCode {
  /**
   * Si es "verdadero", el sistema forzará la fijación de precios con los códigos de cuenta deseados.
   *
   * example: False
   */
  forceAccountCodes?: boolean
  /**
   * Lista de códigos de cuenta.
   *
   * minItems: 1
   * maxItems: 4
   */
  /**
   * El código de cuenta.
   *
   * example: ABC123
   */
  accountCodes: string[]
}
/**
 * Contiene calificadores de precios de nivel de venta ajustado.
 */
interface AdjustedSellingLevel {
  /**
   * Si es "verdadero", el sistema fijará el precio de la reserva y proporcionará un desglose de los importes del nivel de venta ajustado.
   *
   * example: False
   */
  returnBreakdown?: boolean
  /**
   * Si es "verdadero", el sistema fijará el precio de la reserva e ignorará el procesamiento del nivel de venta ajustado.
   *
   * example: False
   */
  ignore?: boolean
  /**
   * El monto del margen de beneficio aplicado al momento de fijar el precio que creará una tarifa de nivel de venta ajustada manualmente. No se puede combinar con `markDownAmount`.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 30.00
   */
  markUpAmount?: string
  /**
   * El monto de descuento aplicado al momento de fijar el precio que creará una tarifa de nivel de venta ajustada manualmente. No se puede combinar con `markUpAmount`.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 30.00
   */
  markDownAmount?: string
}
/**
 * Contiene información sobre franquicia de equipaje (ya sea su peso o el número de piezas).
 */
interface BookBaggageAllowance {
  /**
   * El peso de la pieza de equipaje medido en kilogramos [kg].
   *
   * format: int32
   * example: 23
   * minimum: 1
   * maximum: 99
   */
  totalWeightInKilograms?: number
  /**
   * Número de piezas de equipaje.
   *
   * format: int32
   * example: 1
   * minimum: 1
   */
  baggagePieces?: number
  /**
   * Enumera los índices de vuelos dentro de una reserva.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  flightIndices?: number[]
}
/**
 * Contiene un código de marca deseado que se utilizará para fijar el precio de la reserva.
 */
interface BrandedFare {
  /**
   * El código de marca deseado.
   *
   * example: CP
   */
  brandCode: string
  /**
   * Enumera los índices de vuelos dentro de una reserva.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  flightIndices?: number[]
}
/**
 * Contiene información para tarificar la reserva incorporando tarifas corporativas.
 */
interface CorporateFare {
  /**
   * Si es "verdadero", el sistema obligará a fijar precios con tarifas corporativas.
   *
   * example: False
   */
  forceCorporateId?: boolean
  /**
   * Lista de identificaciones corporativas.
   *
   * minItems: 1
   * maxItems: 4
   */
  /**
   * El DNI Corporativo.
   *
   * example: ABC12
   * pattern: ^[A-Za-z]{3}[0-9]{2}$
   */
  corporateIds: string[]
}
/**
 * Contiene información que agrega el contenido del texto de respaldo del boleto almacenado durante la fijación de precios.
 */
interface Endorsements {
  /**
   * El texto original del campo de endosos.
   *
   * example: REF AGY ONLY
   */
  description?: string
  /**
   * Si es verdadero, anule todos los endosos preprogramados para imprimir los endosos especiales requeridos de la tarifa.
   *
   * example: True
   */
  useOverride?: boolean
}
/**
 * Identifica el tipo de restricción de tarifa.
 *
 * example: CHANGEABLE
 */
const FARE_RULES_RESTRICTION = {
  CHANGEABLE: "CHANGEABLE",
  REFUNDABLE: "REFUNDABLE",
  CHANGEABLE_AND_REFUNDABLE: "CHANGEABLE_AND_REFUNDABLE",
} as const
type FareRuleRestrictionEnum = keyof typeof FARE_RULES_RESTRICTION 
/**
 * Identifica el tipo de aplicabilidad asociado con una penalización de regla tarifaria particular.
 *
 * example: BEFORE_DEPARTURE
 */
const FARE_RULE_PENALTY_APPLICABILITY = {
  BEFORE_DEPARTURE: "BEFORE_DEPARTURE",
  AFTER_DEPARTURE: "AFTER_DEPARTURE",
} as const
type FareRulePenaltyApplicabilityEnum = keyof typeof FARE_RULE_PENALTY_APPLICABILITY
/**
 * Contiene información sobre sanciones aplicadas a reglas de tarifas específicas.
 */
interface PenaltyRestriction {
  /**
   * Identifica el tipo de restricción de tarifa.
   */
  restrictionType: FareRuleRestrictionEnum
  /**
   * Identifica si se aplica una penalización antes o después de la salida.
   */
  applicability?: FareRulePenaltyApplicabilityEnum
  /**
   * Contiene información sobre el monto de la multa.
   */
  penaltyAmount?: PenaltyRestrictionAmount
}
interface PenaltyRestrictionAmount {
  /**
   * El monto de la multa.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 100
   */
  amount?: string
}
/**
 * Contiene calificadores de precios de Automated Net Remit. Net Remit se utiliza para organizar el pago de una comisión adicional que supera la comisión estándar. Esta comisión adicional la paga el transportista validador a través de informes BSP.
 */
interface NetRemit {
  /**
   * El código de valor utilizado para ingresar el Net Remit manual.
   *
   * example: ABCD123
   */
  netRemitCode?: string
  /**
   * El código de referencia utilizado para indicar el contrato comercial Net Remit.
   *
   * example: DEF456
   */
  commercialAgreementReferenceCode?: string
  /**
   * El valor monetario neto en efectivo de las remesas. Cuando se establece el código de moneda, el monto no puede ser decimal.
   */
  cashValue?: Value
  /**
   * El valor del crédito de remesa neto monetario. Cuando se establece el código de moneda, el monto no puede ser decimal.
   */
  creditValue?: Value
}
/**
 * Le permite seleccionar un máximo de dos formas de pago de la lista `formsOfPayment`. Se permiten múltiples formas de pago solo si su ubicación depende del BSP y/o el país del punto de venta no impide el uso de dos tarjetas de crédito como forma de pago.
 */
interface PaymentMethod {
  /**
   * Índice del tipo de pago en la lista `formsOfPayment`.
   *
   * format: int32
   * minimum: 1
   * maximum: 11
   * example: 1
   */
  primaryFormOfPayment: number
  /**
   * Índice del tipo de pago en la lista `formsOfPayment`.
   *
   * format: int32
   * minimum: 1
   * maximum: 11
   * example: 2
   */
  secondaryFormOfPayment?: number
  /**
   * El monto de la tarifa base deseada que se debe cobrar en la segunda forma de pago. Aplicable únicamente si se eligieron dos formas de pago.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 100.00
   */
  amountOnSecondFormOfPayment?: string
}
/**
 * Contiene campos calificadores que permiten fijar el precio de una reserva incorporando tarifas vinculadas a un código de regla de minorista específico.
 */
interface RetailerRule {
  /**
   * Si es "verdadero", el sistema impondrá tarifas con una regla comercial coincidente aplicable a un solo calificador. Se puede combinar con un único "calificador".
   *
   * example: False
   */
  forceQualifiers?: boolean
  /**
   * La lista de calificadores de reglas de minoristas.
   *
   * minItems: 1
   * maxItems: 4
   */
  /**
   * El calificador de reglas para minoristas.
   *
   * example: RETAILERQUALIFER
   */
  qualifiers: string[]
}
/**
 * Contiene un código de base de tarifa deseada con validación automática completa de precios.
 */
interface SpecificFare {
  /**
   * El código de base de tarifa deseado.
   *
   * example: ABCDE
   */
  fareBasisCode: string
  /**
   * Enumera los índices de vuelos dentro de una reserva.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  flightIndices?: number[]
}
/**
 * Contiene un "passengerCode" deseado y la cantidad utilizada para fijar el precio.
 */
interface PassengerPricing {
  /**
   * Identifica el tipo (edad) del viajero. Para reservar un vuelo que incluya pasajeros infantiles, pase `INF`. Pase "INY" para indicar un bebé sin asiento asignado, o pase "INS" para indicar un bebé con asiento.
   *
   * pattern: ^[A-Z][A-Z0-9]{2}$
   * example: ADT
   */
  passengerCode?: string
  /**
   * Si es "verdadero", el sistema fijará el precio de la reserva en función del "código de pasajero" deseado.
   *
   * example: False
   */
  forcePassengerCode?: boolean
  /**
   * Identifica el número de viajeros con el `passengerCode` deseado.
   *
   * format: int32
   * example: 2
   */
  numberOfpassengers?: number
}
