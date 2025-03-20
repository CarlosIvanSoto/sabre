import { FulfillQualifiers } from "./fulfill-qualifiers.interface"
import { MiscellaneousServiceFee } from "./miscellaneous-service-fee.interface"
import { PaymentMethod } from "./payment-method.interface"

export interface FulfillmentsDetails {
  ancillaryIds: string[]
  ticketingQualifiers: FulfillQualifiers
  serviceFee: MiscellaneousServiceFee
  payment: PaymentMethod
}