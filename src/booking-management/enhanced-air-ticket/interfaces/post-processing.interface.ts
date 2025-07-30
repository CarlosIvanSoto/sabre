import { SegmentSelect } from "./segment-select.interface";

/** Additional ticket issuance options, mostly related to post issuance actions. */
export interface PostProcessing {
  /** Used to end the transaction and finalize the record. */
  EndTransaction?: EndTransaction
  GhostTicketCheck?: GhostTicketCheck
  /**
   * Specifies the wait interval before the second and then to any subsequent ticketing operations.
   * For example, if you send four `/Ticketing` nodes, the system will perform four ticketing issuance operations.
   * In this case the delay is set after the first, second, and third operation.
   */
  TicketingInterval?: TicketingInterval
  /** If `true`, specifies the wait interval before committing the changes to the ticket in the instance of system encountering `CREDIT VERIFICATION` message. */
  CreditVerificationInterval?: CreditVerificationInterval
  /**
   * Used to accept a negotiated fare when it is not possible to ticket the stored fare.
   * @example true
   */
  acceptNegotiatedFare?: boolean;
  /**
   * Used to specify that system should issue a ticket even if price increases while processing.
   * @example true
   */
  acceptPriceChanges?: boolean;
  /**
   * Used to specify appropriate action when Price Quote expires. Available options are "R" - reprice, "Q" Quit, "O" Override.
   * @example "O"
   */
  actionOnPQExpired?: actionOnPQExpiredEnum
  /**
   * Used to specify appropriate action when Price Quote contains back date price. Available options are "R" - reprice, "Q" Quit, "O" Override.
   * If no action is specified, system will automatically perform the reprice.
   * @example "Q"
   */
  actionOnBackDatePrice?: actionOnBackDatePrice
}
/** Used to end the transaction and finalize the record. */
export interface EndTransaction {
    /**
     * If `true`, the API will send a single commit message after issuing multiple tickets.
     *
     * This alters the default mechanism in which each ticket is committed to the PNR immediately after issuance.
     * @example false
     */
    generateSingleInvoice?: boolean;
    /** Used to receive the record. */
    Source?: Source
    /** Used to send an email notification upon end transaction to any email addresses contained within the particular record. */
    Email?: Email
  }
  /** Used to receive the record. */
  export interface Source {
    /**
     * Used to receive the record.
     * @example "SWS TESTING"
     */
    ReceivedFrom: string;
  }
  /** Used to send an email notification upon end transaction to any email addresses contained within the particular record. */
  export interface Email {
    /** Used to send an email notification containing a text-based copy of the eTicket, it cannot combine with .../Invoice, or .../Itinerary. */
    eTicket?: eTicket
    /** Used to send an email notification containing a text-based copy of the invoice. It cannot combine with .../eTicket, or .../Itinerary. */
    Invoice?: DocumentCopy
    /** Used to send an email notification containing a text-based copy of the itinerary. It cannot combine with .../eTicket, or .../Invoice. */
    Itinerary?: PostProcessingItinerary
    PersonName?: PersonName
    /**
     * Used to send an email notification upon end transaction.
     * @example true
     */
    Ind: boolean;
  }
  /** Used to send an email notification containing a text-based copy of the eTicket, it cannot combine with .../Invoice, or .../Itinerary. */
  export interface eTicket {
    /** Used to send an email notification containing a PDF-based copy of the eTicket. */
    PDF?: DocumentCopy
    /**
     * Used to send an email notification containing a text-based copy of the eTicket.
     * @example true
     */
    Ind: boolean;
}
/** Tipo para especificar la copia del documento a mandar. */
export interface DocumentCopy {
  /**
   * Used to request a PDF copy of the eTicket.
   * @example true
   */
  Ind: boolean
}
/** Used to send an email notification containing a text-based copy of the itinerary. It cannot combine with .../eTicket, or .../Invoice. */
export interface PostProcessingItinerary {
    /** Used to send an email notification containing a PDF-based copy of the itinerary. */
    PDF?: DocumentCopy
    /** @minItems 0 */
    Segment?: SegmentSelect[];
    /**
     * Used to send an email notification containing a text-based copy of the itinerary.
     * @example true
     */
    Ind: boolean;
}
export interface PersonName {
  /**
   * Used to specify a particular passenger name number to send the email notification to.
   * Please note that the email address in the PNR's email field must be name associated to the specified name number.
   * @example "2.1"
   */
  NameNumber: string;
}
export interface GhostTicketCheck {
  /**
   * Used to specify interval of time that system will wait.
   * @min 1000
   * @max 30000
   * @example 1000
   */
  waitInterval?: number;
  /**
   * Used to specify how many times GhostTicket will be checked.
   * @min 1
   * @max 6
   * @example 2
   */
  numAttempts?: number;
}
/**
   * Specifies the wait interval before the second and then to any subsequent ticketing operations.
   * For example, if you send four `/Ticketing` nodes, the system will perform four ticketing issuance operations.
   * In this case the delay is set after the first, second, and third operation.
   */
export interface TicketingInterval {
  /**
   * Used to specify an interval that the system should wait in milliseconds.
   * @min 1000
   * @max 5000
   * @example 1000
   */
  waitInterval?: number;
  /**
   * If `true`, triggers the Ticketing Interval logic for first ticketing transaction.
   * @example true
   */
  includeFirst?: boolean;
}
export interface CreditVerificationInterval {
  /**
   * The duration of the wait interval in milliseconds.
   * @min 3000
   * @max 10000
   * @example 4000
   */
  waitInterval?: number;
}
enum actionOnPQExpiredEnum {"O", "Q", "R"}
enum actionOnBackDatePrice {"O", "Q", "R"}