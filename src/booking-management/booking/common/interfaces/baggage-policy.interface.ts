import { Value } from "./value.interface"
/**
 * Contiene restricciones aplicadas sobre la cantidad de piezas de equipaje y tarifa opcional aplicable.
 */
export interface BaggagePolicy {
  /**
   * Tamaño máximo permitido de la pieza de equipaje medido en pulgadas [in]. Si es nulo, no se especifica ningún límite de tamaño para este tipo de equipaje.
   *
   * format: int32
   * minimum: 1
   * example: 46
   */
  maximumSizeInInches?: number
  /**
   * Tamaño máximo permitido de la pieza de equipaje medido en centímetros [cm]. Si es nulo, no se especifica ningún límite de tamaño para este tipo de equipaje.
   *
   * format: int32
   * minimum: 1
   * example: 118
   */
  maximumSizeInCentimeters?: number
  /**
   * Peso máximo permitido de la pieza de equipaje medido en libras [lb]. En caso nulo, no se especifica ningún límite de peso para este tipo de equipaje.
   *
   * format: int32
   * minimum: 1
   * example: 50
   */
  maximumWeightInPounds?: number
  /**
   * Peso máximo permitido de la pieza de equipaje medido en kilogramos [kg]. En caso nulo, no se especifica ningún límite de peso para este tipo de equipaje.
   *
   * format: int32
   * minimum: 1
   * example: 23
   */
  maximumWeightInKilograms?: number
  /**
   * La cantidad de piezas permitidas dentro de la política de equipaje.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  numberOfPieces: number
  /**
   * La descripción de los artículos de equipaje especial permitidos, si la política de equipaje proporciona información sobre artículos de equipaje especial como instrumentos musicales, equipos de pesca o deportivos, dispositivos de movilidad, etc.
   *
   * pattern: ^[A-Za-z ]{3,}$
   * example: SKI EQUIPMENT
   */
  specialItemDescription?: string
  /**
   * Si es "verdadero", las restricciones de equipaje tienen únicamente fines informativos. El equipaje está disponible para su compra durante el check-in en el aeropuerto.
   *
   * example: True
   */
  isCheckInOnly?: boolean
  /**
   * Tarifa aplicable por cada pieza de equipaje. En caso nulo, no se requiere pago alguno por este tipo de equipaje.
   */
  fee?: Value
}