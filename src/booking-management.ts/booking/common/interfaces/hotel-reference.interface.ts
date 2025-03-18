/**
 * Contiene la referencia del objeto de hotel por "itemId".
 */
export interface HotelReference {
  /**
   * El DNI de una reserva de hotel.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 12
   */
  itemId: string
}