import { Commission } from "../../common/interfaces"
/**
 * Contains accounting data correlated with a fulfilled document. Supported for ATPCO content only
 */
export interface AccountingItem {
  /**
   * Identifies the association type of the accounting item, which indicates to whom the fare is applied. Can be Single Traveler (fare amount applied to a singular passenger whose details are provided in FormOfPayment), All Travelers (fare amount applied to all passengers together as a group), or Each Traveler (fare amount applied to individual passengers).
   *
   * example: Single Traveler
   */
  fareApplicationType?: string // FareApplicationTypeEnum
  formOfPaymentType?: string // AccountingFormOfPaymentTypeEnum
  creationType?: string // AccountingItemCreationTypeEnum
  airlineCode?: string
  ticketNumber?: string
  commission?: Commission
  fareAmount?: string
  taxAmount?: string
  travelerIndices: number[]
  tariffBasisType?: string // TariffBasisTypeEnum
  cardNumber?: string
  cardTypeCode?: string
  currencyCode?: string
}