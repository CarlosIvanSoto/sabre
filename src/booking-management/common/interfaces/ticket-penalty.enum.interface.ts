const TICKET_PENALTY_TYPE = {
  Changeable: "Changeable",
  Either: "Either",
  Refundable: "Refundable"
} as const

export type TicketPenaltyTypeEnum = keyof typeof TICKET_PENALTY_TYPE;