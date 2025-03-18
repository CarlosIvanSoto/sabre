import { TotalValues } from "../../../common/interfaces";
import { Commission, CouponStatus, FlightReference } from "../../common/interfaces"
/**
 * Identifica el estado actual del ticket.
 *
 * example: Issued
 */
enum TicketStatusEnum {
  Issued,
  Voided,
  'Refunded/Exchanged'
}
/**
 * Contiene información del billete de avión electrónico para el viajero.
 */
export interface FlightTicket {
  /**
   * El número de billete de vuelo electrónico.
   *
   * pattern: ^[0-9A-Z/-]+$
   * example: 0167489825830
   */
  number: string
  /**
   * La fecha de emisión del billete de avión electrónico en formato `AAAA-MM-DD`.
   *
   * format: date
   * example: 2019-07-01
   */
  date: string
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea emisora.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  airlineCode: string
  /**
   * Especifica a qué viajero de la lista de viajeros pertenece el billete.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndex: number
  /**
   * Enumera todos los cupones de vuelos reservados y emitidos a los que hace referencia el "itemId" del vuelo.
   */
  /**
   * Contiene información del cupón del vuelo correspondiente, identificado por "itemId", para la reserva dada.
   */
  flightCoupons: FlightReferenceCoupon[]
  /**
   * Enumera todos los cupones de vuelos reservados y emitidos. Se proporciona el "itemId" del vuelo correspondiente, si está disponible. Si un cupón no se puede asociar con ningún vuelo presente en la reserva (por ejemplo, debido a un cambio de horario), el "itemId" está oculto, sin embargo, los detalles del estado del cupón aún se devuelven.
   */
  allCoupons?: TicketCoupon[]
  /**
   * Contiene importes de pago para vuelos emitidos.
   */
  payment: TotalValues
  /**
   * El valor significativo que describe el estado de la reserva, p. Emitido.
   */
  ticketStatusName?: TicketStatusEnum
  /**
   * El código del estado del billete.
   *
   * pattern: ^[A-Z]{1,2}$
   * example: TE
   */
  ticketStatusCode?: string
  /**
   * El pseudocódigo de ciudad de la agencia que emitió el billete o EMD.
   *
   * pattern: ^[A-Z0-9]{3,4}$
   * example: G7HE
   */
  ticketingPcc?: string
  /**
   * Contains the commission amount applicable to the fare or ticket.
   */
  commission?: Commission
}
/**
 * Contiene información del cupón del vuelo correspondiente, identificado por "itemId", para la reserva dada.
 */
interface FlightReferenceCoupon extends FlightReference, CouponStatus {}
/**
 * Contiene detalles del estado del cupón.
 */
interface TicketCoupon extends CouponStatus {
  /**
   * El identificador del vuelo asociado al cupón y almacenado en la reserva.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 12
   */
  itemId?: string
}