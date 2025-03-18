/**
 * Contiene una referencia de objeto de crucero por "itemId".
 */
export interface CruiseReference {
  /**
   * La identificación de la reserva de crucero dada.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 12
   */
  itemId: string
}