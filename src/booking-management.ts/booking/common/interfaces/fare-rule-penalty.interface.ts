import { Value } from "./value.interface"
/**
 * Identifica el tipo de aplicabilidad asociado con una penalización de regla tarifaria particular.
 *
 * example: BEFORE_DEPARTURE
 */
const FARE_RULE_PENALTY_APPLICABILITY =  {
  BEFORE_DEPARTURE: "BEFORE_DEPARTURE",
  AFTER_DEPARTURE: "AFTER_DEPARTURE",
} as const

type FareRulePenaltyApplicabilityEnum = keyof typeof FARE_RULE_PENALTY_APPLICABILITY
/**
 * Contiene información sobre sanciones aplicadas a reglas de tarifas específicas.
 */
export interface FareRulePenalty {
  /**
   * Identifica si se aplica una penalización antes o después de la salida.
   */
  applicability: FareRulePenaltyApplicabilityEnum
  /**
   * Si es "verdadero", se aplican restricciones adicionales.
   *
   * default: False
   * example: False
   */
  conditionsApply?: boolean
  /**
   * Contiene el coste total de la sanción.
   */
  penalty: Value
}