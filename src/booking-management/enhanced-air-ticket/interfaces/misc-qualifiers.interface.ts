import { SegmentSelect } from "./segment-select.interface";

/** Used to pass miscellaneous qualifiers. */
export interface MiscQualifiers {
    /**
     * Used to specify EMD numbers to be issued.
     * @minItems 0
     */
    AirExtras?: AirExtras[];
    /**
     * It cannot combine with PhaseIV.
     * @maxItems 99
     * @minItems 0
     */
    BaggageAllowance?: BaggageAllowance[]
    /**
     * Used to pss certificate numbers.
     * @maxItems 2
     * @minItems 0
     */
    Certificate?: Certificate[]
    /** Used to pass details of the commission being claimed. */
    Commission?: Commission
    /** Used to specify the discount. */
    Discount?: Discount
    /**
     * Used to instruct the system to take the passenger's date of birth-related information from the SSR PNR field
     * and pass it into the host-based ticketing application. This is required for clients based in the Russian Federation.
     * @example "2024-01-01"
     */
    DateOfBirth?: string;
    /** Used to pass miscellaneous text in the endorsements field. */
    Endorsement?: Endorsement
    /** Used to issue tickets from specific FP lines. */
    FutureTicket?: FutureTicket
    /**
     * Used to specify to print invoice at time of ticketing.
     * Both parameters will print a passenger electronic ticketing receipt as well as an invoice.
     */
    Invoice?: Invoice
    /**
     * Used to issue a paperless service fee request, using the service fee amount stored in the TJR.
     * This attribute can be combined with form of payment details .../OptionalQualifiers/FOP_Qualifiers/BasicFOP.
     */
    MISF?: MISF
    /** Please note that only two of the three attributes can be set to true simultaneously. */
    NeedPrint?: NeedPrint
    /** Used to pass net remit amount/codes. */
    NetRemit?: NetRemit 
    /** Used to specify ticket types to issue. */
    Ticket?: MiscTicket
    /** Used to pass tour code information. */
    TourCode?: TourCode
}
/**
 * Used to specify EMD numbers to be issued.
 */
export interface AirExtras {
    /**
     * Used to specify the final EMD number when specifying a range.
     * @example 3
     */
    EndNumber?: number;
    /**
     * Used to specify an EMD number.
     * @example 1
     */
    Number: number;
}
/**
 * It cannot combine with PhaseIV.
 */
export interface BaggageAllowance {
    /** Used to instruct the system to price specified itinerary segments. */
    SegmentSelect?: SegmentSelect
    /**
     * Used to specify the quantity of checked bags if applicable.
     * @example "01"
     */
    Number?: string;
    /**
     * Used to specify the weight in kilos of checked bags if applicable.
     * @example "20"
     */
    Weight?: string;
}
/**
 * Used to pss certificate numbers.
 * @maxItems 2
 * @minItems 0
 */
export interface Certificate {
    /**
     * Used to specify a ticket number. Please note that this qualifier is only applicable to Sabre Sonic-hosted carriers.
     * @example "123456789"
     */
    Number: string;
}
/** Used to pass details of the commission being claimed. */
export interface Commission {
    /**
     * Used to specify the numeric amount of commission being claimed if applicable.
     * @example 25
     */
    Amount?: number;
    /**
     * Used to claim commission on the net fare. It must be combined with @Percent.
     * @example true
     */
    Net?: boolean;
    /**
     * Used to specify the percentage of commission being claimed if applicable.
     * @example 5
     */
    Percent?: number;
}
/** Used to specify the discount. */
export interface Discount{
    /** Used to specify an 8 digit discount approval code. */
    Code?: string;
}
/** Used to pass miscellaneous text in the endorsements field. */
export interface Endorsement {
    /**
     * Used to pass miscellaneous text in the endorsements field.
     * @example "TEST0"
     */
    Text: string;
    /**
     * Used to override existing endorsement.
     * @example true
     */
    Override?: boolean;
}
/** Used to issue tickets from specific FP lines. */
export interface FutureTicket {
    /**
     * Line and its associated attributes are used to issue tickets from specific FP lines.
     * @minItems 1
     */
    Line: Line[];
}
 /**
 * Line and its associated attributes are used to issue tickets from specific FP lines.
 */
export interface Line {
    /**
     * Used to select a range of name numbers.
     * @example 3
     */
    EndNumber?: number;
    /**
     * Used to select name number.
     * @example "1.1"
     */
    NameNumber?: string;
    /**
     * Used to select line number.
     * @example 1
     */
    Number: number;
}
/**
 * Used to specify to print invoice at time of ticketing.
 * Both parameters will print a passenger electronic ticketing receipt as well as an invoice.
 */
export interface Invoice {
    /**
     * Used to print invoice.
     * @example true
     */
    Ind?: boolean;
    /**
     * Used to print a passenger electronic ticketing receipt at time of ticketing.
     * @example true
     */
    ETReceipt?: boolean;
}
/**
     * Used to issue a paperless service fee request, using the service fee amount stored in the TJR.
     * This attribute can be combined with form of payment details .../OptionalQualifiers/FOP_Qualifiers/BasicFOP.
     */
