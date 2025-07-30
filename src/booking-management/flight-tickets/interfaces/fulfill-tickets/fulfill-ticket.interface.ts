import { TotalValues } from "../../../common/interfaces"
import { TicketStatusEnum } from "../../../common/interfaces"

/**
* Contains information about an electronic flight ticket or EMD issued for a traveler.
*/
export interface FulFillTicket {
  /**
   * example:false
   * If true, the ticket number has been committed to the PNR. Applicable to ATPCO bookings only.
   */
  isCommitted?: boolean
  /**
   * pattern:^[0-9A-Z/-]+$
   * example:0167489825830 
   * The electronic flight ticket number.
   */
  number: string
  /**
   * example:2024-07-01
   * The date the electronic flight ticket was issued in YYYY-MM-DD format.
   */
  date: string
  /**
   * example:John
   * The traveler's first name.
   */
  travelerGivenName?: string
  /**
   * example:Smith
   * The traveler's last name.
   */
  travelerSurname?: string
  /**
   * Contains details of the payment amount - the total amount to pay, 
   * the amount before tax, the amount of fees, and the amount of tax.
   */
  payment: TotalValues	
  /**
   * Identifies the current status of the ticket.
   */
  ticketStatusName?: TicketStatusEnum
  /**
   * pattern:^[A-Z]{1,2}$
   * example:TE
   * The code of the ticket status.
   */
  ticketStatusCode?: string	
  /**
   * pattern:^[A-Z0-9]{3,4}$
   * example:G7HE
   * The pseudo city code of the agency which issued the ticket or EMD.
   */
  ticketingPcc: string
}