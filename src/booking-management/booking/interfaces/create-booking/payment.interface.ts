import { FormOfPayment, GenericAddress } from "../../common/interfaces"

/**
 * Contiene campos obligatorios y opcionales necesarios para pasar la información de pago necesaria para completar la reserva.
 */
export interface Payment {
  /**
   * Contiene información de la dirección de facturación de la tarjeta de crédito que se agregará a la reserva. Solo se permite una dirección de facturación por reserva.
   */
  billingAddress?: GenericAddress
  /**
   * Contiene todos los métodos de pago que estarán asociados a la reserva.
   *
   * minItems: 1
   * maxItems: 10
   */
  /**
   * Contiene detalles de una forma de pago.
   */
  formsOfPayment?: FormOfPayment[]
}
