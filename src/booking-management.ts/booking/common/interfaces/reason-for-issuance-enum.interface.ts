/**
 * Especifica el motivo definido por IATA para el código de emisión (RFIC) aplicable al Documento misceláneo electrónico (EMD) que se emitirá para el subcódigo identificado en este registro. La opción DESCONOCIDA se utiliza con fines de solo lectura por parte de getBooking API.
 *
 * example: BAGGAGE
 */
const REASON_FOR_ISSUANCE = {
  AIR_TRANSPORTATION: "AIR_TRANSPORTATION",
  SURFACE_TRANSPORTATION_NON_AITRANSPORTS: "SURFACE_TRANSPORTATION_NON_AITRANSPORTS",
  BAGGAGE: "BAGGAGE",
  FINANCIAL_IMPACT: "FINANCIAL_IMPACT",
  AIRPORT_SERVICES: "AIRPORT_SERVICES",
  MERCHANDISE: "MERCHANDISE",
  INFLIGHT_SERVICES: "INFLIGHT_SERVICES",
  INDIVIDUAL_AIRLINE_USE: "INDIVIDUAL_AIRLINE_USE",
  UNKNOWN: "UNKNOWN",
} as const

export type ReasonForIssuanceEnum = keyof typeof REASON_FOR_ISSUANCE;