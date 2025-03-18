import { FlightReference, StatusNameEnum } from "../../common/interfaces"
/**
 * Identifica el tipo de origen del vuelo.
 *
 * example: NDC
 */
const FLIGHT_SOURCE =  {
  ATPCO: "ATPCO",
  LCC: "LCC",
  NDC: "NDC",
} as const

type FlightSourceEnum = keyof typeof FLIGHT_SOURCE
/**
 * Contiene información de vuelo, identificada por "itemId", para la reserva dada.
 */
export interface Flight extends FlightReference, FlightItem {}
/**
 * Contiene información de vuelo para la reserva dada.
 */
interface FlightItem {
  /**
   * El ID de referencia de la reserva en el sistema del transportista. 
   * Por ejemplo, este valor reflejaría el localizador de PNR de American Airlines.
   *
   * pattern: ^[A-Z0-9]{5,}$
   * example: NIEBNY
   */
  confirmationId?: string
  /**
   * Identifica el tipo aplicable de fuente de reserva de vuelo.
   */
  sourceType?: FlightSourceEnum
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
   * El nombre de la aerolínea comercializadora.
   *
   * example: AMERICAN AIRLINES
   */
  airlineName?: string
  /**
   * El número de vuelo asociado con la aerolínea operadora.
   *
   * format: int32
   * minimum: 1
   * maximum: 9999
   * example: 321
   */
  operatingFlightNumber?: number
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea operadora.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: UA
   */
  operatingAirlineCode?: string
  /**
   * El nombre de la aerolínea operadora.
   *
   * example: UNITED AIRLINES
   */
  operatingAirlineName?: string
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
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:15
   */
  departureTime: string
  /**
   * La fecha de salida estimada (antes de la salida) o real en formato "AAAA-MM-DD" en la zona horaria del aeropuerto.
   *
   * format: date
   * example: 2019-07-09
   */
  updatedDepartureDate?: string
  /**
   * La hora de salida estimada (antes de la salida) o real en formato "HH:MM".
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:25
   */
  updatedDepartureTime?: string
  /**
   * El nombre de la terminal de salida.
   *
   * example: Terminal D
   */
  departureTerminalName?: string
  /**
   * El número de la puerta de salida.
   *
   * example: D
   */
  departureGate?: string
  /**
   * La fecha de llegada programada en formato `AAAA-MM-DD` en la zona horaria del aeropuerto.
   *
   * format: date
   * example: 2019-07-09
   */
  arrivalDate: string
  /**
   * La hora de llegada programada en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 12:28
   */
  arrivalTime: string
  /**
   * La fecha de llegada estimada (antes de la llegada) o real en formato "AAAA-MM-DD" en la zona horaria del aeropuerto.
   *
   * format: date
   * example: 2019-07-09
   */
  updatedArrivalDate?: string
  /**
   * La hora de llegada estimada (antes de la llegada) o real en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 12:38
   */
  updatedArrivalTime?: string
  /**
   * El nombre de la terminal de llegada.
   *
   * example: Terminal 1
   */
  arrivalTerminalName?: string
  /**
   * El número de la puerta de llegada.
   *
   * example: 1
   */
  arrivalGate?: string
  /**
   * Enumera los números de asiento asignados al viajero correspondiente haciendo coincidir el índice en la colección "viajeros". Consulte la propiedad `travelerIndices` para verificar la asociación de viajeros. Un objeto "Asiento" vacío significa que el viajero correspondiente no tiene un asiento asignado.
   */
  /**
   * Contiene información detallada sobre el asiento.
   */
  seats?: Seat[]
  /**
   * La cantidad de asientos ocupados por los viajeros. Los detalles específicos de los asientos, si corresponde, se enumeran en la lista de "asientos".
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  numberOfSeats?: number
  /**
   * El tipo de cabina del avión. El nombre utilizado es específico de la convención de nomenclatura de la aerolínea.
   *
   * pattern: ^[A-Za-z ]+$
   * example: Coach
   */
  cabinTypeName?: string
  /**
   * El código de tipo de cabina.
   *
   * pattern: ^[A-Z]$
   * example: C
   */
  cabinTypeCode?: string
  /**
   * El código designador de tipo de aeronave IATA.
   *
   * pattern: ^[A-Z0-9]{2,3}$
   * example: E90
   */
  aircraftTypeCode?: string
  /**
   * El nombre y modelo que corresponde al código o códigos de equipo de aeronave especificados.
   *
   * example: EMBRAER EMB E90
   */
  aircraftTypeName?: string
  /**
   * El código de inventario de reserva de la aerolínea comercializadora.
   *
   * pattern: ^[A-Z]$
   * example: Y
   */
  bookingClass?: string
  /**
   * Enumera las opciones de comida proporcionadas en el vuelo.
   */
  /**
   * Contiene las opciones de comidas proporcionadas en el vuelo.
   */
  meals?: Meal[]
  /**
   * El código de estado de dos letras utilizado por los proveedores. Indica el estado de la reserva.
   *
   * pattern: ^[A-Z]{2}$
   * example: AF
   */
  flightStatusCode?: string
  /**
   * El valor significativo que describe el estado de la reserva.
   */
  flightStatusName?: StatusNameEnum
  /**
   * La duración del vuelo en minutos.
   *
   * minimum: 1
   * example: 590
   */
  durationInMinutes?: number
  /**
   * La distancia de vuelo en millas.
   *
   * minimum: 1
   * example: 5143
   */
  distanceInMiles?: number
  /**
   * El código designador de tipo de aeronave IATA. Esta propiedad no se devuelve cuando el tipo de aeronave no cambia.
   *
   * pattern: ^[A-Z0-9]{2,3}$
   * example: E90
   */
  hiddenStopAircraftTypeCode?: string
  /**
   * El nombre y modelo que corresponde al código o códigos de equipo de aeronave especificados. Esta propiedad no se devuelve cuando el tipo de aeronave no cambia.
   *
   * example: EMBRAER EMB E90
   */
  hiddenStopAircraftTypeName?: string
  /**
   * El código de aeropuerto IATA de tres letras del aeropuerto con parada oculta.
   *
   * pattern: ^[A-Z]{3}$
   * example: HAV
   */
  hiddenStopAirportCode?: string
  /**
   * La fecha de llegada al aeropuerto con parada oculta en formato `AAAA-MM-DD` en la zona horaria del aeropuerto.
   *
   * format: date
   * example: 2019-07-09
   */
  hiddenStopArrivalDate?: string
  /**
   * La hora de llegada al aeropuerto con parada oculta en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:15
   */
  hiddenStopArrivalTime?: string
  /**
   * La fecha de salida del aeropuerto con parada oculta en formato "AAAA-MM-DD" en la zona horaria del aeropuerto.
   *
   * format: date
   * example: 2019-07-09
   */
  hiddenStopDepartureDate?: string
  /**
   * La hora de salida del aeropuerto con parada oculta en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:15
   */
  hiddenStopDepartureTime?: string
  /**
   * Enumera los viajeros dentro de la lista de "viajeros". Indica qué viajeros están asociados con un vuelo en particular.
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
   * Enumera los documentos de identidad asignados con estados para cada vuelo.
   */
  identityDocuments?: IdentityDocumentReference[]
  /**
   * Si es cierto, el vuelo actual está vencido.
   *
   * example: False
   */
  isPast?: boolean
}
/**
 * Contiene información detallada sobre el asiento.
 */
