import { AssociatedFlightDetails, HotelPaymentPolicyEnum } from "../../common/interfaces"
/**
 * Contiene información del hotel.
 */
export interface HotelToBook {
  /**
   * Si es cierto, el hotel originalmente obtenido del GDS se reservará utilizando la ruta de reserva de Servicios de contenido para alojamiento (CSL) en lugar de la ruta heredada (servicios de bajo nivel).
   *
   * example: True
   * default: True
   */
  useCsl?: boolean
  /**
   * La clave de reserva se devuelve en la respuesta API de verificación de precio del hotel y es un valor obligatorio para realizar la reserva del hotel.
   *
   * minLength: 1
   * maxLength: 240
   * example: d9e73f0d-5f90-4b43-9c86-2d88a732604f
   */
  bookingKey: string
  /**
   * Un código que una empresa puede darle a una agencia para que lo utilice para obtener un descuento. Muy a menudo está vinculado a un código tarifario negociado. Aplica únicamente para hoteles GDS.
   *
   * format: int32
   * minimum: 1
   * example: 6878700
   */
  corporateDiscountCode?: number
  /**
   * Contiene detalles de las habitaciones de hotel que se reservarán. Actualmente, los hoteles GDS no admiten reservas de habitaciones múltiples.
   *
   * minItems: 1
   * maxItems: 99
   */
  rooms?: RoomToBook[]
  /**
   * La instrucción especial proporcionada a la propiedad.
   *
   * example: Need a wi-fi in the room.
   */
  specialInstruction?: string
  /**
   * Identifica la política de pago. `DEPÓSITO` sólo se puede utilizar con tarjeta de crédito, agencia o corporativa. `GARANTÍA` sólo se puede utilizar con tarjeta de crédito, agencia, IATA, empresa o corporativo. Cuando utilice el pago "TARDE", no indique "formOfPayment", ya que este método (compatible con algunos proveedores de hoteles) permite a los clientes realizar una reserva sin ningún tipo de pago.
   */
  paymentPolicy?: HotelPaymentPolicyEnum
  /**
   * Índice del tipo de pago en la lista `formsOfPayment`. Las formas de pago aplicables a la reserva de hotel son: `PAYMENT_CARD`, `AGENCY_NAME`, `AGENCY_IATA`, `CORPORATE`, `COMPANY_NAME`, `VIRTUAL_CARD`.
   *
   * format: int32
   * minimum: 1
   * maximum: 11
   * example: 1
   */
  formOfPayment?: number
  /**
   * Contiene información de llegada y salida de vuelos que se proporciona al proveedor del hotel.
   */
  associatedFlightDetails?: AssociatedFlightDetails
}
/**
 * Contiene detalles de una habitación de hotel a reservar.
 */
interface RoomToBook {
  /**
   * De ser cierto, la habitación es para fumadores. Si no se utiliza, el sistema asume una habitación para no fumadores.
   *
   * example: False
   * default: False
   */
  isSmoking?: boolean
  /**
   * Permite solicitar un código de tipo de cama específico. Pase la tabla de códigos OTA (BED) para reservas de hoteles del agregador EAN.
   *
   * format: int32
   * example: 3
   */
  bedTypeCode?: number
  /**
   * Permite solicitar habitaciones de accesibilidad. Pase la tabla de códigos OTA (PHY).
   *
   * format: int32
   * example: 3
   */
  physicalDisabilityCode?: number
  /**
   * Contiene detalles de los extras de habitación solicitados.
   *
   * minItems: 1
   * maxItems: 99
   */
  /**
   * Contiene información extra de la habitación.
   */
  roomExtras?: RoomExtra[]
  /**
   * Índice del viajero dentro de la lista de `viajeros`. Indica qué viajeros se reservarán en una habitación en particular. Se supone que el primer viajero será considerado el huésped principal.
   */
  /**
   * Índice del viajero.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndices?: number[]
}
/**
 * Contiene información extra de la habitación.
 */
interface RoomExtra {
  /**
   * Identifica el tipo de habitación extra. Los tipos admitidos actualmente son `26`: cuna, `91`: cama plegable, `196`: persona adicional.
   *
   * format: int32
   * example: 26
   */
  roomExtraType: number
  /**
   * El número de habitaciones extras de este tipo.
   *
   * format: int32
   * minimum: 1
   * default: 1
   * example: 1
   */
  quantity?: number
  /**
   * La cantidad monetaria.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 100.00
   */
  amount?: string
}
