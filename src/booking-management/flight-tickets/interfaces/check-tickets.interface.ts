import { Ticket, TotalValues } from "../../common/interfaces"
import { RefundFlightTicket } from "./refund-flight-ticket.interface"

/**
 * Contiene elementos obligatorios y opcionales para consultar tickets.
 */
export interface CheckTicketsOptions {
  /**
   * El pseudocódigo de ciudad del destino de destino para el que se solicita la verificación del billete.
   *
   * pattern: ^[A-Z0-9]{3,4}$
   * example: G7HE
   */
  targetPcc?: string
  /**
   * Enumera los billetes que deben reembolsarse. Puede contener hasta 12 elementos.
   *
   * minItems: 1
   * maxItems: 12
   */
  tickets?: RefundFlightTicket[]
  /**
   * El ID de referencia de la reserva como se muestra en el proveedor de origen o en el sistema del proveedor.
   *
   * pattern: ^[A-Z0-9]{6,}$
   * example: GLEBNY
   */
  confirmationId?: string
}

/**
 * Contiene información sobre elegibilidad de cancelación y montos reembolsables por boleto.
 */
export interface CheckTicketsResponseSuccess {
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
  request?: CheckTicketsOptions
  /**
   * Muestra información sobre la elegibilidad de cancelación y los montos reembolsables por boleto en el orden de la solicitud.
   */
  tickets?: Ticket[]
  /**
   * Muestra información detallada sobre los errores. Esta matriz no se muestra en las respuestas exitosas.
   */
  errors?: Error[]
  /**
   * Muestra información sobre opciones de cancelación para pedidos NDC.
   */
  cancelOffers?: CancelOffer[]
}
/**
 * Identifica el tipo de oferta de la opción de cancelación.
 *
 * example: VOID
 */
const CANCEL_OFFER_TYPE = {
  VOID: "VOID",
  REFUND: "REFUND",
} as const

type CancelOfferTypeEnum = keyof typeof CANCEL_OFFER_TYPE
/**
 * Contiene información detallada sobre una opción de cancelación específica para un artículo de pedido NDC.
 */
interface CancelOffer {
  /**
   * Identifica el tipo de oferta de la opción de cancelación.
   */
  offerType?: CancelOfferTypeEnum
  /**
   * ID de oferta que hace referencia a la opción de cancelación de un pedido NDC. Esta identificación debe aplicarse al cancelar un pedido para recibir un reembolso o anularlo.
   *
   * example: cb7778589bcbklg7tkkp8sdo50
   */
  offerItemId?: string
  /**
   * La fecha de vencimiento de una oferta de cancelación.
   *
   * format: date
   * example: 2022-01-30
   */
  offerExpirationDate?: string
  /**
   * La hora de vencimiento de una oferta de cancelación en UTC.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 09:25
   */
  offerExpirationTime?: string
  /**
   * Contiene información detallada sobre los importes reembolsables de un pedido.
   */
  refundTotals?: TotalValues
}