export interface MISF {
    Override?: Override 
    /**
     * Used to issue a paperless service fee request, using the service fee amount stored in the TJR.
     * This attribute can be combined with form of payment details /AirTicketRQ/OptionalQualifiers/FOP_Qualifiers/BasicFOP.
     * @example true
     */
    Ind?: boolean;
}
export interface Override {
    /**
     * Used to issue a paperless service fee request and specify a service fee amount override.
     * @example "5.00"
     */
    Amount?: string;
    /**
     * Used to specify currency.
     * @example "USD"
     */
    CurrencyCode?: string;
    /**
     * Used to add service fee description.
     * @example "HANN"
     */
    ServiceFeeDescription?: string;
    /**
     * Used to add customer reference. Applies only to BSP Canada customers.
     * @example "MBAYE"
     */
    CustomerReference?: string;
    /**
     * Used to provide extra back-office information. Equivalent Sabre host command MISF‡O*ABC123
     * @example "ABC123"
     */
    BackOfficeInfo?: string;
    /**
     * Used to assign a document, reference number, or free text to the transaction. Cannot be combined with `TicketNumber`. Equivalent Sabre host command MISF‡TM1234567890
     * @example "1234567890"
     */
    DocumentReferenceCode?: string;
    /**
     * Used to assign a ticket number to the transaction. Cannot be combined with `DocumentReferenceCode`. Equivalent Sabre host command MISF‡T0061234567890
     * @example "0061234567890"
     */
    TicketNumber?: string;
}
/** Please note that only two of the three attributes can be set to true simultaneously. */
export interface NeedPrint {
    /**
     * Used to specify to print an auditor coupon. Please note that this qualifier is only applicable to Sabre Sonic-hosted carriers.
     * @example true
     */
    AuditorCoupon: boolean;
    /**
     * Used to specify to print an itinerary. Please note that this qualifier is only applicable to Sabre Sonic-hosted carriers.
     * @example true
     */
    Itinerary: boolean;
    /**
     * Used to specify to print a passenger receipt. Please note that this qualifier is only applicable to Sabre Sonic-hosted carriers.
     * @example true
     */
    PassengerReceipt: boolean;
}
/** Used to pass net remit amount/codes. */
export interface NetRemit {
    /**
     * Used to enter manual/NET amount.
     * @example "600"
     */
    Amount?: string;
    /**
     * Used to enter discount amount.
     * @example "100"
     */
    DiscountAmount?: string;
    /**
     * Used to enter total selling amount.
     * @example "875.28"
     */
    SellingFareAmount?: string;
    /**
     * Used to enter manual NET/net code with contract agreement reference code.
     * @example "ABCDEFGHIJ"
     */
    ContractAgreementCode?: string;
    /**
     * Used to enter credit card amount.
     * @example 20051.6
     */
    NetCreditAmount?: number;
    /**
     * Used to pass tour code details.
     * @example "TEST1212"
     */
    TourCode?: string;
    /**
     * Used to enter manual NET/net code with value code.
     * @example "D2469"
     */
    ValueCode?: string;
}
/** Used to specify ticket types to issue. */
export interface MiscTicket {
    /**
     * Used to specify an action code. Please note that this qualifier is only applicable to Sabre Sonic-hosted carriers.
     * @example "PRINT"
     */
    Action?: string;
    /**
     * Used to specify the type of ticket to issue.
     * Acceptable values for Type:
     * ETR = electronic ticket (default),
     * ETR = Electronic Miscellaneous Document,
     * XETR = paper ticket,
     * VCR = paper ticket (for airline use only).
     * @example "ETR"
     */
    Type?: TicketTypeEnum;
}
const TICKET_TYPE_ENUM = {
  ETR: "ETR",
  XETR: "XETR",
  VCR: "VCR"
} as const

export type TicketTypeEnum = keyof typeof TICKET_TYPE_ENUM
/** Used to pass tour code information. */
export interface TourCode {
    /** Suppress the fare amount on the ticket and replace with BT. */
    SuppressFareReplaceWithBT?: Suppress
    /** Suppress the fare amount on the ticket and replace with IT. */
    SuppressFareReplaceWithIT?: Suppress
    /** Suppress the IT in the tour code box from printing. */
    SuppressIT?: Suppress
    /** Suppress IT from printing in the tour box on the ticket and to suppress fare amounts from printing on the ticket. */
    SuppressITSupressFare?: Suppress
    /**
     * Used to specify tour code.
     * @example "TEST1212"
     */
    Text?: string;
};
/**
 * Tipo propio para provisionar los tipos SuppressFareReplaceWithBT, SuppressFareReplaceWithIT, SuppressIT
 * SuppressITSupressFare y SuppressITSupressFare
 */
export interface Suppress {
    /**
     * Used to specify to suppress the IT in the tour code box from printing.
     * @example true
     */
    Ind: boolean;
};