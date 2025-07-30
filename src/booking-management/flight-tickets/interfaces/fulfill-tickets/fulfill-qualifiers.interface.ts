import { FlightReference } from "../../../booking/common/interfaces"
import { TicketPenalty } from "../../../common/interfaces/ticket-penalty.interface"
import { FulFillBaggageAllowance } from "./fulfill-baggage-allowance.interface"
import { FulFillBrandedFare } from "./fulfill-branded-fare.interface"
import { FulFillDocumentsEnum } from "./fulfill-documents.enum.interface"
import { FulFillNetRemit } from "./fulfill-net-remit.interface"
import { Endorsements } from "./fulfill-qualifiers-endorsements.interface"
import { FulFillSpecificFare } from "./fulfill-specific-fare.interface"
import { FutureProcessing } from "./future-processing.interface"
import { TourCodeOverridesOptionEnum } from "./tour-code-option.enum.interface"
import { ValidityPeriod } from "./validity-period.interface"

export interface FulfillQualifiers {
   /**
   * pattern:^[0-9]+(\.[0-9]{1,3})?$
   * example:30.00
   * The commission amount to be claimed. Cannot be combined with commissionPercentage.
   */
   commissionAmount?:string
   /**
    * example:true
    * If true, overrides all pre-programmed endorsements and prints special endorsements of the fare.
    */
   commissionPercentage?: string

   endorsements?: Endorsements
   /**
    * example:false
    * If true, fares with advance purchase requirements are excluded during pricing. 
    * Mutually exclusive with the priceQuoteRecordIds property within the fulfillment process.
    */
   excludeFareFocusFares?: boolean
   /**
    * Lists references to the travelers within the travelers array for the purpose of name association during the fulfillment process.
    * Mutually exclusive with the priceQuoteRecordIds property.
    * integer($int32)
    * minimum:1
    * example:1
    * Index of the traveler
    */
   travelerIndices?: Int32List
   /**
    * pattern:^[A-Z0-9]{1,15}$
    * example:TEST1212
    * The tour code to use during ticketing.
    */
   tourCode?: string
   /**
    * example:REPLACE_WITH_BT
    * Identifies the options that will be printed on the final ticket. 
    * Must be used in combination with tourCode. 
    * Can be REPLACE_WITH_BT (suppresses the fare amount and replaces it with BT), 
    * REPLACE_WITH_IT (suppresses the fare amount and replaces it with IT), 
    * SUPPRESS_IT (suppresses IT), or SUPPRESS_IT_AND_FARE (suppresses IT as well as the fare amount). 
    * IT stands for the inclusive tour ticket amount on the passenger coupon of a ticket, 
    * while BT indicates the bulk inclusive tour ticket amount on the passenger coupon of a ticket.
    */
   tourCodeOverrides?: TourCodeOverridesOptionEnum
   /**
    * pattern:^[A-Z0-9]{2}$
    * example:AA
    * The two-letter IATA designator code of the desired validating airline.
    */
   validatingAirlineCode?: string
   /**
    * minItems:1
    * maxItems:99
    * Lists desired brand codes. It is only possible to request one brand code per flight.
    */
   brandedFares?: FulFillBrandedFare[]
   /**
    * minItems:1
    * maxItems:5
    * Lists tax codes to exclude during Electronic Miscellaneous Document (EMD) issuance.
    * pattern:^[A-Z]{1,2}$
    * example:UB
    * A tax code to exclude.
    */
   exemptFares?: string[]
   /**
    * default:true
    * example:false
    * If true, the Electronic Miscellaneous Document (EMD) will be fulfilled with taxes. 
    * If false, the Electronic Miscellaneous Document (EMD) will be fulfilled without taxes.
    */
   priceWithTaxes?: boolean
   /**
    * Lists a side trip sequence of flights referenced by flight itemId that follows after departure from a stopover 
    */
   sideTripFlights?: FlightReference[]
   /**
    * minItems:1
    * maxItems:2
    * Lists penalties correlated with itinerary changes or cancellations.
    */
   penalties?: TicketPenalty[]
   /**
    * default:false
    * example:false
    * If true, returns additional tags with fare flexibility information.
    */
   returnFareFlexibilityDetails?: boolean
   /** 
    * Lists the Price Quote (PQ) records of fares with recordTypeCode equal to PQ, 
    * referenced by the recordId and obtained from the Get Booking response. 
    * Mutually exclusive with the travelerIndices and excludeFareFocusFares properties.
    * pattern:^[A-Z0-9]+$
    * example:12 
    * The ID of the fare source.
    */
   priceQuoteRecordIds?: string[]
   /**
    * minimum:1
    * maximum:2
    * example:1
    * The Spanish large family discount level.
    */
   spanishLargeFamilyDiscountLevel?: BigInteger
   /**
    * minItems:1
    * maxItems:16
    * Lists desired fare basis codes with complete auto-pricing validation.
    */
   specificFares?: FulFillSpecificFare[]
   /** 
    * minItems:1
    * maxItems:99
    * Lists ticket validity dates.
    */
   validityDates?: ValidityPeriod[]
   /**
    * minItems:1
    * maxItems:99
    * Lists baggage allowance details.
    */
   baggageAllowance?: FulFillBaggageAllowance[]
   /**
    * default:false
    * example:false
    * If true, claims commission on the Net fare. Must be used in combination with commissionPercentage.
    */
   isNetFareCommission?: boolean
   /** 
    * pattern:^[A-Z0-9]{8}$
    * example:12345ABC
    * The eight-character discount approval code used by Korean customers.
   */
   discountApprovalCode?: string
   /**
    * minItems:1
    * maxItems:99
    * Lists the so-called future processing or future pricing lines (FP) 
    * with ticketing instructions to process a ticket in the near future.
    */
   futurePricingLines?: FutureProcessing[] 
   
   printDocuments?: FulFillDocumentsEnum

   netRemit?: FulFillNetRemit

}