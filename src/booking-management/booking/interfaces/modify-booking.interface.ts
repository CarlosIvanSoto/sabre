import { BookingError, BookingSourceEnum } from "../../common/interfaces"
import { Booking } from "./booking.interface"
import { BookingToModify } from "./modify-booking"

/**
 * Contiene elementos obligatorios y opcionales para modificar una reserva.
 */
export interface ModifyBookingOptions {
  /**
   * El identificador único de una reserva, obtenido mediante el método Get Booking. Se utiliza para verificar el estado de la reserva antes de una operación de modificación.
   *
   * example: 76c2817b178cc264fa44cf85df1da5fb9e1b963006b2339aa5edc09129415bba5fcf5bf91a5f3031
   */
  bookingSignature: string
  /**
   * El ID de referencia de la reserva como se muestra en el sistema de proveedor/vendedor de origen.
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
   * Si es "verdadero", la respuesta incluye el estado actual de la reserva.
   *
   * example: True
   * default: False
   */
  retrieveBooking?: boolean
  /**
   * La entidad que autoriza los cambios en una reserva.
   *
   * example: Booking Management API testing
   * default: Modify Booking
   */
  receivedFrom?: string
  /**
   * Contiene los detalles de la reserva original antes de la modificación solicitada. Según las diferencias entre las propiedades "antes" y "después", se realizan las operaciones apropiadas de agregar, actualizar o eliminar en la reserva.
   */
  before: BookingToModify
  /**
   * Contiene los detalles de la reserva que se desean aplicar como resultado de la modificación solicitada. Según las diferencias entre las propiedades "antes" y "después", se realizan las operaciones apropiadas de agregar, actualizar o eliminar en la reserva.
   */
  after: BookingToModify
  /**
   * Especifica el valor del código de pseudociudad deseado. La API no revierte el contexto después de completar la reserva.
   *
   * pattern: ^[A-Z0-9]{3,4}$
   * example: AAA
   */
  targetPcc?: string
}

/**
 * Contiene la respuesta del servicio Modificar Reserva.
 */
export interface ModifyBookingResponseSuccess {
  /**
   * Proporciona el momento exacto en el que se generó la respuesta. La marca de tiempo se expresa en UTC y se presenta en el formato AAAA-MM-DDTHH:MM:SSZ.
   *
   * format: date-time
   * example: 2020-10-28T11:11:21Z
   */
  timestamp?: string
  /**
   * Contiene información sobre la reserva modificada.
   */
  booking?: Booking
  /**
   * Muestra información detallada sobre los errores. Esta matriz no se muestra en las respuestas exitosas.
   */
  errors?: BookingError[]
  /**
   * Contiene una copia de la solicitud original.
   */
  request?: ModifyBookingOptions
}