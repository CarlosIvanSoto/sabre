/**
 * Identifica el género del viajero.
 */
const GENDER = {
  FEMALE: "FEMALE",
  MALE: "MALE",
  INFANT_FEMALE: "INFANT_FEMALE",
  INFANT_MALE: "INFANT_MALE",
  UNDISCLOSED: "UNDISCLOSED",
  UNDEFINED: "UNDEFINED",
} as const

export type GenderEnum = keyof typeof GENDER;