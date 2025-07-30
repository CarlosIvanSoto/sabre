/**
 * Contiene montos totales de pagos monetarios, montos antes de impuestos y montos de tarifas.
 */
export interface TotalValues {
  /**
   * El subtotal antes de aplicar impuestos y tarifas.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 100.00
   */
  subtotal?: string
  /**
   * El importe de todos los impuestos.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 8.00
   */
  taxes?: string
  /**
   * El monto de todas las tarifas aplicables.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 20.00
   */
  fees?: string
  /**
   * La cantidad total; la suma del subtotal, impuestos y tarifas.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 128.00
   */
  total: string
  /**
   * El código de moneda ISO-4217 de tres letras.
   *
   * pattern: ^[A-Z]{3}$
   * example: USD
   */
  currencyCode: string
  /**
     * pattern:^[0-9]+(\.[0-9]{1,3})?$
     * example:110.00 
     * The net remit amount. 
     * The EPR keyword "NETFQD" is required to return netRemit. 
     * Net remit is used to arrange the payment of an additional commission above the standard commission amount. 
     * This extra commission is payable by the validating carrier through the BSP settlement cycle.
     */
    netRemit?: string
}