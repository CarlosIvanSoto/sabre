import { FareRulePenalty, FareRulePenaltyApplicabilityEnum, Value } from "../../booking/common/interfaces";
import { TicketPenaltyTypeEnum } from "./ticket-penalty.enum.interface";

/** 
 * Contains information about a penalty correlated with itinerary change or cancellation.
*/
export interface TicketPenalty {
    type: TicketPenaltyTypeEnum

    applicability?: FareRulePenaltyApplicabilityEnum[]
    /**
     * example:false
     * If true, requests changeable options. 
     * If false, only non-changeable options are requested. 
     * Mutually exclusive with the maximumPenalty property.
     */
    isChangeable?: boolean
  
    maximumPenalty?: Value
}