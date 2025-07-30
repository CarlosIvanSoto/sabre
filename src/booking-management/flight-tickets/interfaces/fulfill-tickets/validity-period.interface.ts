import { FlightReference } from "../../../booking/common/interfaces"

/**
 * Contains the ticket validity period and associated flights.
 */
export interface ValidityPeriod {
    /**
     * example:2024-07-09
     * The start date of the validity period in ISO 8601 format.
     */
    startDate?: string
    /**
     * example:2024-09-19
     * The end date of the validity period in ISO 8601 format.
     */
    endDate?: string
    /** 
     * Lists flights associated with the brand code referenced by their itemId.
    */
    flights?: FlightReference[]

}