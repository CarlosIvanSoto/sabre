/**
 * Contiene el monto de la comisión aplicable a la tarifa.
 */
export interface Commission {
  /**
   * Importe incluido en la tarifa.
   *
   * pattern: ^[0-9]+(\.[0-9]{2})?$
   * example: 25.00
   */
  commissionAmount?: string
  /**
   * El código de moneda de tres letras [ISO 4217](https://www.iso.org/iso-4217-currency-codes.html).
   *
   * pattern: ^[A-Z]{3}$
   * example: USD
   */
  currencyCode?: string
  /**
   * Porcentaje incluido en la tarifa.
   *
   * pattern: ^[0-9]{1,3}(\.[0-9]{1,2})?$
   * example: 5.00
   */
  commissionPercentage?: string
}