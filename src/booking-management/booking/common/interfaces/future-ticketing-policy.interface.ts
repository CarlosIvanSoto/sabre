/**
 * Contiene un acuerdo detallado de entradas para una fecha futura.
 */
export interface FutureTicketingPolicy {
  /**
   * Se utiliza para especificar un código de pseudociudad.
   *
   * pattern: ^[A-Z0-9]{3,4}$
   * example: G7RE
   */
  ticketingPcc?: string
  /**
   * Se utiliza para especificar un número de cola.
   *
   * example: 55
   */
  queueNumber?: string
  /**
   * La fecha de emisión del billete.
   *
   * format: date
   * example: 2019-07-09
   */
  ticketingDate?: string
  /**
   * La hora de emisión del billete en formato `HH:MM`.
   *
   * pattern: ^([0-1][0-9]|2[0-3]):[0-5][0-9]$
   * example: 11:00
   */
  ticketingTime?: string
  /**
   * Comentario de texto libre.
   *
   * example: TICKET BEFORE TUES
   */
  comment?: string
}