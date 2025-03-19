import { FlightReference, StatusNameEnum } from "../../common/interfaces"
/**
 * Contiene información de servicios especiales (SSR) para un viajero específico.
 */
export interface SpecialService {
  /**
   * Enumera los viajeros dentro de la lista de viajeros a la que pertenece el servicio especial. Esta lista no se proporciona para servicios especiales sin asignación explícita de viajero.
   */
  /**
   * El índice del viajero en la matriz "viajeros".
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndices?: number[]
  /**
   * Enumera los vuelos a los que hace referencia el vuelo "itemId". Se pueden devolver varios ID de vuelo para un único servicio especial.
   */
  /**
   * Contiene la referencia del objeto de vuelo por "itemId".
   */
  flights?: FlightReference[]
  /**
   * Define la categoría de la solicitud de servicio especial enviada a la aerolínea. Visite el sitio web oficial de IATA para obtener la lista de referencias de códigos SSR actualmente admitidos. Es posible que falten algunos códigos específicos de aerolíneas en estos recursos de IATA.
   *
   * pattern: ^[A-Z]{4}$
   * example: WCHR
   */
  code?: string
  /**
   * El nombre de la solicitud de servicio especial. Esta propiedad no se devuelve cuando se desconoce el nombre.
   *
   * example: Wheelchair/Passenger can walk up stairs
   */
  name?: string
  /**
   * Información diversa de texto libre utilizada en mensajes de teletipo enviados hacia o desde la aerolínea. Puede contener detalles adicionales de servicios especiales que son obligatorios para distinguir las características del producto por parte de la aerolínea.
   *
   * example: /PREPAID
   */
  message?: string
  /**
   * El código de estado de dos letras utilizado por los proveedores. Indica el estado del servicio especial.
   *
   * pattern: ^[A-Z]{2}$
   * example: HK
   */
  statusCode?: string
  /**
   * El valor significativo que describe el estado del servicio especial.
   */
  statusName?: StatusNameEnum
}