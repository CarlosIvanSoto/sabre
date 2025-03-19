/**
 * Contiene otra información de servicio (OSI) hacia/desde un proveedor específico.
 */
export interface OtherServiceInformation {
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea emisora.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  airlineCode?: string
  /**
   * El código de dos caracteres de la cadena hotelera.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: BY
   */
  chainCode?: string
  /**
   * El código de dos letras del proveedor de alquiler de vehículos.
   *
   * pattern: ^[A-Z]{2}$
   * example: ZE
   */
  vendorCode?: string
  /**
   * Especifica a qué viajero de la lista de viajeros pertenece el billete.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndex?: number
  /**
   * El texto de la información del servicio.
   *
   * example: /CX-J674A0957C0
   */
  serviceMessage?: string
}