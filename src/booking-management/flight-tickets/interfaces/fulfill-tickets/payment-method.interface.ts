/**
 * Contains a maximum of two forms of payment from the formsOfPayment array. 
 * Multiple forms of payment may be defined only if your location uses Billing and Settlement Plan (BSP) 
 * reporting and/or the point of sale country does not prohibit providing more than one credit card as the form of payment.
 */
export interface PaymentMethod {
    /** 
     * minimum:1
     * maximum:11
     * example:1
     * The index of the primary form of payment type in the formsOfPayment array.
    */
    primaryFormOfPayment: BigInteger
    /** 
     * minimum:1
     * maximum:11
     * example:2
     * The index of the primary form of payment type in the formsOfPayment array.
    */
    secondaryFormOfPayment?: BigInteger
    /**
     * pattern:^[0-9]+(\.[0-9]{1,3})?$
     * example:100.00
     * The desired base fare amount to charge to the second form of payment. 
     * Applicable only if two forms of payment are requested.
     */
    amountOnSecondFormOfPayment?: string
}