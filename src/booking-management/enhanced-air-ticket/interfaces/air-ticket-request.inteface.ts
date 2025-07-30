import { AccountingLines } from "./air-ticket-request/accounting-lines.interface";
import { DesignatePrinter } from "./air-ticket-request/designate-printer.interface";
import { PostProcessing } from "./air-ticket-request/post-processing.interface";
import { Ticketing } from "./air-ticket-request/ticketing.interface";

export interface AirTicketRQ {
    DesignatePrinter?: DesignatePrinter
    Itinerary: Itinerary
    AccountingLines?: AccountingLines
    Ticketing: Ticketing[]
    PostProcessing?: PostProcessing
    Diagnostics?: any
    /**
     * Used to specify whether the service should check and stop processing upon encountering an error indicating
     * that minimum connection time between air itinerary segments is not met.
     * @example true
     */
    haltOnInvalidMCT?: boolean
    /**
     * Used to specify to which city service should change context using ContextChange (AAA) and the rest of the service uses new security.
     * If empty or equals current city the context doesn't change.
     * @example "AAAA"
     */
    targetCity?: string
    /**
     * This is for Sabre internal use only.
     *
     * If `true`, the API is queried in health check mode and will return a blank success that does not invoke downstream providers.
     * @example "false"
     */
    healthCheck?: string
    /**
     * Used to specify API version.
     * @minLength 1
     * @maxLength 255
     * @example "1.3.0"
     */
    version?: string
}
/** Used to pass record locator of the reservation to issue tickets from. */
export interface Itinerary {
    /**
     * Used to specify a record locator.
     * @pattern [0-9a-zA-Z]{1,6}
     * @example "YYABHF"
     */
    ID: string;
}