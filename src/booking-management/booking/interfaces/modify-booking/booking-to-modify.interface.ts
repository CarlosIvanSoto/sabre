import { Address, DocumentTypeEnum, FlightReference, FormOfPayment, GenderEnum, HotelReference, LoyaltyProgram, Phone } from "../../common/interfaces"
/**
 * Contiene información de reserva.
 */
export interface BookingToModify {
  /**
   * El identificador de cliente utilizado por su agencia de viajes, también conocido como número de cliente o número DK. Puede ser una cadena de seis, siete o 10 caracteres.
   *
   * pattern: ^[0-9A-Z]{6}([1-9A-Z*]{1}|[0-9A-Z]{4})?$
   * example: 1234567
   */
  agencyCustomerNumber?: string
  /**
   * Contiene información de creación de la reserva.
   */
  creationDetails?: CreationDetailsToModify
  /**
   * Enumera los hoteles que deberían modificarse.
   */
  /**
   * Contiene información de reserva de hotel identificada por "itemId" y asociada con una reserva.
   */
  hotels?: HotelToModify[]
  /**
   * Contiene la información de pago necesaria para modificar la reserva.
   */
  payments?: PaymentToModify
  /**
   * Enumera todos los mensajes de solicitud de servicio especial (SSR) enviados a una aerolínea. 
   * Los mensajes pueden contener preferencias del viajero o información obligatoria/opcional dirigida a la aerolínea.
   */
  /**
   * Contiene información de servicios especiales (SSR).
   */
  specialServices?: SpecialServiceToModify[]
  /**
   * Muestra información personal de los viajeros.
   */
  /**
   * Contiene información del viajero.
   */
  travelers?: TravelerToModify[]
}
/**
 * Contiene información de creación de la reserva.
 */
interface CreationDetailsToModify {
  /**
   * Un identificador único acreditado por la Asociación de Transporte Aéreo Internacional (IATA).
   *
   * pattern: ^[0-9]{7,8}$
   * example: 12344321
   */
  agencyIataNumber?: string
}
/**
 * Contiene información de reserva de hotel identificada por "itemId" y asociada con una reserva.
 */
interface HotelToModify extends HotelReference, HotelDetailsToModify {}
/**
 * Identifica la política de pago del hotel.
 *
 * example: DEPOSIT
 */
const HOTEL_PAYMENT_POLICY = {
  DEPOSIT: "DEPOSIT",
  GUARANTEE: "GUARANTEE",
  LATE: "LATE",
} as const

type HotelPaymentPolicyEnum = keyof typeof HOTEL_PAYMENT_POLICY
/**
 * Contiene información del hotel para la reserva dada que debe modificarse.
 */
