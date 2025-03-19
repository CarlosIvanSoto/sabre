/**
 * Identifica la política de pago del hotel.
 *
 * example: DEPOSIT
 */
const HOTEL_PAYMENT_POLICY = {
  DEPOSIT: "DEPOSIT",
  GUARANTEE: "GUARANTEE",
  LATE: "LATE",
} as const

export type HotelPaymentPolicyEnum = keyof typeof HOTEL_PAYMENT_POLICY