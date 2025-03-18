/**
 * Contiene detalles del teléfono.
 */
export interface Phone {
  /**
   * El número de teléfono formateado del viajero.
   *
   * pattern: ^[0-9+-]+$
   * example: +1-555-123-4567
   */
  number: string
  /**
   * El tipo de número de teléfono. Los códigos de tipo de teléfono disponibles son `H` - residencial, `B` - comercial, `C` - celular y `M` - móvil.
   *
   * pattern: ^[A-Z]{1}$
   * example: M
   */
  label?: string
}