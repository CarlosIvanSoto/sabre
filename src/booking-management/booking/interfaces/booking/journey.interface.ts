/**
 * Contiene detalles de los vuelos dentro del viaje.
 */
export interface Journey {
  /**
   * El código de aeropuerto IATA de tres letras del primer vuelo del viaje.
   *
   * pattern: ^[A-Z]{3}$
   * example: DFW
   */
  firstAirportCode: string
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
   * El código de aeropuerto IATA de tres letras del último vuelo del viaje.
   *
   * pattern: ^[A-Z]{3}$
   * example: HNL
   */
  lastAirportCode: string
  /**
   * El número total de vuelos en el viaje.
   *
   * minimum: 1
   * example: 1
   */
  numberOfFlights: number
}