/**
 * Identifica el origen de la reserva. El valor predeterminado es `SABRE`.
 *
 * example: SABRE
 */
const BOOKING_SOURCE = {
  SABRE: 'SABRE',
  SABRE_ORDER: 'SABRE_ORDER'
} as const

export type BookingSourceEnum = keyof typeof BOOKING_SOURCE