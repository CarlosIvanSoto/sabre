/**
 * Identifica el tipo asociado con la observación particular.
 *
 * example: GENERAL
 */
const REMARK_TYPE = {
  GENERAL: 'GENERAL',
  HISTORICAL: 'HISTORICAL',
  CLIENT_ADDRESS: 'CLIENT_ADDRESS',
  ALPHA_CODED: 'ALPHA_CODED',
  DELIVERY_ADDRESS: 'DELIVERY_ADDRESS',
  ITINERARY: 'ITINERARY',
  INVOICE: 'INVOICE',
  HIDDEN: 'HIDDEN',
  CORPORATE: 'CORPORATE',
  FORM_OF_PAYMENT: 'FORM_OF_PAYMENT',
  PRINT_ON_TICKET: 'PRINT_ON_TICKET',
  FILLER_STRIP: 'FILLER_STRIP',
  INTERFACE: 'INTERFACE',
  QUEUE_PLACE: 'QUEUE_PLACE',
} as const

type RemarkTypeEnum = keyof typeof REMARK_TYPE;
/**
 * Contiene comentario agregado al PNR.
 */
export interface Remark {
  /**
   * El tipo de comentario agregado al PNR.
   */
  type?: RemarkTypeEnum
  /**
   * La codificación de caracteres con tipo de comentario ALPHA_CODED agregada al PNR.
   *
   * pattern: ^[A-Z]$
   * example: T
   */
  alphaCode?: string
  /**
   * El texto original del comentario añadido al PNR.
   *
   * example: XXATW/
   */
  text?: string
}
