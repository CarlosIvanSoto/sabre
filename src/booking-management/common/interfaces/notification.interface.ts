import { Queue } from "../../booking/common/interfaces/queue.interface"

/**
 * Identifica el método de notificación por correo electrónico. `DEFAULT` envía una notificación por correo electrónico predeterminada según la configuración de la agencia/PCC. "FACTURA" envía un correo electrónico con una copia de la factura electrónica, "ETICKET" envía un correo electrónico con una copia de texto del boleto electrónico y "ITINERARIO" envía un correo electrónico con una copia de texto del itinerario.
 *
 * example: INVOICE
 */
const NOTIFICATION_EMAIL = {
  DEFAULT: "DEFAULT",
  INVOICE: "INVOICE",
  ETICKET: "ETICKET",
  ETICKET_PDF: "ETICKET_PDF",
  ITINERARY: "ITINERARY",
  ITINERARY_PDF: "ITINERARY_PDF",
} as const
type NotificationEmailEnum = keyof typeof NOTIFICATION_EMAIL
/**
 * Contiene las acciones que se realizarán después de completar la acción solicitada (creación de reserva/anulación de billete o reembolso).
 */
export interface Notification {
  /**
   * Identifica el método de notificación por correo electrónico. `DEFAULT` envía una notificación por correo electrónico predeterminada según la configuración de la agencia/PCC. "FACTURA" envía un correo electrónico con una copia de la factura electrónica, "ETICKET" envía un correo electrónico con una copia de texto del boleto electrónico y "ITINERARIO" envía un correo electrónico con una copia de texto del itinerario.
   */
  email?: NotificationEmailEnum
  /**
   * Enumera la cola específica (hasta tres) en la que colocar el PNR para la operación.
   *
   * minItems: 1
   * maxItems: 3
   */
  /**
   * Contiene detalles de una cola.
   */
  queuePlacement?: Queue[]
}