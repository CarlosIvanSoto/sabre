import { CancelErrorPolicyEnum, Notification, PrinterAddress, Ticket } from "../../common/interfaces"
import { Booking } from "./booking.interface"
import { BookingSourceEnum, CarReference, CruiseReference, FlightReference, HotelReference, TrainReference } from "../common/interfaces"

/**
 * Identifica la política para el manejo de las operaciones de boletos aéreos dentro del servicio Cancelar Reserva.
 *
 * example: VOID
 */
const FLIGHT_TICKET_OPERATION = {
  VOID: 'VOID',
  REFUND: 'REFUND',
} as const
type FlightTicketOperationEnum = keyof typeof FLIGHT_TICKET_OPERATION
/**
 * Contiene elementos obligatorios y opcionales para cancelar una reserva.
 */
export interface CancelBookingOptions {
  /**
   * El ID de referencia de la reserva como se muestra en el sistema de proveedor/vendedor de origen. Para "SABRE", este es el valor del localizador de PNR.
   *
   * pattern: ^[A-Z0-9]{6,}$
   * example: GLEBNY
   * xml: {'attribute': True}
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
   * La entidad que autoriza los cambios en un registro de nombre de pasajero.
   *
   * example: Booking Management API testing
   */
  receivedFrom?: string
  /**
   * Identifica la política para el manejo de las operaciones de boletos aéreos dentro del servicio Cancelar Reserva.
   */
  flightTicketOperation?: FlightTicketOperationEnum
  /**
   * Identifica la política para el manejo de errores dentro del servicio Cancelar Reserva.
   */
  errorHandlingPolicy?: CancelErrorPolicyEnum
  /**
   * De ser cierto, se cancelarán de la reserva segmentos de todo tipo. Se ignoran vuelos, hoteles, automóviles, trenes, cruceros y todos los demás segmentos incluidos en la respuesta.
   *
   * example: False
   * default: False
   */
  cancelAll?: boolean
  /**
   * Enumera los vuelos que deberían cancelarse.
   */
  /**
   * Contiene la referencia del objeto de vuelo por "itemId".
   */
  flights?: FlightReference[]
  /**
   * Enumera los hoteles que deberían cancelarse.
   */
  /**
   * Contiene la referencia del objeto de hotel por "itemId".
   */
  hotels?: HotelReference[]
  /**
   * Enumera los coches que deberían cancelarse.
   */
  /**
   * Contiene la referencia del objeto de automóvil mediante "itemId".
   */
  cars?: CarReference[]
  /**
   * Enumera los trenes que deberían cancelarse.
   */
  /**
   * Contiene la referencia del objeto de tren por "itemId".
   */
  trains?: TrainReference[]
  /**
   * Enumera los cruceros que deberían cancelarse.
   */
  /**
   * Contiene una referencia de objeto de crucero por "itemId".
   */
  cruises?: CruiseReference[]
  /**
   * Enumera los elementos que deben cancelarse.
   */
  /**
   * Contiene una referencia al segmento a cancelar, identificado por "secuencia" o por "id".
   */
  segments?: Segment[]
  /**
   * El pseudocódigo de ciudad del destino de destino.
   *
   * pattern: ^[A-Z0-9]{3,4}$
   * example: G7HE
   */
  targetPcc?: string
  /**
   * Contiene acciones que se realizarán después de la creación de la reserva. Actualmente, puede elegir queuePlacement o notificación por correo electrónico. No es posible combinar ambos. Además, para fines de creación de reservas, solo se admite la notificación por correo electrónico "DEFAULT".
   */
  notification?: Notification
  /**
   * Enumera las impresoras o el perfil de impresora que se designará.
   */
  designatePrinters?: PrinterAddress[]
  /**
   * Contiene el ID de una oferta anulada o de reembolso disponible según checkFlightTicketsResponse para los boletos que pertenecen al ID de confirmación solicitado. Aplicable únicamente para pedidos NDC.
   *
   * example: cb7778589bcbklg7tkkp8sdo50
   */
  offerItemId?: string
}
/**
 * Contiene información de reserva.
 */
export interface CancelBookingResponseSuccess {
  /**
   * Proporciona el momento exacto en el que se generó la respuesta. La marca de tiempo se expresa en UTC y se presenta en el formato AAAA-MM-DDTHH:MM:SSZ.
   *
   * format: date-time
   * example: 2020-10-28T11:11:21Z
   */
  timestamp?: string
  /**
   * Contiene una copia de la solicitud original.
   */
  request?: CancelBookingOptions
  /**
   * Contiene información sobre la reserva restante después de la cancelación.
   */
  booking?: Booking
  /**
   * Muestra información sobre la elegibilidad de cancelación 
   * y los montos reembolsables por boleto en el orden de la solicitud.
   */
  tickets?: Ticket[]
  /**
   * Muestra información detallada sobre los errores. Esta matriz no se muestra en las respuestas exitosas.
   */
  errors?: Error[]
  /**
   * Enumera todos los boletos anulados exitosamente.
   */
  /**
   * El número de un billete anulado con éxito.
   *
   * pattern: ^[0-9A-Z\/-]+$
   * example: 0017544536141
   */
  voidedTickets?: string[]
  /**
   * Enumera todos los boletos reembolsados ​​exitosamente.
   */
  /**
   * El número de un billete reembolsado correctamente.
   *
   * pattern: ^[0-9A-Z\/-]+$
   * example: 0017544536141
   */
  refundedTickets?: string[]
}
/**
 * Contiene una referencia al segmento a cancelar, identificado por "secuencia" o por "id".
 *
 * xml: {'name': 'Segment', 'namespace': 'http://services.sabre.com/sp/cancelbooking/v1'}
 */
interface Segment {
  /**
   * Identifica la secuencia del número de segmento.
   *
   * format: int32
   * example: 1
   * xml: {'attribute': True}
   */
  sequence?: number
  /**
   * La identificación única del artículo para el segmento que se cancelará.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 12
   * xml: {'attribute': True}
   */
  id?: string
}
