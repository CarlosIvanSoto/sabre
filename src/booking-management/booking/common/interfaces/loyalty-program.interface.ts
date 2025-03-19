/**
 * Identifica el tipo de programa de fidelización.
 *
 * example: FREQUENT_FLYER
 * default: FREQUENT_FLYER
 */
const PROGRAM_TYPE = {
  FREQUENT_FLYER: "FREQUENT_FLYER",
  FREQUENT_RENTER: "FREQUENT_RENTER",
  LOYALTY_ID: "LOYALTY_ID",
} as const

type ProgramTypeEnum = keyof typeof PROGRAM_TYPE;
/**
 * Contiene detalles del programa de fidelización del pasajero, como una tarjeta de viajero frecuente.
 */
export interface LoyaltyProgram {
  /**
   * El código de dos letras que emitió el número, como el código de aerolínea IATA.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  supplierCode?: string
  /**
   * Contiene códigos de tipo de programa de fidelización.
   */
  programType?: ProgramTypeEnum
  /**
   * El número de membresía de viajero para el programa de fidelización, como el número de viajero frecuente.
   *
   * example: 987654321
   */
  programNumber: string
  /**
   * El nivel alcanzado por el viajero en el programa de fidelización.
   *
   * format: int32
   * example: 3
   */
  tierLevel?: number
  /**
   * El código del receptor de dos letras, como el código de aerolínea IATA.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: UA
   */
  receiverCode?: string
}