type Seat = {
  /**
   * Número de asiento asignado al viajero.
   *
   * pattern: ^[0-9]+[A-Z]$
   * example: 13A
   */
  number: string
  /**
   * Enumera todos los códigos de características definidos por IATA asociados con el asiento. Para obtener la lista de todos los códigos, consulte el siguiente recurso: elemento 9825 del conjunto de códigos IATA PADIS.
   */
  /**
   * El código de característica del asiento definido por IATA.
   *
   * pattern: ^[A-Z0-9]{1,2}$
   * example: K
   */
  characteristics?: string[]
  /**
   * El código de estado de dos letras utilizado por los proveedores. Indica el estado del asiento.
   *
   * pattern: ^[A-Z]{2}$
   * example: AF
   */
  statusCode?: string
  /**
   * El valor significativo que describe el estado del asiento.
   */
  statusName?: StatusNameEnum
}
/**
 * Identifica la comida proporcionada en el vuelo, coincidiendo según el código de tipo de comida.
 *
 * example: Hot meal
 */
enum MealDescriptionEnum {
  'Alcoholic beverages for purchase',
  Breakfast,
  'Cold meal',
  'Complimentary alcoholic beverages',
  'Continental breakfast',
  Dinner,
  'Food for purchase',
  'Food and beverage for purchase',
  'Hot meal',
  Lunch,
  Meal,
  'No meal service',
  Refreshment,
  'Refreshment for purchase',
  Snack
}
/**
 * Contiene las opciones de comidas proporcionadas en el vuelo.
 */
interface Meal {
  /**
   * El código del tipo de comida. Los códigos de tipo de comida disponibles son `P`, `B`, `O`, `C`, `K`, `D`, `F`, `G`, `H`, `L`, `M`, ` N`, `R`, `V` y `S`.
   *
   * pattern: ^[A-Z]$
   * example: H
   */
  code: string
  /**
   * La descripción de la comida correspondiente al código de tipo de comida.
   */
  description: MealDescriptionEnum
}

interface IdentityDocumentReference {
  /**
   * El identificador único del documento.
   *
   * example: 76c2817b178cc264fa44cf85df1da5fb9e1b963006b2339aa5edc09129415bba5fcf5bf91a5f3031
   */
  itemId?: string
  /**
   * Estado del documento de identidad del vuelo en cuestión. No aplicable para NDC.
   */
  status?: StatusNameEnum
}