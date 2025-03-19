import { FareRulePenalty } from "../../common/interfaces"
/**
 * Contiene requisitos de elegibilidad y restricciones de viaje para un vuelo.
 */
export interface FareRule {
  /**
   * El código de aeropuerto IATA de tres letras del aeropuerto de origen.
   *
   * pattern: ^[A-Z]{3}$
   * example: DFW
   */
  originAirportCode?: string
  /**
   * El código de aeropuerto IATA de tres letras del aeropuerto de destino.
   *
   * pattern: ^[A-Z]{3}$
   * example: ATL
   */
  destinationAirportCode?: string
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea propietaria de la regla de tarifa.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  owningAirlineCode: string
  /**
   * El código ATPCO del tipo de pasajero. Los viajeros aplicables se identifican mediante el código de tipo de pasajero.
   *
   * pattern: ^[A-Z][A-Z0-9]{2}$
   * example: ADT
   */
  passengerCode?: string
  /**
   * Si es "verdadero", la tarifa se puede reembolsar en su totalidad o en segmentos. Consulte la matriz `refundPenalties` para obtener más información.
   *
   * example: True
   */
  isRefundable?: boolean
  /**
   * Enumera las condiciones y pagos para reembolsos de tarifas.
   */
  /**
   * Contiene información sobre sanciones aplicadas a reglas de tarifas específicas.
   */
  refundPenalties?: FareRulePenalty[]
  /**
   * De ser “verdadero”, la tarifa se podrá canjear con o sin costo adicional. Consulte la matriz `exchangePenalties` para obtener más información.
   *
   * example: True
   */
  isChangeable?: boolean
  /**
   * Enumera las condiciones y pagos de los cambios de tarifas. Es posible que se agreguen diferencias de tarifa.
   */
  /**
   * Contiene información sobre sanciones aplicadas a reglas de tarifas específicas.
   */
  exchangePenalties?: FareRulePenalty[]
}