/**
 * Contiene los códigos de impuestos deseados y sus montos anulados.
 */
export interface Tax {
  /**
   * El código fiscal deseado. Debe combinarse con "cantidad".
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: XY
   */
  taxCode: string
  /**
   * La cantidad monetaria.
   *
   * pattern: ^([0-9]|[1-9][0-9]+)\.[0-9]{2}$
   * example: 100.00
   */
  amount: string
}