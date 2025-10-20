import type { components } from "./booking-management.interface"

export type CancelBookingOptions = components["schemas"]["CancelBookingRequest"]
export type CancelBookingResponseSuccess =
  components["schemas"]["CancelBookingResponse"]

export type CreateBookingOptions =
  components["schemas"]["CreateBookingRequest"]
export type CreateBookingResponseSuccess =
  components["schemas"]["CreateBookingResponse"]

export type GetBookingOptions = components["schemas"]["GetBookingRequest"]
export type GetBookingResponseSuccess =
  components["schemas"]["GetBookingResponse"]

export type ModifyBookingOptions =
  components["schemas"]["ModifyBookingRequest"]
export type ModifyBookingResponseSuccess =
  components["schemas"]["ModifyBookingResponse"]

export type CheckTicketsOptions = components["schemas"]["CheckTicketsRequest"]
export type CheckTicketsResponseSuccess =
  components["schemas"]["CheckTicketsResponse"]

export type FulfillTicketsOptions =
  components["schemas"]["FulfillTicketsRequest"]
export type FulfillTicketsResponseSuccess =
  components["schemas"]["FulfillTicketsResponse"]

export type RefundTicketsOptions = components["schemas"]["RefundTicketsRequest"]
export type RefundTicketsResponseSuccess =
  components["schemas"]["RefundTicketsResponse"]

export type VoidTicketsOptions = components["schemas"]["VoidTicketsRequest"]
export type VoidTicketsResponseSuccess =
  components["schemas"]["VoidTicketsResponse"]