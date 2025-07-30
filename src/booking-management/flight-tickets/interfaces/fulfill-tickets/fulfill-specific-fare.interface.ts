import { FlightReference } from "../../../booking/common/interfaces"

/**
 * Contains a desired fare basis code with complete auto-pricing validation and associated flights.
 */
export interface FulFillSpecificFare {
    /** 
    * example:ABCDE
    * The fare basis code.
    */
    fareBasisCode: string
    /**
     * Lists flights associated with the brand code referenced by their itemId.
     */
    flights?: FlightReference[]
}