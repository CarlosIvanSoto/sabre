import { BaggagePolicy } from "./baggage-policy.interface"

/**
 * Contiene el número de equipaje permitido que está incluido en el precio del billete.
 */
export interface BaggageAllowance {
  /**
   * Número máximo de piezas de equipaje permitidas.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  maximumPieces?: number
  /**
   * Peso resumen máximo de todo el equipaje permitido medido en libras [lb].
   *
   * format: int32
   * minimum: 1
   * example: 50
   */
  totalWeightInPounds?: number
  /**
   * Peso resumen máximo de todo el equipaje permitido medido en kilogramos [kg].
   *
   * format: int32
   * minimum: 1
   * example: 23
   */
  totalWeightInKilograms?: number
  /**
   * Enumera las políticas de franquicia de equipaje para cada tipo de equipaje.
   */
  /**
   * Contiene restricciones aplicadas sobre la cantidad de piezas de equipaje y tarifa opcional aplicable.
   */
  baggagePieces?: BaggagePolicy[]
}
