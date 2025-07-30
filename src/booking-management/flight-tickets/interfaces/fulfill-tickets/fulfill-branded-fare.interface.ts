import { FlightReference } from "../../../booking/common/interfaces"

/**
 * Contains a brand code to use for the ticketing operation.
 */
export interface FulFillBrandedFare {
    /**
     * example: CP
     * The desired brand code.
     */
    brandedCode: string
    /**
     * Lists flights associated with the brand code referenced by their itemId.
     */
    flights?: FlightReference[]

}