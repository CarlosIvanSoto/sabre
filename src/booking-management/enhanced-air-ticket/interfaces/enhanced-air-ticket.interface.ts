import { AirTicketRQ } from "./air-ticket-request.inteface";
import { AirTicketRS, Link } from "./air-ticket-response.interface";

export interface EnhancedAirTicketOptions {
    /** Orchestrated Air Ticket API request. */
    AirTicketRQ: AirTicketRQ
}

export interface EnhancedAirTicketResponse {
    /** Lists hypertext application language links. */
    Links?: Link[]
    /** Orchestrated Air Ticket API response. */
    AirTicketRS: AirTicketRS
}