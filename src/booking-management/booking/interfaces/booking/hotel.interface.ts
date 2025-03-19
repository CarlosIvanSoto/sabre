import { TotalValues } from "../../../common/interfaces";
import { AssociatedFlightDetails, ContactInformation, DateRangeRefundPenalty, GenericAddress, HotelPaymentPolicyEnum, HotelReference, StatusNameEnum, Value } from "../../common/interfaces";
/**
 * Identifica la fuente de la reserva del hotel.
 *
 * example: Sabre GDS
 * default: Unknown
 */
enum HotelSourceEnum {
  Legacy,
  'Sabre GDS',
  'Expedia Associate Network',
  'HotelBeds.com',
  'Booking.com',
  CMNet,
  Unknown
}
/**
 * Contiene información de reserva de hotel identificada por "itemId" y asociada con una reserva.
 */
export interface Hotel extends HotelReference, HotelItem {}
/**
 * Contiene información del hotel para la reserva dada.
 */
interface HotelItem {
  /**
   * El número de reserva del proveedor del hotel.
   *
   * pattern: ^[A-Z0-9-]{6,}$
   * example: 23428937429074
   */
  confirmationId?: string
  /**
   * El nombre completo del hotel.
   *
   * example: Ilia Hotel and Luxury Suites
   */
  hotelName: string
  /**
   * La ubicación exacta del hotel.
   */
  address: HotelAddress
  /**
   * La fecha de entrada en formato `AAAA-MM-DD` en la zona horaria local del hotel.
   *
   * format: date
   * example: 2019-07-09
   */
  checkInDate: string
  /**
   * La hora de check-in en formato `HH:MM` en la hora local del hotel.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 15:00
   */
  checkInTime: string
  /**
   * La fecha de salida en formato `AAAA-MM-DD` en la zona horaria local del hotel.
   *
   * format: date
   * example: 2019-07-19
   */
  checkOutDate: string
  /**
   * La hora de salida en formato `HH:MM` en la hora local del hotel.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 11:00
   */
  checkOutTime: string
  /**
   * Un código de descuento que una empresa puede proporcionar a una agencia. Generalmente vinculado a un código de tarifa negociado.
   *
   * format: int32
   * minimum: 1
   * example: 6878700
   */
  corporateDiscountCode?: number
  /**
   * Especifica el viajero principal de la lista de viajeros con quien está asociada la reserva de hotel.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  leadTravelerIndex?: number
  /**
   * El número de habitaciones de la reserva de hotel.
   */
  room?: Room
  /**
   * Si es "verdadero", la reserva de hotel se puede reembolsar en su totalidad o en segmentos. Consulte la matriz `refundPenalties` para obtener más información.
   *
   * default: True
   * example: False
   */
  isRefundable: boolean
  /**
   * Enumera las condiciones y pagos por cancelaciones de reservas de habitaciones de hotel.
   */
  /**
   * Contiene el rango de fechas hasta el cual se aplica una multa, incluido el costo total de la multa.
   */
  refundPenalties?: DateRangeRefundPenalty[]
  /**
   * El código de penalización por una cancelación en el contexto del contenido de hotel GDS heredado.
   *
   * example: 01D
   */
  refundPenaltyPolicyCode?: string
  /**
   * El código de estado de una o dos letras utilizado por los proveedores. Indica el estado de la reserva del hotel.
   *
   * pattern: ^[A-Z]{1,2}$
   * example: HK
   */
  hotelStatusCode?: string
  /**
   * El valor significativo que describe el estado de la reserva del hotel.
   */
  hotelStatusName?: StatusNameEnum
  /**
   * El código de dos caracteres de la cadena.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: BY
   */
  chainCode?: string
  /**
   * El nombre de la cadena.
   *
   * example: Banyan Tree Hotels and Resorts
   */
  chainName?: string
  /**
   * La identificación única de la propiedad acordada entre proveedores.
   *
   * pattern: ^[0-9]{1,9}$
   * example: 100144834
   */
  propertyId?: string
  /**
   * Contiene información de contacto del hotel.
   */
  contactInfo?: ContactInformation
  /**
   * Solicitudes especiales adicionales realizadas por el viajero con respecto a la reserva de hotel.
   *
   * example: Need a wi-fi in the room.
   */
  specialInstructions?: string
  /**
   * The Open Travel Alliance [Código de tipo de pago] (https://opentravel.org/download-the-opentravel-specification). Los códigos OTA aplicables pueden ser uno de los siguientes: 5, 18, 19, 29, 30 o 43.
   *
   * format: int32
   * minimum: 5
   * maximum: 43
   * example: 5
   */
  guaranteeTypeCode?: number
  /**
   * El nombre asociado con el código de tipo de pago de Open Travel Alliance.
   */
  guaranteeTypeName?: GuaranteeTypeNameEnum
  /**
   * Proporciona información sobre la garantía proporcionada para el contenido hotelero GDS heredado.
   *
   * example: GVI4XXXXXXXXXXX1111EXP 01 25-HOTEL
   */
  guaranteePaymentNote?: string
  /**
   * Identifica la política de pago del hotel.
   */
  paymentPolicy?: HotelPaymentPolicyEnum
  /**
   * Contiene información de pago del servicio.
   */
  payment?: TotalValues
  /**
   * El número de invitados.
   *
   * format: int32
   * example: 1
   * minimum: 1
   */
  numberOfGuests?: number
  /**
   * Contiene información de llegada y salida de vuelos utilizada principalmente para reservas de hotel.
   */
  associatedFlightDetails?: AssociatedFlightDetails
  /**
   * Un código numérico específico que indica la fuente de la reserva del hotel.
   *
   * format: int32
   * minimum: 1
   * example: 100
   */
  sourceTypeCode?: number
  /**
   * Identifica la fuente de la reserva del hotel.
   */
  sourceTypeName?: HotelSourceEnum
}
/**
 * Contiene información de la dirección del hotel.
 */
interface HotelAddress extends GenericAddress {
  /**
   * El código de ciudad IATA de tres letras de la ubicación del hotel.
   *
   * pattern: ^[A-Z]{3}$
   * example: DFW
   */
  cityCode?: string
}
/**
 * Contiene información básica de las habitaciones del hotel con el número de habitaciones reservadas.
 */
interface Room {
  /**
   * El tipo de habitación proporcionada por el proveedor del hotel.
   *
   * example: 2 double beds
   */
  roomType: string
  /**
   * El número de habitaciones reservadas de este tipo de habitación.
   *
   * format: int32
   * minimum: 1
   * default: 1
   * example: 1
   */
  quantity: number
  /**
   * La descripción detallada de la habitación proporcionada por el proveedor del hotel.
   *
   * example: Deluxe Room, 2 Double Beds
   */
  description?: string
  /**
   * El ID único para un tipo de habitación de un proveedor determinado.
   *
   * example: 100144834
   */
  roomTypeCode?: string
  /**
   * El importe de la tarifa de la habitación y la moneda por noche.
   */
  roomRate?: Value
  /**
   * Enumera los viajeros dentro de la lista de "viajeros". Indica qué viajeros se consideran huéspedes asociados a una habitación en particular. Es posible que no todos los viajeros figuren como huéspedes del hotel en la reserva del hotel.
   */
  /**
   * El índice del viajero en la matriz "viajeros".
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndices?: number[]
}
/**
 * Identifica el nombre del pago OTA.
 *
 * example: Credit card
 */
enum GuaranteeTypeNameEnum {
  'Credit card',
  'Travel agency name/address',
  'Travel agency IATA number',
  'Company name/address',
  'Corporate ID/CD number',
  'Virtual card'
}
