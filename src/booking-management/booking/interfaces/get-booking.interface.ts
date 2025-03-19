import { BookingError } from "../../common/interfaces";
import { Booking } from "./booking.interface";
import { BookingSourceEnum } from "../common/interfaces";

/**
 * Identifica la porción de datos que se devolverán.
 *
 * example: FLIGHTS
 */
const RETURN_ONLY = {
  FLIGHTS: 'FLIGHTS',
  FLIGHT_PENALTY: 'FLIGHT_PENALTY',
  BAGGAGE_POLICY: 'BAGGAGE_POLICY',
  JOURNEYS: 'JOURNEYS',
  HOTELS: 'HOTELS',
  HOTEL_ADDRESS: 'HOTEL_ADDRESS',
  CARS: 'CARS',
  CAR_RENTAL_ADDRESS: 'CAR_RENTAL_ADDRESS',
  CAR_RENTAL_PENALTY: 'CAR_RENTAL_PENALTY',
  TRAINS: 'TRAINS',
  CRUISES: 'CRUISES',
  ALL_SEGMENTS: 'ALL_SEGMENTS',
  TRAVELERS: 'TRAVELERS',
  TICKETS: 'TICKETS',
  PAYMENTS: 'PAYMENTS',
  PENALTIES: 'PENALTIES',
  REMARKS: 'REMARKS',
  IS_CANCELABLE: 'IS_CANCELABLE',
  IS_TICKETED: 'IS_TICKETED',
  CONTACT_INFO: 'CONTACT_INFO',
  OTHETRANSPORTS: 'OTHETRANSPORTS',
  SPECIAL_SERVICES: 'SPECIAL_SERVICES',
  FARES: 'FARES',
  CREATION_DETAILS: 'CREATION_DETAILS',
  ANCILLARIES: 'ANCILLARIES',
  FORMS_OF_PAYMENT: 'FORMS_OF_PAYMENT'
} as const

type ReturnOnlyEnum = keyof typeof RETURN_ONLY;
/**
 * Contiene elementos tanto obligatorios como opcionales para realizar una solicitud de reserva.
 */
export interface GetBookingOptions {
  /**
   * El ID de referencia de la reserva como se muestra en el sistema de proveedor/vendedor de origen. 
   * Para "SABRE", este es el valor del localizador de PNR.
   *
   * pattern: ^[A-Z0-9]{6,}$
   * example: GLEBNY
   */
  confirmationId: string
  /**
   * Identifica el origen de la reserva. El valor predeterminado es `SABRE`.
   */
  bookingSource?: BookingSourceEnum
  /**
   * El nombre del viajero.
   *
   * example: John
   */
  givenName?: string
  /**
   * El segundo nombre o la inicial del segundo nombre del viajero.
   *
   * example: W
   */
  middleName?: string
  /**
   * El apellido del viajero.
   *
   * example: Smith
   */
  surname?: string
  /**
   * Enumera las secciones de respuesta que devuelve el servicio. 
   * Si esta lista está vacía o no se proporciona, se devuelve la estructura completa. 
   * Al utilizar esta opción, la aplicación puede excluir o simplificar las llamadas de API 
   * de línea descendente, lo que generalmente resulta en un aumento significativo del rendimiento.
   */
  /**
   * Identifica la porción de datos que se devolverán.
   */
  returnOnly?: ReturnOnlyEnum[]
  /**
   * Contiene un conjunto de funciones adicionales cuyo uso requiere una indicación explícita para mantener la compatibilidad con versiones anteriores. Estas funcionalidades se incorporarán sin problemas en una futura versión principal de esta API.
   */
  extraFeatures?: ExtraFeatures
  /**
   * Si es verdadero, la aplicación desenmascara la información de la tarjeta de pago almacenada en la reserva. 
   * Para mostrar estos datos, el Registro de perfil del empleado (EPR) debe incluir la palabra clave CCVIEW.
   *
   * example: False
   */
  unmaskPaymentCardNumbers?: boolean
}
/**
 * Contiene un objeto de respuesta de servicio con información de reserva.
 */
export interface GetBookingResponseSuccess extends Booking {
  /**
   * Proporciona el momento exacto en el que se generó la respuesta. La marca de tiempo se expresa en UTC y se presenta en el formato AAAA-MM-DDTHH:MM:SSZ.
   *
   * format: date-time
   * example: 2020-10-28T11:11:21Z
   */
  timestamp?: string
  /**
   * El ID único de la respuesta Obtener reserva. Se utiliza para verificar el estado de la reserva durante la operación de modificación.
   *
   * example: 76c2817b178cc264fa44cf85df1da5fb9e1b963006b2339aa5edc09129415bba5fcf5bf91a5f3031
   */
  bookingSignature?: string
  /**
   * Copia del objeto de solicitud de servicio.
   */
  request?: GetBookingOptions
  /**
   * Muestra información detallada sobre los errores. Esta matriz no se muestra en las respuestas exitosas.
   */
  errors?: BookingError[]
}

/**
 * Contiene un conjunto de funciones adicionales cuyo uso requiere una indicación explícita para mantener la compatibilidad con versiones anteriores. Estas funcionalidades se incorporarán sin problemas en una futura versión principal de esta API.
 */
interface ExtraFeatures {
  /**
   * Si es "verdadero", se admite el tipo de programa de fidelización adicional "FREQUENT_RENTER".
   *
   * default: False
   */
  returnFrequentRenter?: boolean,
  /**
   * default: true
   */
  returnEmptySeatObjects?: boolean,
  /**
   * default: false
   */
  returnFiscalId?: boolean,
  /**
   * default: false
   */
  returnWalletFormsOfPayment?: boolean,
}