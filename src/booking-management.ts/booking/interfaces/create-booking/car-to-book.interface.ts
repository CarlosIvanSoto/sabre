import { Address, CarRentalSite } from "../../common/interfaces"
/**
 * Identifica la política de pago del hotel.
 *
 * example: DEPOSIT
 */
const CAR_PAYMENT_POLICY = {
  DEPOSIT: "DEPOSIT",
  GUARANTEE: "GUARANTEE",
}
type CarPaymentPolicyEnum = keyof typeof CAR_PAYMENT_POLICY
/**
 * Contiene información del coche.
 */
export interface CarToBook {
  /**
   * La clave de reserva única devuelta en la respuesta de la API de verificación de precio del vehículo. Esta clave es obligatoria para reservar un coche.
   *
   * minLength: 1
   * maxLength: 240
   * example: d9e73f0d-5f90-4b43-9c86-2d88a732604f
   */
  bookingKey: string
  /**
   * El índice de viajeros asociado a la reserva del coche.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndex?: number
  /**
   * El índice del correo electrónico del viajero ("travelers.emails") compartido con el proveedor del automóvil. Si no se especifica el correo electrónico del viajero, el índice apuntará a la información de contacto del viajero (`contactInfo.emails`).
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  emailIndex?: number
  /**
   * Contiene la dirección de recogida personalizada del coche reservado.
   */
  collectionAddress?: Address
  /**
   * Contiene los detalles del lugar de recogida personalizado del coche reservado.
   */
  collectionSite?: CarRentalSite
  /**
   * Contiene la dirección de entrega personalizada del coche reservado.
   */
  deliveryAddress?: Address
  /**
   * Contiene detalles del lugar de entrega personalizado para el automóvil reservado.
   */
  deliverySite?: CarRentalSite
  /**
   * Identifica la póliza asociada al pago. Especifica el tipo de garantía, como "GARANTÍA" o "DEPÓSITO", si corresponde.
   */
  paymentPolicy?: CarPaymentPolicyEnum
  /**
   * Índice del tipo de pago en la lista `formsOfPayment`. Las formas de pago aplicables a la reserva de un automóvil son: `PAYMENT_CARD`, `VOUCHER`.
   *
   * format: int32
   * minimum: 1
   * maximum: 11
   * example: 1
   */
  formOfPayment?: number
  /**
   * El número de coches a reservar. El valor predeterminado es "1".
   *
   * format: int32
   * minimum: 1
   * default: 1
   * example: 1
   */
  quantity?: number
  /**
   * Instrucciones especiales basadas en texto proporcionadas al proveedor.
   *
   * example: Wants a blue car.
   */
  specialInstructions?: string
  /**
   * Índice del vuelo en la reserva. Los datos del vuelo correspondientes (código de aerolínea y número de vuelo) se proporcionan al proveedor del vehículo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  flightIndex?: number
}