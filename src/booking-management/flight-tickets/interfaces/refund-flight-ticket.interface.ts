/**
 * Contiene información detallada de cada billete a reembolsar.
 */
export interface RefundFlightTicket {
  /**
   * El número de documento electrónico del billete a reembolsar.
   *
   * pattern: ^[0-9A-Z]{13}(/[0-9]{2})?$
   * example: 0167489825830
   */
  number?: string
  /**
   * Contiene calificadores de reembolso opcionales para boletos ATPCO.
   */
  refundQualifiers?: RefundQualifiers
}
/**
 * Aplicable únicamente a BSP Francia y Canadá. Identifica el tipo de viaje, que se debe proporcionar si el reembolso es para un vuelo nacional. Los valores posibles son "B", "F" o "M".
 *
 * example: B
 */
const JOURNEY_TYPE_CODE = {
  B: "B",
  F: "F",
  M: "M",
} as const

type JourneyTypeCodeEnum = keyof typeof JOURNEY_TYPE_CODE
/**
 * Contiene calificadores de reembolso opcionales para boletos ATPCO.
 */
interface RefundQualifiers {
  /**
   * Importe de la penalización por cancelación en la moneda del billete original que se aplicará al reembolso. Esto anulará cualquier penalización calculada por el sistema.
   *
   * pattern: ^[0-9]+(\.[0-9]{2})?$
   * example: 100.00
   */
  overrideCancelFee?: string
  /**
   * Enumera códigos y montos de impuestos que se anularán.
   */
  overrideTaxes?: OverrideTax[]
  /**
   * Importe a aplicar a la devolución. Esto anulará la comisión del billete original. No se puede combinar con `commissionPercentage`.
   *
   * pattern: ^[0-9]+(\.[0-9]{2})?$
   * example: 25.00
   */
  commissionAmount?: string
  /**
   * Porcentaje a aplicar a la devolución. Esto anulará la comisión del billete original. No se puede combinar con `commissionAmount`.
   *
   * pattern: ^[0-9]{1,3}(\.[0-9]{1,2})?$
   * example: 5.00
   */
  commissionPercentage?: string
  /**
   * Monto de la comisión que se cobra por la penalización por cancelación.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 25.00
   */
  commissionOnPenalty?: string
  /**
   * Un código de exención que se aplicará al reembolso. Por lo general, la aerolínea proporcionará un código de exención para que el agente lo utilice para anular una tarifa de cancelación.
   *
   * pattern: ^[A-Z0-9]{1,20}$
   * example: 12345ABCD
   */
  waiverCode?: string
  /**
   * Un código de viaje que se aplicará al reembolso. El ingreso de un tourCode anulará cualquier código de recorrido en el boleto original.
   *
   * pattern: ^[A-Z0-9]{1,15}$
   * example: 123456789ABCDE
   */
  tourCode?: string
  /**
   * Enumera los montos de pago que se aplicarán al reembolsar un boleto emitido con múltiples formas de pago. El pedido debe coincidir con las formas de pago utilizadas al emitir el billete. P.ej. el billete se emitió con 1. Forma de pago "Efectivo" y 2. Forma de pago "Tarjeta de crédito". En este caso, el primer elemento debe representar el importe a reembolsar en efectivo y el segundo el importe a reembolsar a la tarjeta de crédito.
   */
  splitRefundAmounts?: SplitRefundAmount[]
  /**
   * Aplicable únicamente a BSP Francia y Canadá. Identifica el tipo de viaje, que se debe proporcionar si el reembolso es para un vuelo nacional. Los valores posibles son "B", "F" o "M".
   */
  journeyTypeCode?: JourneyTypeCodeEnum
}
/**
 * Contiene código y monto de un impuesto específico.
 */
interface OverrideTax {
  /**
   * El código fiscal de dos caracteres al que se aplica el importe reembolsable.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: XF
   */
  taxCode?: string
  /**
   * Importe en la moneda del billete original.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 5.00
   */
  taxAmount?: string
  /**
   * Muestra información para anular el monto reembolsable de las tasas aeroportuarias individuales de XF.
   */
  airportTaxBreakdowns?: AirportTaxBreakdown[]
}
/**
 * Contiene el monto del reembolso y el código de aeropuerto IATA de tres letras aplicable.
 */
interface AirportTaxBreakdown {
  /**
   * Importe en la moneda del billete original.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 5.5
   */
  taxAmount?: string
  /**
   * El código de aeropuerto IATA de tres letras al que se aplica el importe reembolsable.
   *
   * pattern: ^[A-Z0-9]{3}$
   * example: DFW
   */
  airportCode?: string
}
/**
 * Contiene el monto del reembolso por forma de pago en la moneda del boleto original.
 */
interface SplitRefundAmount {
  /**
   * Importe en la moneda del billete original.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 5.00
   */
  amount?: string
}
