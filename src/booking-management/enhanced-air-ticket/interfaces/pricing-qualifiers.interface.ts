import { SegmentSelect } from "./segment-select.interface";
import { Tax } from "./tax-interface";
/** Used to pass pricing qualifiers. */
export interface PricingQualifiers {
    /**
     * Used to specify a brand. Please note that it's not possible to request more than 1 brand for an entire journey or for the same segment.
     * @minItems 0
     */
    Brand?: Brand
    /** Used to exclude fare focus fares based on business rules of the agency. Please note that this qualifier cannot be combined with .../PriceQuote. */
    FareFocusExclude?: FareFocusExclude
    /** Please note that this functionality is restricted to Sabre's Asian joint venture customers. */
    Fare?: Fare 
    /** Used to issue tickets on specific itinerary segments. */
    ItineraryOptions?: ItineraryOptions
    /**
     * Used to instruct the system to price the itinerary based upon a particular name field.
     * @minItems 0
     */
    NameSelect?: NameSelect[];
    /**
     * Used to issue a Phase IV ticket. Cannot combine with .../PriceQuote.
     * @maxItems 7
     * @minItems 0
     */
    PhaseIV?: PhaseIV[];
    /**
     * It cannot combine with .../NameSelect and with .../PhaseIV.
     * @minItems 0
     */
    PriceQuote?: PriceQuote[];
    /** Used to issue PQR with refundable balance EMD-S. */
    RefundableBalance?: RefundableBalance
    /**
     * Used to specify the spanish large family discount level. Please note that this qualifier is only applicable to Spain-based subscribers.
     * @example "1"
     */
    SpanishLargeFamilyDiscountLevel?: SpanishLargeFamilyDiscountLevelEnum
    /**
     * Please note that the element is only applicable to Abacus.
     * @minItems 0
     */
    SpecificFare?: SpecificFare[];
    /** Used to specify change or cancellation amounts for an itinerary. */
    SpecificPenalty?: SpecificPenalty
    /** Used to exempt taxes. */
    Taxes?: Taxes
    /**
     * Used to specify ticket validity dates. It cannot combine with PhaseIV.
     * @minItems 0
     */
    ValidityDates?: ValidityDates[];
}
/**
 * Used to specify a brand. 
 */
export interface Brand {
    /**
     * Used to specify text of the field.
     * @example "CP"
     */
    content?: string;
    /**
     * Used to match up with ".../ItineraryOptions/Segment".
     * @example 1
     */
    RPH?: number;
}
/** Used to exclude fare focus fares based on business rules of the agency. */
export interface FareFocusExclude {
    /**
     * Used to exclude fare focus fares based on business rules of the agency.
     * @example true
     */
    Ind: boolean;
}
/** Please note that this functionality is restricted to Sabre's Asian joint venture customers. */
export interface Fare {
    /**
     * Used to specify a fare type. Acceptable values are "NL" for normal fare, "EX" for special fare and "IT" for inclusive tour.
     * @example "NL"
     */
    Type: FareTypeEnum;
}
const FARE_TYPE_ENUM = {
  NL: "NL",
  EX: "EX",
  IT: "IT"
} as const

export type FareTypeEnum = keyof typeof FARE_TYPE_ENUM

/** Used to issue tickets on specific itinerary segments. */
export interface ItineraryOptions {
    /**
     * Used to instruct the system to price specified itinerary segments.
     * @minItems 0
     */
    SegmentSelect?: SegmentSelect[];
    /** Used to instruct the system to price the specified itinerary segments as a side trip. */
    SideTrip?: SideTrip
}
/** Used to instruct the system to price the specified itinerary segments as a side trip. */
export interface SideTrip{
    /**
     * Used to select a range of name numbers.
     * @example 3
     */
    EndNumber?: number;
    /**
     * Used to specify segment number.
     * @example 1
     */
    Number: number;
}
/**
 * Used to instruct the system to price the itinerary based upon a particular name field.
 */
export interface NameSelect {
    /**
     * Used to select a range of name numbers.
     * @example "2.1"
     */
    EndNameNumber?: string;
    /**
     * Used to select a specific name number.
     * @example "1.1"
     */
    NameNumber: string;
}
/**
 * Used to issue a Phase IV ticket. Cannot combine with .../PriceQuote.
 */