interface HotelDetailsToModify {
  /**
   * Un valor obligatorio a proporcionar en caso de cambios en el tipo de habitación, número de huéspedes y fechas de entrada o salida fuera del rango de fechas original. Devuelto en la respuesta API de verificación de precio del hotel.
   *
   * minLength: 1
   * maxLength: 240
   * example: d9e73f0d-5f90-4b43-9c86-2d88a732604f
   */
  bookingKey?: string
  /**
   * La fecha de entrada en formato `AAAA-MM-DD` en la zona horaria local del hotel.
   *
   * format: date
   * example: 2019-07-09
   */
  checkInDate?: string
  /**
   * La fecha de salida en formato `AAAA-MM-DD` en la zona horaria local del hotel.
   *
   * format: date
   * example: 2019-07-19
   */
  checkOutDate?: string
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
  leadTravelerIndex: number
  /**
   * Contiene detalles de una habitación de hotel para modificar.
   */
  room: RoomToModify
  /**
   * Solicitudes especiales adicionales realizadas por el viajero con respecto a la reserva de hotel.
   *
   * example: Need a wi-fi in the room.
   */
  specialInstructions?: string
  /**
   * El número de invitados.
   *
   * format: int32
   * example: 1
   * minimum: 1
   */
  numberOfGuests: number
  /**
   * Contiene información de llegada y salida de vuelos utilizada principalmente para reservas de hotel.
   */
  associatedFlightDetails?: AssociatedFlightDetails
  /**
   * Identifica la política de pago. `DEPÓSITO` sólo se puede utilizar con tarjeta de crédito, agencia o corporativa. `GARANTÍA` sólo se puede utilizar con tarjeta de crédito, agencia, IATA, empresa o corporativo. Cuando utilice el pago "TARDE", no indique un "formOfPaymentIndex", ya que este método (compatible con algunos proveedores de hoteles) permite a los clientes realizar una reserva sin ningún tipo de pago.
   */
  paymentPolicy: HotelPaymentPolicyEnum
  /**
   * El índice del tipo de pago en la lista `formsOfPayment`. Formas de pago aplicables a una reserva de hotel: `PAYMENT_CARD`, `AGENCY_NAME`, `AGENCY_IATA`, `CORPORATE`, `COMPANY_NAME`, `VIRTUAL_CARD`.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  formOfPaymentIndex?: number
}
/**
 * Contiene detalles de una habitación de hotel para modificar.
 */
interface RoomToModify {
  /**
   * Enumera índices de viajeros del conjunto "viajeros" a quienes está asignada la habitación.
   *
   * minItems: 1
   */
  /**
   * Índice del viajero.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndices: number[]
}
/**
 * Contiene información de llegada y salida de vuelos utilizada principalmente para reservas de hotel.
 */
interface AssociatedFlightDetails {
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea comercializadora para el vuelo de llegada.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  arrivalAirlineCode?: string
  /**
   * El número de vuelo asociado con la aerolínea comercializadora del vuelo de llegada.
   *
   * format: int32
   * minimum: 1
   * maximum: 9999
   * example: 123
   */
  arrivalFlightNumber?: number
  /**
   * La hora de llegada programada en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 12:28
   */
  arrivalTime?: string
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea comercializadora para el vuelo de salida.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  departureAirlineCode?: string
  /**
   * El número de vuelo asociado con la aerolínea comercializadora del vuelo de salida.
   *
   * format: int32
   * minimum: 1
   * maximum: 9999
   * example: 123
   */
  departureFlightNumber?: number
  /**
   * La hora de salida programada en formato `HH:MM`.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:15
   */
  departureTime?: string
}
/**
 * Contiene la información de pago necesaria para modificar la reserva.
 */
interface PaymentToModify {
  /**
   * Muestra los métodos de pago asociados con la reserva.
   *
   * minItems: 1
   * maxItems: 10
   */
  /**
   * Contiene detalles de una forma de pago.
   */
  formsOfPayment?: FormOfPayment[]
}
/**
 * Contiene el mensaje de solicitud de servicio especial (SSR) enviado a una aerolínea. El mensaje puede contener preferencias del viajero o información obligatoria/opcional dirigida a la aerolínea.
 */
interface SpecialServiceToModify {
  /**
   * Enumera índices de viajeros del conjunto "viajeros" a quienes se les asigna el servicio especial. Para servicios especiales sin asignación explícita de viajero, no se debe proporcionar esta matriz.
   */
  /**
   * El índice del viajero en la matriz "viajeros".
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndices?: number[]
  /**
   * Enumera los vuelos a los que hace referencia su "itemId". Un único servicio especial puede estar asociado a múltiples vuelos.
   */
  /**
   * Contiene la referencia del objeto de vuelo por "itemId".
   */
  flights?: FlightReference[]
  /**
   * Define la categoría de la solicitud de servicio especial enviada a la aerolínea. Visite el sitio web oficial de IATA para obtener la lista de referencias de códigos SSR actualmente admitidos. Es posible que falten algunos códigos específicos de aerolíneas en estos recursos de IATA.
   *
   * pattern: ^[A-Z]{4}$
   * example: WCHR
   */
  code: string
  /**
   * Información diversa de texto libre utilizada en mensajes de teletipo enviados hacia o desde la aerolínea. Puede contener detalles adicionales de servicios especiales que son obligatorios para distinguir las características del producto por parte de la aerolínea.
   *
   * example: /PREPAID
   */
  message?: string
}
/**
 * Contiene información del viajero.
 */
interface TravelerToModify {
  /**
   * El nombre del viajero.
   *
   * pattern: ^[^\s]+(\s[^\s]+)*$
   * example: John
   */
  givenName?: string
  /**
   * El apellido del viajero.
   *
   * pattern: ^([^\s]+(\s[^\s]{1,})*){2,}$
   * example: Smith
   */
  surname?: string
  /**
   * La fecha de nacimiento del viajero en formato `AAAA-MM-DD`.
   *
   * format: date
   * example: 1970-01-23
   */
  birthDate?: string
  /**
   * Especifica el tipo (edad) del viajero. Se utiliza para reservas de vuelos y hoteles. Los valores disponibles para reservas de hotel se limitan a `ADT` (para adultos) y `CNN` (para niños).
   *
   * pattern: ^[A-Z][A-Z0-9]{2}$
   * example: ADT
   */
  passengerCode?: string
  /**
   * Si es "verdadero", el viajero está asociado a una reserva de grupo.
   *
   * example: True
   */
  isGrouped?: boolean
  /**
   * Enumera todas las direcciones de correo electrónico del viajero.
   */
  /**
   * La dirección de correo electrónico del viajero.
   *
   * format: email
   * example: john@smith.family.priv
   */
  emails?: string[]
  /**
   * Enumera todos los números de teléfono asociados con el viajero.
   */
  /**
   * Contiene detalles del teléfono.
   */
  phones?: Phone[]
  /**
   * Enumera los documentos de identidad aplicables al viajero.
   */
  /**
   * Enumera los documentos de identidad aplicables al viajero.
   */
  identityDocuments?: ModifyIdentityDocument[]
  /**
   * Enumera los programas de fidelización en los que participa el viajero.
   */
  /**
   * Contiene detalles del programa de fidelización del pasajero, como una tarjeta de viajero frecuente.
   */
  loyaltyPrograms?: LoyaltyProgram[]
}
/**
 * Contiene detalles del documento de identidad a modificar.
 */
interface ModifyIdentityDocument extends IdentityDocumentDetails {
  /**
   * Enumera los vuelos asociados con un documento al que hace referencia su "itemId". Un único documento de identidad puede asociarse con múltiples ID de vuelo.
   */
  /**
   * Contiene la referencia del objeto de vuelo por "itemId".
   */
  flights?: FlightReference[]
}
/**
 * Contiene detalles de un documento de identidad.
 */
interface IdentityDocumentDetails {
  /**
   * El identificador único del documento.
   *
   * pattern: ^[a-zA-Z0-9]+$
   * example: 0123456789
   */
  documentNumber?: string
  /**
   * Identifica el tipo de documento de pasajero.
   */
  documentType: DocumentTypeEnum
  /**
   * La fecha de vencimiento del documento de identidad.
   *
   * format: date
   * example: 2024-07-09
   */
  expiryDate?: string
  /**
   * El país que expide el documento de pasajero proporciona un código ISO 3166 de dos o tres letras. No aplicable al tipo de documento `VISA`.
   *
   * pattern: ^[A-Z]{2,3}$
   * example: US
   */
  issuingCountryCode?: string
  /**
   * El país en el que reside el pasajero o su país de nacionalidad se proporciona como un código ISO 3166 de dos o tres letras.
   *
   * pattern: ^[A-Z]{2,3}$
   * example: US
   */
  residenceCountryCode?: string
  /**
   * La ciudad o la ciudad y el país en el que se emitió el documento "VISA". Se utiliza con el tipo de documento "VISA" (no se admite NDC).
   *
   * maxLength: 35
   * example: LONDON UK
   */
  placeOfIssue?: string
  /**
   * El lugar de nacimiento del pasajero. Se utiliza principalmente con el tipo de documento `VISA` (no se admite NDC).
   *
   * maxLength: 35
   * example: LYON FR
   */
  placeOfBirth?: string
  /**
   * El código de país de dos o tres letras donde el documento es válido. Se utiliza con el tipo de documento `VISA` (no se admite NDC).
   *
   * pattern: ^[A-Z]{2,3}$
   * example: US
   */
  hostCountryCode?: string
  /**
   * La fecha en la que se emitió el documento de identidad se proporciona en el formato "AAAA-MM-DD". Se utiliza principalmente con el tipo de documento `VISA`.
   *
   * format: date
   * example: 2019-07-09
   */
  issueDate?: string
  /**
   * El nombre del viajero.
   *
   * example: John
   */
  givenName?: string
  /**
   * El segundo nombre del viajero (no se admite NDC).
   *
   * example: Jack
   */
  middleName?: string
  /**
   * El apellido del viajero.
   *
   * example: Smith
   */
  surname?: string
  /**
   * La fecha de nacimiento del viajero en formato AAAA-MM-DD.
   *
   * format: date
   * example: 1980-12-02
   */
  birthDate?: string
  /**
   * Identifica el sexo del pasajero.
   */
  gender?: GenderEnum
  /**
   * Si es "verdadero", indica el titular principal de un documento emitido para varios viajeros.
   *
   * example: True
   */
  isPrimaryDocumentHolder?: boolean
  /**
   * Si es "verdadero", el documento de identidad se aplica a un niño de regazo. Solo se puede utilizar con los tipos de documentos `VISA`, `RESIDENCE_ADDRESS` y `DESTINATION_ADDRESS`.
   *
   * example: True
   */
  isLapChildDocument?: boolean
  /**
   * La dirección de residencia o destino del viajero.
   */
  residenceDestinationAddress?: Address
}