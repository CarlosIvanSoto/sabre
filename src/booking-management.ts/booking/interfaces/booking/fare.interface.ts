import { TotalValues } from "../../../common/interfaces";
import { BaggageAllowance, Commission, CreationDetails, FlightReference, Value } from "../../common/interfaces"
/**
 * Identifica el código de tipo de precio de una tarifa.
 *
 * example: S
 */
const PRICING_TYPE_CODE = {
  S: "S",
  A: "A",
  M: "M",
} as const
type PricingTypeCodeEnum = keyof typeof PRICING_TYPE_CODE
/**
 * El tipo de fijación de precios de una tarifa.
 *
 * example: Manual
 */
const PRICING_TYPE_NAME = {
  System: "System",
  Amended: "Amended",
  Manual: "Manual",
  Unknown: "Unknown",
} as const
type PricingTypeNameEnum = keyof typeof PRICING_TYPE_NAME
/**
 * El estado de una tarifa.
 *
 * example: A
 */
const PRICING_STATUS_CODE = {
  A: "A",
  H: "H",
} as const
type PricingStatusCodeEnum = keyof typeof PRICING_STATUS_CODE
/**
 * El estado de una tarifa.
 *
 * example: Active
 */
const PRICING_STATUS_NAME = {
  Active: "Active",
  History: "History",
} as const
type PricingStatusNameEnum = keyof typeof PRICING_STATUS_NAME
/**
 * Contiene detalles de construcción de una tarifa específica.
 */
export interface Fare {
  /**
   * Contiene detalles sobre la creación.
   */
  creationDetails?: CreationDetails
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea que validó la tarifa.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  airlineCode?: string
  /**
   * Información de construcción de tarifas codificada. No compatible con NDC.
   *
   * example: BUE AA DFW Q430.00 5740.00NUC6170.00END ROE1.00 XT175.50TQ175.50QO315.90US96.50YC122.90XY69.50XA
   */
  fareCalculationLine?: string
  /**
   * El código de viaje que se aplicó para fijar el precio de la tarifa.
   *
   * pattern: ^[A-Z0-9]{1,15}$
   * example: 123456789ABCDE
   */
  tourCode?: string
  /**
   * Si es "verdadero", se negocia la tarifa utilizada para fijar el precio. Si es "falso", la tarifa utilizada para fijar el precio es pública.
   *
   * example: True
   */
  isNegotiatedFare?: boolean
  /**
   * Indica a qué viajeros de la lista `viajeros` pertenece la tarifa. Si la tarifa es aplicable a todos los viajeros, no se proporciona esta lista.
   */
  /**
   * El índice del viajero.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndices?: number[]
  /**
   * Contiene detalles de la comisión aplicable a la tarifa.
   */
  commission?: Commission
  /**
   * Enumera los componentes utilizados para construir la tarifa.
   */
  fareConstruction?: FareComponent[]
  /**
   * Enumera los impuestos aplicados a la tarifa.
   */
  taxBreakdown?: TaxComponent[]
  /**
   * Contiene información de pago del servicio.
   */
  totals?: TotalValues
  /**
   * El código de tipo de una letra utilizado por el sistema Sabre que indica cómo se tarificó la tarifa. No aplicable para NDC.
   */
  pricingTypeCode?: PricingTypeCodeEnum
  /**
   * El valor significativo que describe cómo se tarificó la tarifa.
   */
  pricingTypeName?: PricingTypeNameEnum
  /**
   * El código de tipo de una letra utilizado por el sistema Sabre que indica el estado de la tarifa. No aplicable para NDC.
   */
  pricingStatusCode?: PricingStatusCodeEnum
  /**
   * El valor significativo que describe el estado de una tarifa.
   */
  pricingStatusName?: PricingStatusNameEnum
  /**
   * El código de tipo del viajero solicitado al fijar el precio de la tarifa.
   *
   * pattern: ^[A-Z][A-Z0-9]{2}$
   * example: C08
   */
  requestedTravelerType?: string
  /**
   * El código de tipo del viajero solicitado al fijar el precio de la tarifa.
   *
   * pattern: ^[A-Z][A-Z0-9]{2}$
   * example: C08
   */
  pricedTravelerType?: string
  /**
   * El código que describe el origen de la tarifa.
   *
   * pattern: ^[A-Z]{2,3}$
   * example: PQ
   */
  recordTypeCode?: string
  /**
   * El nombre que describe la fuente de la tarifa.
   *
   * example: Price Quote
   */
  recordTypeName?: string
  /**
   * La identificación de una fuente determinada de la tarifa.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 12
   */
  recordId?: string
}
/**
 * Contiene detalles de un componente de tarifa específico.
 */
interface FareComponent {
  /**
   * Enumera los vuelos a los que hace referencia el vuelo "itemId". Se pueden devolver múltiples ID de vuelo para un solo componente de tarifa. Si el componente de tarifa está asociado con todos los vuelos o se utilizó un itinerario de vuelo diferente para crear este componente de tarifa (verifique la propiedad "isCurrentItinerary"), no se proporciona esta lista.
   */
  flights?: FlightReference[]
  /**
   * Enumera los índices de vuelos dentro del itinerario actual. Si el componente de la tarifa está asociado con todos los vuelos, no se proporciona esta lista. Esta propiedad quedará obsoleta en la futura versión principal de esta API. Si desea verificar la asociación de vuelos, use la propiedad `vuelos` dentro del objeto `FareComponent`.
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
   * Código de base de tarifa utilizado para la construcción de la tarifa.
   *
   * example: ABCDE10
   */
  fareBasisCode?: string
  /**
   * Contiene el importe de la tarifa base.
   */
  baseRate?: Value
  /**
   * El código de la Tarifa de Marca.
   *
   * example: ECOFLEX
   */
  brandFareCode?: string
  /**
   * El nombre de la tarifa de marca.
   *
   * example: ECO FLEX
   */
  brandFareName?: string
  /**
   * El código del programa al que pertenece la Branded Fare.
   *
   * example: CFFLH
   */
  brandProgramCode?: string
  /**
   * El nombre del programa al que pertenece la Branded Fare.
   *
   * example: LH BRANDED FARES INTERCONT
   */
  brandProgramName?: string
  /**
   * Enumera los atributos de tarifa de marca (clase de precio) de las ofertas de NDC.
   */
  /**
   * Contiene un atributo de tarifa de marca.
   */
  brandAttributes?: BrandAttribute[]
  /**
   * Si es verdadero, el componente de tarifa se creó para el vuelo presente en el itinerario actual. Si es falso, el componente de la tarifa se refiere a un vuelo que ya no forma parte del itinerario actual. Este puede ser el caso, por ejemplo, después de cambios de horario.
   *
   * example: False
   */
  isCurrentItinerary?: boolean
  /**
   * Indica el equipaje facturado permitido incluido en la tarifa.
   */
  checkedBaggageAllowance?: BaggageAllowance
}
/**
 * Contiene un atributo de tarifa de marca.
 */
interface BrandAttribute {
  /**
   * El ID de un atributo de Branded Fare determinado.
   *
   * example: SABRE_NDCC_ID_1
   */
  itemId?: string
  /**
   * Información de marketing sobre el producto.
   *
   * example: Qantas Points
   */
  description?: string
}
/**
 * Contiene detalles para un solo impuesto.
 */
interface TaxComponent {
  /**
   * El código fiscal deseado. Debe combinarse con "importeimpuesto".
   *
   * example: XY
   */
  taxCode?: string
  /**
   * Contiene el importe del impuesto.
   */
  taxAmount?: Value
}
