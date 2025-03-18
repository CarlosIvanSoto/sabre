import { FareRulePenalty } from "../../booking/common/interfaces/fare-rule-penalty.interface"
import { Tax } from "../../booking/common/interfaces/tax.interface"
import { TotalValues } from "./total-values.interface"
import { Value } from "../../booking/common/interfaces/value.interface"

/**
 * Contiene información detallada sobre la elegibilidad de cancelación y montos reembolsables para un boleto sencillo.
 */
export interface Ticket {
  /**
   * El número de billete de vuelo electrónico.
   *
   * pattern: ^[0-9A-Z/-]+$
   * example: 0167489825830
   */
  number?: string
  /**
   * De ser “verdadero”, el documento electrónico cumple con los requisitos para el procedimiento de nulidad.
   *
   * example: True
   */
  isVoidable?: boolean
  /**
   * Si es "verdadero", el documento electrónico es reembolsable total o parcialmente. Consulte la matriz `refundPenalties` para obtener más información. Si el parámetro de fuente de penalización indica "Categoría 16", no se garantiza el reembolso.
   *
   * example: True
   */
  isRefundable?: boolean
  /**
   * Si es "verdadero", el documento electrónico cumple con los requisitos para un reembolso automático.
   *
   * example: True
   */
  isAutomatedRefundsEligible?: boolean
  /**
   * Enumera los detalles de la penalización asociados con un reembolso.
   */
  /**
   * Contiene información sobre multas que se aplica a reglas de tarifas específicas.
   */
  refundPenalties?: PenaltyItem[]
  /**
   * Muestra información fiscal asociada con un reembolso. Aplicable únicamente a reembolsos automatizados.
   */
  /**
   * Contiene los códigos de impuestos deseados y sus montos anulados.
   */
  refundTaxes?: Tax[]
  /**
   * Contiene información detallada sobre los importes reembolsables de un billete.
   */
  refundTotals?: TotalValues
  /**
   * De ser “verdadero”, la tarifa se podrá canjear con o sin costo adicional. Consulte la matriz `exchangePenalties` para obtener más información. Si el parámetro de fuente de penalización indica "Categoría 16", no se garantiza la intercambiabilidad.
   *
   * example: True
   */
  isChangeable?: boolean
  /**
   * Enumera los detalles de las penalizaciones asociadas con un intercambio de tarifas.
   */
  /**
   * Contiene información sobre sanciones aplicadas a reglas de tarifas específicas.
   */
  exchangePenalties?: PenaltyItem[]
}
/**
 * Identifica una categoría de tarifa ATPCO particular como fuente de información sobre multas.
 *
 * example: Category 33
 * default: Unknown
 */
enum PenaltySourceEnum {
  'Category 33',
  'Category 31',
  'Category 16',
  Unknown
}
/**
 * Contiene información sobre multas que se aplica a reglas de tarifas específicas.
 */
interface PenaltyItem extends FareRulePenalty {
  /**
   * Si es "verdadero", se le cobrará al viajero con billete en caso de que no se presente al vuelo.
   *
   * example: True
   */
  hasNoShowCost?: boolean
  /**
   * La información sobre multas por no presentarse se aplicó a reglas de tarifas específicas.
   */
  noShowPenalty?: NonShowPenalty
  /**
   * Identifica la fuente de información sobre sanciones.
   */
  source?: PenaltySourceEnum
}
/**
 * Contiene información sobre multas que se aplica a reglas de tarifas específicas.
 */
interface NonShowPenalty {
  /**
   * Contiene el coste total de la sanción.
   */
  penalty?: Value
  /**
   * Identifica la fuente de información sobre sanciones.
   */
  source?: PenaltySourceEnum
}
