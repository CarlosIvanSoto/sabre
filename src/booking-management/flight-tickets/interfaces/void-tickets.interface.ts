import { BookingError, CancelErrorPolicyEnum, Notification, PrinterAddress } from "../../common/interfaces"
/**
 * Contiene elementos requeridos y opcionales para anular boletos.
 */
export interface VoidTicketsOptions {
  /**
   * Política de gestión de errores por parte del servicio de Cancelación de Reserva.
   */
  errorHandlingPolicy?: CancelErrorPolicyEnum
  /**
   * El pseudocódigo de ciudad del destino objetivo para el que se solicita la anulación del billete.
   *
   * pattern: ^[A-Z0-9]{3,4}$
   * example: G7HE
   */
  targetPcc?: string
  /**
   * Enumera los números de documentos de boletos o EMD que deben anularse. Puede contener hasta 12 elementos.
   */
  /**
   * El número de documento electrónico del billete que se desea anular.
   *
   * pattern: ^[0-9A-Z]{13}(/[0-9]{2})?$
   * example: 0167489825830
   */
  tickets?: string[]
  /**
   * La entidad que autoriza los cambios en un registro de nombre de pasajero.
   *
   * example: Booking Management API testing
   */
  receivedFrom?: string
  /**
   * Contiene acciones que se realizarán después de la creación de la reserva. Actualmente, puede elegir queuePlacement o notificación por correo electrónico. No es posible combinar ambos. Además, para fines de creación de reservas, solo se admite la notificación por correo electrónico "DEFAULT".
   */
  notification?: Notification
  /**
   * Enumera las impresoras o el perfil de impresora que se designará.
   */
  designatePrinters?: PrinterAddress[]
  /**
   * El ID de referencia de la reserva como se muestra en el proveedor de origen o en el sistema del proveedor.
   *
   * pattern: ^[A-Z0-9]{6,}$
   * example: GLEBNY
   */
  confirmationId?: string
}

/**
 * Contiene información de boletos anulados.
 */
export interface VoidTicketsResponseSuccess {
  /**
   * Proporciona el momento exacto en el que se generó la respuesta. La marca de tiempo se expresa en UTC y se presenta en el formato AAAA-MM-DDTHH:MM:SSZ.
   *
   * format: date-time
   * example: 2020-10-28T11:11:21Z
   */
  timestamp?: string
  /**
   * Copia de la solicitud.
   */
  request?: VoidTicketsOptions
  /**
   * Muestra información detallada sobre los errores. Esta matriz no se muestra en las respuestas exitosas.
   */
  errors?: BookingError[]
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
}
