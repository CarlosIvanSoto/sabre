/**
 * Identifica el estado actual del ticket.
 *
 * example: Issued
 */
enum TICKET_STATUS_ENUM {
  Issued,
  Voided,
  'Refunded/Exchanged'
}

export type TicketStatusEnum = keyof typeof TICKET_STATUS_ENUM