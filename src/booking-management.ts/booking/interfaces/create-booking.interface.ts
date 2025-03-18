import { BookingError, Notification } from "../../common/interfaces"
import { Booking } from "./booking.interface"
import { ContactInformation, OtherServiceInformation } from "../common/interfaces"
import type { Agency, BookRemark, BookTraveler, CarToBook, FlightDetails, FlightOffer, HotelToBook, Payment, Profile } from "./create-booking"

/**
 * Identifica la política para manejar errores dentro del servicio Crear reserva.
 *
 * example: HALT_ON_ERROR
 * default: HALT_ON_ERROR
 */
const CREATE_ERROR_POLICY = {
  HALT_ON_ERROR: "HALT_ON_ERROR",
  DO_NOT_HALT_ON_FLIGHT_PRICING_ERROR: "DO_NOT_HALT_ON_FLIGHT_PRICING_ERROR",
  DO_NOT_HALT_ON_HOTEL_BOOKING_ERROR: "DO_NOT_HALT_ON_HOTEL_BOOKING_ERROR",
  HALT_ON_INVALID_MINIMUM_CONNECTING_TIME_ERROR: "HALT_ON_INVALID_MINIMUM_CONNECTING_TIME_ERROR",
  DO_NOT_HALT_ON_CAR_BOOKING_ERROR: "DO_NOT_HALT_ON_CAR_BOOKING_ERROR",
} as const

type CreateErrorPolicyEnum = keyof typeof CREATE_ERROR_POLICY
/**
 * Contiene elementos obligatorios y opcionales para realizar una solicitud de reserva.
 */
export interface CreateBookingOptions {
  /**
   * La política para manejar errores.
 `HALT_ON_ERROR`: detiene el procesamiento al encontrar cualquier error en los servicios de línea descendente
 `DO_NOT_HALT_ON_FLIGHT_PRICING_ERROR`: continúa al encontrar un error de precio (solo ATPCO/reserva tradicional)
 `DO_NOT_HALT_ON_HOTEL_BOOKING_ERROR` - continúa al encontrar un error de reserva de hotel
 `DO_NOT_HALT_ON_CAR_BOOKING_ERROR` - continúa al encontrar un error de reserva de automóvil
 `HALT_ON_INVALID_MINIMUM_CONNECTING_TIME_ERROR` - parada si no se cumple el tiempo mínimo de conexión entre los vuelos (solo ATPCO/reserva tradicional).
   */
  /**
   * Contiene la política para manejar errores dentro del servicio Crear reserva.
   */
  errorHandlingPolicy?: CreateErrorPolicyEnum[]
  /**
   * Especifica el valor del código de pseudociudad deseado. La API no revierte el contexto después de completar la reserva.
   *
   * example: AAA
   * pattern: ^[A-Z0-9]{3,4}$
   */
  targetPcc?: string
  /**
   * La entidad que autoriza los cambios en un registro de nombre de pasajero.
   *
   * default: Create Booking
   * example: Create Booking
   */
  receivedFrom?: string
  /**
   * El tiempo de espera máximo en milisegundos aplicado a las actualizaciones asincrónicas relacionadas con la creación de reservas. Se utiliza principalmente para la operación de revisualización de reservas NDC.
   *
   * format: int32
   * minimum: 0
   * maximum: 10000
   * default: 0
   * example: 3000
   */
  asynchronousUpdateWaitTime?: number
  /**
   * Contiene detalles del perfil.
   *
   * minItems: 1
   * maxItems: 9
   */
  /**
   * Contiene campos obligatorios y opcionales necesarios para recuperar la información del perfil necesaria para completar una reserva.
   */
  profiles?: Profile[]
  /**
   * Contiene información de la agencia para la reserva.
   */
  agency?: Agency
  /**
   * Contiene campos obligatorios y opcionales necesarios para realizar una reserva aérea NDC.
   */
  flightOffer?: FlightOffer
  /**
   * Contiene todos los detalles de los vuelos a reservar.
   */
  flightDetails?: FlightDetails
  /**
   * Contiene todos los detalles del hotel a reservar.
   */
  hotel?: HotelToBook
  /**
   * Contiene todos los detalles del coche a reservar.
   */
  car?: CarToBook
  /**
   * Muestra información personal de los viajeros.
   */
  /**
   * Contiene información del viajero. Se admiten varios viajeros cuando reserva pasando los detalles del vuelo.
   */
  travelers?: BookTraveler[]
  /**
   * Contiene información de contacto del viajero o de la agencia para la reserva. Válido únicamente con los teléfonos y correos electrónicos. Al agregar números de teléfono, agregue el número de contacto de la agencia como primer elemento seguido del número de contacto principal del viajero.
   */
  contactInfo?: ContactInformation
  /**
   * Contiene campos obligatorios y opcionales necesarios para pasar la información de pago necesaria para completar la reserva.
   */
  payment?: Payment
  /**
   * Contiene comentarios que se añadirán a la reserva.
   */
  /**
   * Contiene el comentario que se añadirá a la reserva. Tenga en cuenta que `PRINT_ON_TICKET`, `FILLER_STRIP`, `INTERFACE` y `FORM_OF_PAYMENT` no son compatibles actualmente. El tipo de comentario `FORM_OF_PAYMENT` se agrega automáticamente a la reserva al completar `formsOfPayment`.
   */
  remarks?: BookRemark[]
  /**
   * Contiene acciones que se realizarán después de la creación de la reserva. Actualmente, puede elegir queuePlacement o notificación por correo electrónico. No es posible combinar ambos. Además, para fines de creación de reservas, solo se admite la notificación por correo electrónico "DEFAULT".
   */
  notification?: Notification
  /**
   * Contiene otra información de servicio (OSI) enviada a una aerolínea. Tenga en cuenta que no es posible enviar otra solicitud de servicio a una cadena hotelera y/o proveedor de alquiler de automóviles.
   */
  otherServices?: OtherServiceInformation[]
}

/**
 * Contiene información de reserva.
 */
export interface CreateBookingResponseSuccess {
  /**
   * Proporciona el momento exacto en el que se generó la respuesta. La marca de tiempo se expresa en UTC y se presenta en el formato AAAA-MM-DDTHH:MM:SSZ.
   *
   * format: date-time
   * example: 2020-10-28T11:11:21Z
   */
  timestamp?: string
  /**
   * El ID de reserva generado por la API Crear reserva. El sistema Sabre lo considera un localizador de PNR.
   *
   * pattern: ^[A-Z0-9]{6,}$
   * example: GLEBNY
   */
  confirmationId?: string
  /**
   * Contiene información de reserva.
   */
  booking?: Booking
  /**
   * Muestra información detallada sobre los errores. Esta matriz no se muestra en las respuestas exitosas.
   */
  errors?: BookingError[]
  /**
   * Contiene elementos obligatorios y opcionales para realizar una solicitud de reserva.
   */
  request?: CreateBookingOptions
}
