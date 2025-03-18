/**
 * Contiene la referencia del objeto de vuelo por "itemId".
 */
export interface FlightReference {
  /**
   * El ID de un vuelo.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 12
   */
  itemId: string
}