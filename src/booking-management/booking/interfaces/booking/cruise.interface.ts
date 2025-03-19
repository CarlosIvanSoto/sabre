import { CruiseReference, StatusNameEnum } from "../../common/interfaces";
/**
 * Contiene información de reserva de crucero, identificada por "itemId", para la reserva dada.
 */
export interface Cruise extends CruiseReference, CruiseItem {}
/**
 * Contiene información del crucero para la reserva dada.
 */
type CruiseItem = {
  /**
   * El ID de referencia de reserva de crucero en el sistema de la línea de cruceros.
   *
   * pattern: ^[A-Z0-9]+$
   * example: XPCD8Q
   */
  confirmationId?: string
  /**
   * El código del proveedor del crucero.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: PC
   */
  vendorCode: string
  /**
   * El código de barco en el sistema de líneas de cruceros.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: RP
   */
  shipCode?: string
  /**
   * El nombre del barco en el sistema de la línea de cruceros.
   *
   * example: Royal Princess
   */
  shipName?: string
  /**
   * El código del puerto de origen.
   *
   * pattern: ^[A-Z0-9]{2,}$
   * example: ANC
   */
  fromPortCode: string
  /**
   * El código del puerto de destino para cruceros donde el puerto de destino es diferente al puerto de origen.
   *
   * pattern: ^[A-Z0-9]{2,}$
   * example: YVR
   */
  toPortCode?: string
  /**
   * La fecha de salida en formato `AAAA-MM-DD` en la zona horaria del puerto de origen.
   *
   * format: date
   * example: 2019-07-12
   */
  departureDate: string
  /**
   * La hora de salida en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 16:00
   */
  departureTime?: string
  /**
   * La fecha de llegada en formato `AAAA-MM-DD` en la zona horaria del puerto.
   *
   * format: date
   * example: 2019-07-15
   */
  arrivalDate: string
  /**
   * La hora de llegada en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:00
   */
  arrivalTime?: string
  /**
   * El número de invitados.
   *
   * format: int32
   * minimum: 1
   * example: 2
   */
  numberOfGuests?: number
  /**
   * El número del camarote reservado en el barco.
   *
   * pattern: ^[A-Z0-9]+$
   * example: C101
   */
  cabinNumber?: string
  /**
   * El código de estado de una o dos letras utilizado por los proveedores. Indica el estado de la reserva del crucero.
   *
   * pattern: ^[A-Z]{1,2}$
   * example: GK
   */
  cruiseStatusCode?: string
  /**
   * El valor significativo que describe el estado de la reserva del crucero.
   */
  cruiseStatusName?: StatusNameEnum
}