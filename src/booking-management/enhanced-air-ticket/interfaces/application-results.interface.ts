import { SystemSpecificResults } from "../types/system-specific-results";
/** ApplicationResults can be used anywhere where Results is referenced, specifically as the contents of a Sabre SOAP Fault/detail element. */
export interface ApplicationResults {
    /**
     * Lists details of a successful call.
     * @maxItems 99
     * @minItems 0
     */
    Success?: DetailInfoProcess[]
    /**
     * Lists details of any errors encountered during processing.
     * @maxItems 99
     * @minItems 0
     */
    Error?: DetailInfoProcess[]
    /**
     * Lists details of any issues encountered during processing.
     *
     * Use this information to help troubleshoot further.
     * @maxItems 99
     * @minItems 0
     */
    Warning?: DetailInfoProcess[]
    /** Transaction status. */
    status: StatusAplicationResultEnum
}
export interface DetailInfoProcess {
    /** Lists specific information from the system and/or other sub-systems invoked during processing. */
    SystemSpecificResults?: SystemSpecificResults
    /**
     * An indication of the source of error when processing the request.
     * @pattern \c+
     */
    type?: DetailInfoProcessTypeEnum
    timeStamp?: string;
}
enum DetailInfoProcessTypeEnum {"Transport", "Validation",  "Application", "BusinessLogic"}
enum StatusAplicationResultEnum {"Complete", "Incomplete", "NotProcessed", "Unknown"}