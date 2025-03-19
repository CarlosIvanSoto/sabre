import { FutureTicketingPolicy, GenericAddress } from "../../common/interfaces"
/**
 * Identifica información general sobre la fecha del billete de reserva.
 *
 * example: TODAY
 */
const TICKETING_POLICY = {
  TODAY: "TODAY",
  ALREADY_TICKETED: "ALREADY_TICKETED",
  FUTURE_TICKETING: "FUTURE_TICKETING",
  TICKETING_TIME_LIMIT: "TICKETING_TIME_LIMIT",
} as const

type TicketingPolicyEnum = keyof typeof TICKETING_POLICY
/**
 * Contiene información de la agencia para la reserva.
 */
export interface Agency {
  /**
   * Contiene información de dirección.
   */
  address?: GenericAddress
  /**
   * Envía información general sobre la fecha de emisión del billete de la reserva.
   */
  ticketingPolicy?: TicketingPolicyEnum
  /**
   * Contiene un acuerdo detallado de entradas para una fecha futura.
   */
  futureTicketingPolicy?: FutureTicketingPolicy
  /**
   * Contiene información necesaria para solicitar políticas de límite de tiempo para tickets. Esto lo utilizan las agencias de viajes para solicitar que la primera aerolínea en la reserva aérea emita los billetes.
   */
  ticketingTimeLimitPolicy?: TicketingTimeLimitPolicy
  /**
   * Contiene el número DK del cliente de la agencia. Puede ser una cadena de seis, siete o 10 caracteres.
   *
   * pattern: ^[0-9A-Z]{6}([1-9A-Z*]{1}|[0-9A-Z]{4})?$
   * example: 1234567
   */
  agencyCustomerNumber?: string
}
/**
 * Contiene información necesaria para solicitar políticas de límite de tiempo para tickets. Esto lo utilizan las agencias de viajes para solicitar que la primera aerolínea en la reserva aérea emita los billetes.
 */
interface TicketingTimeLimitPolicy {
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea comercializadora.
   *
   * example: AA
   */
  airlineCode?: string
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
}