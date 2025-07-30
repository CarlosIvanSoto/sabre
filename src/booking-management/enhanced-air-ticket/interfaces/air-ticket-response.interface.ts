import { ApplicationResults } from "./application-results.interface";
import { Diagnostics } from "./diagnostics.interface";
import { Summary } from "./summary.interface";

export interface Link {
    /**
     * Describes relationship between href and current request.
     * @example "self"
     */
    rel?: string;
    /**
     * Link to related API request.
     * @example "https://api.cert.platform.sabre.com/v1.3.0/air/ticket"
     */
    href?: string;
}
export interface AirTicketRS { 
    /** ApplicationResults can be used anywhere where Results is referenced, specifically as the contents of a Sabre SOAP Fault/detail element. */
    ApplicationResults?: ApplicationResults
    /**
     * This element is used to return a summary information about the documents that were found.
     * @minItems 0
     */
    Summary?: Summary[]
    /** For internal use only. */
    Diagnostics?: Diagnostics
    /**
     * Used to indicate version of the payload message.
     * @minLength 1
     * @maxLength 255
     * @example "1.3.0"
     */
    version?: string;
}