export interface PhaseIV {
    /**
     * Used to instruct the system to price the itinerary based upon a particular name field.
     * @minItems 0
     */
    NameSelect?: NameSelect[];
    /**
     * Used to specify phase IV number.
     * @example 1
     */
    Number: number;
}
export interface PriceQuote {
    /**
     * Used to instruct the system to price the itinerary based upon a particular name field.
     * @minItems 0
     */
    NameSelect?: NameSelect[];
    /**
     * In order to specify multiple PQR records to be issued please specify a range or specific record numbers by means of the element repetition.
     * .../Ticketing/PricingQualifiers/PriceQuote/Record/@Reissue cannot be combined with .../Ticketing/MiscQualifiers/Ticket.
     * @minItems 0
     */
    Record?: Record[];
}
export interface Record {
    /**
     * Used to specify the ending PQ number in a range.
     * @example 3
     */
    EndNumber?: number;
    /**
     * Used to specify a PQ number.
     * @example 1
     */
    Number: number;
    /**
     * Used to indicate that the particular PQ record is a PQ Reissue record.
     * @example true
     */
    Reissue?: boolean;
}
/** Used to issue PQR with refundable balance EMD-S. */
export interface RefundableBalance {
    /** Used to specify tax details. */
    Taxes?: Tax[]
    /**
     * Used to specify refundable balance amount.
     * @example "100.00"
     */
    Amount: string;
}
enum SpanishLargeFamilyDiscountLevelEnum {
    Level1 = "1", 
    Level2 = "2"
}
export interface SpecificFare {
    /**
     * Used to specify a particular fare basis that will, in turn, be validated.
     * @example "ABCDE"
     */
    FareBasis?: string;
    /**
     * Used to match up with ../OptionalQualifiers/PricingQualifiers/ItineraryOptions/Segment.
     * @example "1"
     */
    RPH?: string;
}
/** Used to specify change or cancellation amounts for an itinerary. */
export interface SpecificPenalty {
    /** It is not possible to combine "BeforeDeparture" and "AfterDeparture" within one element. */
    Changeable?: PenaltyOptions
    /** It is not possible to combine "BeforeDeparture" and "AfterDeparture" within one element. */
    EitherOr?: PenaltyOptions
    /** It is not possible to combine "BeforeDeparture" and "AfterDeparture" within one element. */
    Refundable?: PenaltyOptions
    /**
     * Used to receive additional tags with information on fare flexibility.
     * @example true
     */
    AdditionalInfo?: boolean;
}
/** Tipo base para especificar las penalidades. */
export interface PenaltyOptions {
    /**
     * Used to specify only changeable fare options.
     * @example true
     */
    Any?: boolean;
    /**
     * Used to specify the specific currency for maximum exchange penalty.
     * @example "USD"
     */
    CurrencyCode?: string;
    /**
     * Used to specify maximum change penalty. If a value of "0" is input no penalty is preferred.
     * If a value of "N" is input only non-changeable options are requested.
     * Please note that monetary amount that includes a decimal is not allowed.
     * @example "100"
     */
    MaxPenalty?: string;
    /**
     * Used to query for before departure fees.
     * @example true
     */
    BeforeDeparture?: boolean;
    /**
     * Used to query for after departure fees.
     * @example true
     */
    AfterDeparture?: boolean;
}
/** Used to exempt taxes. */
export interface Taxes {
    /** Used to specify whether or not to exempt all taxes during EMD issuance. */
    NoTax?: NoTax
    /**
     * Used to specify a tax code to exempt during EMD issuance.
     * @maxItems 5
     * @minItems 0
     */
    TaxExempt?: TaxExempt[];
}
/** Used to specify whether or not to exempt all taxes during EMD issuance. */
export interface NoTax {
    /**
     * Used to specify whether or not to exempt all taxes during EMD issuance.
     * @example true
     */
    Ind?: boolean;
}
/** Used to specify a tax code to exempt during EMD issuance.*/
export interface TaxExempt {
    /**
     * Used to specify a tax code to exempt during EMD issuance.
     * @example "GB"
     */
    Code?: string;
}
/** Used to specify ticket validity date. */
export interface ValidityDates {
    /**
     * Used to specify the ending validity date.
     * @pattern (((((0[1-9])|(1[0-2]))-((0[1-9])|(1\d)|(2[0-9])))|((((0[13578])|(1[02]))-31)|(((0[1,3-9])|(1[0-2]))-30)))|(((19|20)(([02468][048])|([13579][26]))-02-29))|((20[0-9][0-9])|(19[0-9][0-9]))-((((0[1-9])|(1[0-2]))-((0[1-9])|(1\d)|(2[0-8])))|((((0[13578])|(1[02]))-31)|(((0[1,3-9])|(1[0-2]))-(29|30)))))
     * @example "2024-12-31"
     */
    NotValidAfter?: string;
    /**
     * Used to specify the beginning validity date.
     * @pattern (((((0[1-9])|(1[0-2]))-((0[1-9])|(1\d)|(2[0-9])))|((((0[13578])|(1[02]))-31)|(((0[1,3-9])|(1[0-2]))-30)))|(((19|20)(([02468][048])|([13579][26]))-02-29))|((20[0-9][0-9])|(19[0-9][0-9]))-((((0[1-9])|(1[0-2]))-((0[1-9])|(1\d)|(2[0-8])))|((((0[13578])|(1[02]))-31)|(((0[1,3-9])|(1[0-2]))-(29|30)))))
     * @example "2024-12-31"
     */
    NotValidBefore?: string;
    /**
     * Used to specify the relevant itinerary segments.
     * @minItems 1
     */
    Segment: SegmentSelect[];
}
