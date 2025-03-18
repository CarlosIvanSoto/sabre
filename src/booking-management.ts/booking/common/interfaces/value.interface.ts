/**
 * Contiene información sobre el monto monetario.
 */
export interface Value {
  /**
   * La cantidad monetaria.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 100.00
   */
  amount: string
  /**
   * El código de moneda ISO-4217 de tres letras.
   *
   * pattern: ^[A-Z]{3}$
   * example: USD
   */
  currencyCode: string
}
