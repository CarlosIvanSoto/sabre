/**
 * Contiene la referencia del objeto de automóvil mediante "itemId".
 */
export interface CarReference {
  /**
   * La identificación de la reserva de automóvil dada.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 12
   */
  itemId: string
}
