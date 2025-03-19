/**
 * Contiene información de llegada y salida de vuelos utilizada principalmente para reservas de hotel.
 */
export interface AssociatedFlightDetails {
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea comercializadora para el vuelo de llegada.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  arrivalAirlineCode?: string
  /**
   * El número de vuelo asociado con la aerolínea comercializadora del vuelo de llegada.
   *
   * format: int32
   * minimum: 1
   * maximum: 9999
   * example: 123
   */
  arrivalFlightNumber?: number
  /**
   * La hora de llegada programada en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 12:28
   */
  arrivalTime?: string
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea comercializadora para el vuelo de salida.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  departureAirlineCode?: string
  /**
   * El número de vuelo asociado con la aerolínea comercializadora del vuelo de salida.
   *
   * format: int32
   * minimum: 1
   * maximum: 9999
   * example: 123
   */
  departureFlightNumber?: number
  /**
   * La hora de salida programada en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:15
   */
  departureTime?: string
}