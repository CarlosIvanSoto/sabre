/**
 * Contiene la referencia del objeto de tren por "itemId".
 */
export interface TrainReference {
  /**
   * La identificación de la reserva de tren dada.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 12
   */
  itemId: string
}