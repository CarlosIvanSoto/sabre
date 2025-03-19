import { TotalValues } from "../../../common/interfaces";
import { StatusNameEnum, TrainReference } from "../../common/interfaces";
/**
 * Contiene información de reserva de tren, identificada por "itemId", para la reserva dada.
 */
export interface Train extends TrainReference, TrainItem {}

/**
 * Contiene información del tren para la reserva dada.
 */
type TrainItem = {
  /**
   * El número de reserva del tren.
   *
   * pattern: ^[A-Z0-9-]{6,}$
   * example: 76E220
   */
  confirmationId?: string
  /**
   * El número de tren asociado con la empresa ferroviaria comercializadora.
   *
   * pattern: ^[A-Z0-9]{1,}[ -]?[A-Z0-9]{1,}$
   * example: 822
   */
  trainNumber: string
  /**
   * El nombre del tren asociado con la empresa ferroviaria comercializadora.
   *
   * example: Heartland Flyer
   */
  trainName?: string
  /**
   * El código de designación IATA de dos letras de la empresa ferroviaria comercializadora.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: 2V
   */
  vendorCode: string
  /**
   * El nombre de la empresa ferroviaria comercializadora.
   *
   * example: Amtrak
   */
  vendorName?: string
  /**
   * El código designador IATA de dos letras de la compañía ferroviaria operativa.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: 2V
   */
  operatingVendorCode?: string
  /**
   * El nombre de la empresa ferroviaria operadora.
   *
   * example: Amtrak
   */
  operatingVendorName?: string
  /**
   * El código de estación de tren de origen del sistema de codificación de estaciones de la empresa ferroviaria comercializadora.
   *
   * pattern: ^[A-Z0-9]{2,}$
   * example: FTW
   */
  fromStationCode: string
  /**
   * El nombre de la estación de tren de la estación de origen.
   *
   * example: Central Station
   */
  fromStationName?: string
  /**
   * El código de la estación de tren de destino del sistema de codificación de estaciones de la empresa ferroviaria comercializadora.
   *
   * pattern: ^[A-Z0-9]{2,}$
   * example: ATL
   */
  toStationCode: string
  /**
   * El nombre de la estación de tren de la estación de destino.
   *
   * example: Peachtree Station
   */
  toStationName?: string
  /**
   * La fecha de salida programada en formato `AAAA-MM-DD` en la zona horaria de la estación de tren.
   *
   * format: date
   * example: 2019-07-10
   */
  departureDate: string
  /**
   * La hora de salida programada en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 19:15
   */
  departureTime: string
  /**
   * La fecha de llegada programada en formato `AAAA-MM-DD` en la zona horaria de la estación de tren.
   *
   * format: date
   * example: 2019-07-10
   */
  arrivalDate: string
  /**
   * La hora de llegada programada en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 23:10
   */
  arrivalTime: string
  /**
   * De ser cierto, se podrá reembolsar la reserva del tren en su totalidad.
   *
   * example: True
   */
  isRefundable?: boolean
  /**
   * El código de estado de una o dos letras utilizado por los proveedores. Indica el estado de la reserva del tren.
   *
   * pattern: ^[A-Z]{1,2}$
   * example: HK
   */
  trainStatusCode?: string
  /**
   * El valor significativo que describe el estado de la reserva del tren.
   */
  trainStatusName?: StatusNameEnum
  /**
   * Contiene información de pago del servicio.
   */
  payment?: TotalValues
}