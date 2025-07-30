import { BookingSourceEnum, PrinterAddress} from "../../common/interfaces"
import { FulfillErrorPolicyEnum } from "./fulfill-tickets/fulfill-error-policy-enum.interface"
import { FulfillFormsOfPayment } from "./fulfill-tickets/fulfill-form-of-payment.interface"
import { FulFillTicketRequest } from "./fulfill-tickets/fulfill-ticket-request.interface"
import { FulFillTicket } from "./fulfill-tickets/fulfill-ticket.interface"
import { FulfillmentsDetails } from "./fulfill-tickets/fulfillment-details.interface"
import { NotificationEmailEnum } from "./fulfill-tickets/notification-email.enum.interface"
import { PriceQuoteHandlingMethodEnum } from "./fulfill-tickets/price-quote-handling-method-enum.interface"
import { TravelerName } from "./fulfill-tickets/traveler-name.interface"

/**
 * Contiene elementos obligatorios y opcionales para completar tickets y EMD.
 */
export interface FulfillTicketsOptions {
  /**
   * Lists the type of error handling policy used by the Fulfill Flight Tickets service.
   */
  errorHandlingPolicy?: FulfillErrorPolicyEnum[]

  bookingSource?: BookingSourceEnum
  /**
   * El ID de referencia de la reserva como se muestra en el proveedor de origen o en el sistema del proveedor.
   *
   * pattern: ^[A-Z0-9]{6,}$
   * example: GLEBNY
   */
  confirmationId: string
  /**
   * default:false
   * example:true
   * If true, the service does not delete any existing accounting lines prior to ticketing.
   */
  retainAccounting?: boolean
  /**
   * minItems:1
   * maxItems:99
   * Lists fulfillment details required to issue a document, such as a ticket or an EMD.
   */
  fulfillments: FulfillmentsDetails[]
  /**
   * pattern:^[A-Z0-9]{3,4}$
   * example:G7HE
   * The pseudo city code of the target destination for which the ticket exchange is requested.
   */
  targetPcc?: string
  /**
   * default:Fulfill Flight Tickets
   * example:Booking Management API testing
   * The entity that authorizes the changes in a Passenger Name Record.
   */
  receivedFrom?: string
  /**
   * Lists printers or a printer profile to designate. It is possible to provide a single PrinterAddress object 
   * with a printer profile. Alternatively, the array may contain multiple PrinterAddress objects, 
   * but each of them must have the same printer type definition.
   */
  designatePrinters?: PrinterAddress[]
  /**
   * minItems:1
   * maxItems:10
   * Lists the payment methods to use during the fulfillment process.
   */
  formsOfPayment?: FulfillFormsOfPayment[]
  /**
   * minItems:1
   * maxItems:9
   * Lists information about the travelers.
   */
  travelers?: TravelerName
  /**
   * default:false
   * example:true
   * If true, sends multiple tickets to commit to the PNR in a single batch after they have been issued.
   */
  generateSingleInvoice?: boolean
  /**
   * minimum:0
   * maximum:10000
   * default:0
   * example:3000
   * The maximum wait time in milliseconds applied to asynchronous updates during the ghost ticket validation process, 
   * which is performed to check if the newly issued tickets have been committed to the face of the PNR.
   */
  commitTicketToBookingWaitTime?: number
  /**
   * default:true
   * example:true
   * If true, uses the negotiated fare for ticketing when it is not possible to use the stored fare.
   */
  acceptNegotiatedFare?: boolean
  /**
   * default:true
   * example:true
   * If true, issues a ticket when the price increases during processing.
   */
  acceptPriceChanges?: boolean
  /**
   * default:Reprice
   * example:Quit
   * Identifies how the service handles expired Price Quotes (PQ) or Price Quotes with a back date price.
   */
  backDatePriceQuoteMethod?: PriceQuoteHandlingMethodEnum
  /**
   * default:Reprice
   * example:Quit
   * Identifies how the service handles expired Price Quotes (PQ) or Price Quotes with a back date price.
   */
  priceQuoteExpirationMethod?: PriceQuoteHandlingMethodEnum
  /**
   * example:INVOICE
   * Identifies the method of e-mail notification. 
   * DEFAULT sends a default e-mail notification based on the agency/PCC configuration. 
   * INVOICE sends an e-mail with a copy of the eInvoice, 
   * ETICKET sends an e-mail with a text copy of the eTicket, and 
   * ITINERARY sends an e-mail with a text copy of the itinerary.
   */
  notificationEmail?: NotificationEmailEnum
}

/**
 * Contiene información sobre elegibilidad de cancelación y montos reembolsables por boleto.
 */
export interface FulfillTicketsResponseSuccess {
  /** 
  * Representa el momento exacto cuando la respuesta fue generada. 
    Este valor se representa en UTC cumpliendo el formato YYYY-MM-DDTHH:MM:SSZ.
    Ejemplo:2024-10-28T11:11:21Z
  */
  timestamp: string
  /**
   * Lista de los boletos electrónicos comprados por los pasajeros.
   */
  tickets: FulFillTicket[]
  request: FulFillTicketRequest
  /**
   * Lista de detallada de los errores. 
   * No se presenta cuando es una respuesta exitosa.
   */

  errors: Error[]


}