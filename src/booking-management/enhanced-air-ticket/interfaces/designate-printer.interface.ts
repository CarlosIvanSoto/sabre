/** Used to control printer designation process. */
export interface DesignatePrinter {
    Printer?: Printers
    Profile?: Profile
}
/** Used to designate printers. */
export interface Printers {
    BagTag?: BagTag
    BoardingPass?: BoardingPass
    HardCopy?: HardCopy
    InvoiceItinerary?: InvoiceItinerary
    ListLabel?: ListLabel
    MiniItinerary?:MiniItinerary
    Report?: Report
    Ticket?: Ticket
}
/** Used to specify bag tag printer. */
export interface BagTag {
    /**
     * Used to specify a bag tag printer address.
     * @example "XXXXX9"
     */
    LNIATA?: string;
}
/** Used to specify boarding pass of printer. */
export interface BoardingPass {
   /**
     * Used by airline customers to indicate request for an airline-based boarding pass printer.
     * @example true
     */
    HostedCarrier?: boolean;
    /**
     * Used to specify a boarding pass printer address.
     * @example "XXXXX9"
     */
    LNIATA?: string;
}
/** Used to specify the hardcopy printer. */
export interface HardCopy {
    /**
     * Used to specify the spacing, either 1, or 2.
     * @example "1"
     */
    Spacing?: "1" | "2";
    /**
     * Used to specify a hardcopy printer address.
     * @example "XXXXX9"
     */
    LNIATA?: string;
}
/** Used to specify invoice/itinerary printer. */
export interface InvoiceItinerary {
    /**
     * Used to specify an invoice/itinerary printer address.
     * @example "XXXXX9"
     */
    LNIATA?: string;
}
/** Used to specify list/label printer. */
export interface ListLabel {
    /**
     * Used to specify a list/label printer address.
     * @example "XXXXX9"
     */
    LNIATA?: string;
}
/** Used to specify mini itinerary printer. */
export interface MiniItinerary {
    /**
     * Used to specify a mini itinerary printer address.
     * @example "XXXXX9"
     */
    LNIATA?: string;
}
/** Used to specify report printer. */
export interface Report {
    /**
     * Used to specify a report printer address.
     * Please note that the user account attempting to designate to a report printer must be signed in under duty code 9.
     * To set duty code 9 the client application can utilize the ContextChangeLLSRQ service.
     * @example "XXXXX9"
     */
    LNIATA?: string;
}
/** Used to specify ticket printer. */
export interface Ticket {
    /** Used by ATB1 or ATB2 customers to also designate a mini itinerary printer at the same time they are designating their ticket printer. */
    MiniItinerary?: MiniItinerary
    /** Used by customers to designate an ATB or ATB2 ticket printer along with a remote printer. */
    Remote?: Remote
    /**
     * Used to specify country code associated with the airport code.
     * @example "AB"
     */
    CountryCode?: string;
    /**
     * Used to specify a ticket printer address.
     * Clients should only associate 255 sessions to a single printer address.
     * Additional sessions beyond the initial 255 need to be designated to a different printer address.
     * @example "XXXXX9"
     */
    LNIATA?: string;
}
/** Used to specify report printer. */
export interface Remote {
    /**
     * Used by customers to designate an ATB or ATB2 ticket printer along with a remote printer.
     * @example "XXXXX9"
     */
    LNIATA?: string;
}
/** Used to pass printer profile information. */
export interface Profile {
    /**
     * Used to specify a previously established printer number.
     * @example 1
     */
    Number?: number;
}

