/**
 * El proveedor que proporciona el servicio auxiliar.
 *
 * example: ATPCO
 */
const ANCILLARY_SOURCE = {
  ATPCO: "ATPCO",
  MERCHANDISING_MANAGER: "MERCHANDISING_MANAGER",
} as const

export type AncillarySourceEnum = keyof typeof ANCILLARY_SOURCE;