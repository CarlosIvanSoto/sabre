import { BookingSourceEnum, PrinterAddress, Ticket, TotalValues } from "../../common/interfaces"
import { FulfillErrorPolicyEnum } from "./fulfill-tickets/fulfill-error-policy-enum.interface"
import { FulfillFormsOfPayment } from "./fulfill-tickets/fulfill-form-of-payment.interface"
import { FulfillmentsDetails } from "./fulfill-tickets/fulfillment-details.interface"
import { NotificationEmailEnum } from "./fulfill-tickets/notification-email.enum.interface"
import { PriceQuoteHandlingMethodEnum } from "./fulfill-tickets/price-quote-handling-method-enum.interface"
import { TravelerName } from "./fulfill-tickets/traveler-name.interface"

/**
 * Contiene elementos obligatorios y opcionales para completar tickets y EMD.
 */
export interface FulfillTicketsOptions {

  errorHandlingPolicy?: FulfillErrorPolicyEnum

  bookingSource?: BookingSourceEnum
  /**
   * El ID de referencia de la reserva como se muestra en el proveedor de origen o en el sistema del proveedor.
   *
   * pattern: ^[A-Z0-9]{6,}$
   * example: GLEBNY
   */
  confirmationId: string

  retainAccounting?: boolean

  fulfillments: FulfillmentsDetails[]

  targetPcc?: string

  receivedFrom?: string

  designatePrinters?: PrinterAddress[]

  formsOfPayment?: FulfillFormsOfPayment[]

  travelers?: TravelerName

  generateSingleInvoice?: boolean

  commitTicketToBookingWaitTime?: number

  acceptNegotiatedFare?: boolean

  acceptPriceChanges?: boolean

  backDatePriceQuoteMethod?: PriceQuoteHandlingMethodEnum

  priceQuoteExpirationMethod?: PriceQuoteHandlingMethodEnum

  notificationEmail?: NotificationEmailEnum

}

/**
 * Contiene información sobre elegibilidad de cancelación y montos reembolsables por boleto.
 */
export interface FulfillTicketsResponseSuccess {
  
}