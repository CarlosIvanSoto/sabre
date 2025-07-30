import { FlightReference } from "../../../booking/common/interfaces"

/**
 * Contains baggage allowance information (either its weight or the number of pieces) and associated flights.
 */
export interface FulFillBaggageAllowance{
    /** 
     * minimun: 1
     * example: 23
     * The total weight of baggage measured in kilograms [kg]. Mutually exclusive with the baggagePieces property.
    */
   totalWeightInKilograms?: BigInteger
   /** 
    * minimun: 1
    * example: 1
    * The total number of baggage pieces. Mutually exclusive with the totalWeightInKilograms property. 
   */
   baggagePieces?: BigInteger
   /** 
    * Lists flights associated with the brand code referenced by their itemId.
    */ 
   flights?: FlightReference[]

}