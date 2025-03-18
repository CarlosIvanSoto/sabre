import { GenericAddress } from "../../common/interfaces"
/**
 * Contiene información esencial que es común para todos los tipos posibles de segmentos de reserva.
 */
export interface SegmentBasics extends SegmentReference, SegmentBasicAttributes {}
/**
 * Contiene el ID único del segmento.
 */
interface SegmentReference {
  /**
   * El ID único del segmento que puede corresponder al itemId de un elemento de reserva, como vuelo, hotel, automóvil, etc.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 12
   */
  id: string
}
/**
 * Contiene atributos básicos comunes para todos los tipos posibles de segmentos de reserva. Los atributos proporcionados solo son relevantes para el tipo de segmento.
 */
interface SegmentBasicAttributes {
  /**
   * El tipo de segmento de reserva.
   *
   * pattern: ^[A-Z_]+$
   * example: FLIGHT
   */
  type: string
  /**
   * El nombre o descripción del segmento, como el número de vuelo del segmento que representa un vuelo.
   *
   * example: 123
   */
  text?: string
  /**
   * El código de proveedor correspondiente, como el código de operador para un segmento de tipo "VUELO" o el código de proveedor de hotel para un segmento de tipo "HOTEL".
   *
   * pattern: ^[A-Z0-9]+$
   * example: AA
   */
  vendorCode?: string
  /**
   * La fecha del evento representada por el segmento en formato "AAAA-MM-DD" en la zona horaria local del evento. Este atributo no existe para un evento que dura muchos días.
   *
   * format: date
   * example: 2019-07-09
   */
  date?: string
  /**
   * La hora del evento representada por el segmento en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:15
   */
  time?: string
  /**
   * El código de la ubicación del evento representado por el segmento. Este atributo no existe para un evento con ubicaciones de inicio y finalización.
   *
   * pattern: ^[A-Z0-9]+$
   * example: ATL
   */
  locationCode?: string
  /**
   * La dirección del evento representado por el segmento, como la dirección del hotel para un segmento de tipo "HOTEL". Este atributo no existe para un evento con direcciones de inicio y fin.
   */
  address?: GenericAddress
  /**
   * La fecha de inicio del evento representada por el segmento en formato "AAAA-MM-DD" en la zona horaria local del evento. Este atributo no existe para un evento de un solo día.
   *
   * format: date
   * example: 2019-07-09
   */
  startDate?: string
  /**
   * La hora de inicio del evento representada por el segmento en formato "HH:MM".
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:15
   */
  startTime?: string
  /**
   * El código de la ubicación de inicio del evento representado por el segmento, como el código del aeropuerto de origen para un segmento de tipo "VUELO". Este atributo no existe para un evento de ubicación única, como un viaje en crucero.
   *
   * pattern: ^[A-Z0-9]+$
   * example: DFW
   */
  startLocationCode?: string
  /**
   * La dirección de inicio del evento para el segmento que representa un evento de tipo de transporte, como la dirección de recogida de una reserva de automóvil. Este atributo no existe para un evento estacionario, como una reserva de hotel.
   */
  startAddress?: GenericAddress
  /**
   * La fecha de finalización del evento representada por el segmento en formato "AAAA-MM-DD" en la zona horaria local del evento. Este atributo no existe para un evento de un solo día, como un tour de un día.
   *
   * format: date
   * example: 2019-07-09
   */
  endDate?: string
  /**
   * La hora de finalización del evento representada por el segmento en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 12:28
   */
  endTime?: string
  /**
   * El código de la ubicación final del evento representado por el segmento, como el código del aeropuerto de destino para un segmento de tipo "VUELO". Este atributo no existe para un evento de tipo de ubicación única, como una reserva de hotel o crucero.
   *
   * pattern: ^[A-Z0-9]+$
   * example: HNL
   */
  endLocationCode?: string
  /**
   * La dirección final del evento para el segmento que representa el evento de tipo de transporte con dos direcciones, como la dirección de entrega de una reserva de automóvil cuando hay una dirección de entrega diferente a la de recogida.
   */
  endAddress?: GenericAddress
}