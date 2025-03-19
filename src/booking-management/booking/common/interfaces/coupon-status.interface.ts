/**
 * Identifica el estado descriptivo del código de estado del cupón correspondiente.
 *
 * example: Printed
 */
enum CouponStatusEnum {
  'Airport Control',
  Lifted,
  'Checked In',
  Exchanged,
  Flown,
  'Not Flown',
  Refunded,
  Voided,
  Printed,
  Okay,
  Reactivated,
  'Irregular Operations',
  'Print Exchange',
  'Paper Ticket',
  Suspended,
  Locked
}
/**
 * Identifica el código de estado del cupón según el conjunto de códigos IATA PADIS 4405.
 *
 * example: PR
 */
const COUPON_STATUS_CODE = {
  AL: "AL",
  BD: "BD",
  CK: "CK",
  E: "E",
  B: "B",
  I: "I",
  RF: "RF",
  V: "V",
  PR: "PR",
  IO: "IO",
  P: "P",
  PE: "PE",
  T: "T",
  S: "S",
  XX: "XX",
} as const

type CouponStatusCodeEnum = keyof typeof COUPON_STATUS_CODE
/**
 * Contiene la información del cupón del billete.
 */
export interface CouponStatus {
  /**
   * El estado actual descriptivo del cupón.
   */
  couponStatus: CouponStatusEnum
  /**
   * El código del estado actual del cupón del billete basado en el conjunto de códigos IATA PADIS 4405.
   */
  couponStatusCode: CouponStatusCodeEnum
}