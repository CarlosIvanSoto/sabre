/**
 * Contains the automated Net Remit ticketing qualifiers. 
 * Net Remit is used to arrange the payment of an additional commission above the standard commission amount. 
 * This extra commission is payable by the validating carrier through the BSP settlement cycle.
 */
export interface FulFillNetRemit{
    /** 
     * example:ABCD123
     * The value code used to enter a manual Net Remit code.
    */
    netRemitCode?: string
    /** 
     * example:DEF456
     * The reference code used to indicate the Net Remit commercial contract.
    */
    commercialAgreementReferenceCode?: string
    /** 
     * pattern:^[0-9]+(\.[0-9]{1,3})?$
     * example:100.00
     * The cash amount of Net Remit.
    */
    cashAmount?: string
    /**
     * pattern:^[0-9]+(\.[0-9]{1,3})?$
     * example:100.00
     * The credit amount of Net Remit.
     */
    creditAmount?: string
    /** 
     * pattern:^[0-9]+(\.[0-9]{1,3})?$
     * example:100.00
     * The amount of Net Remit discount.
    */
    discountAmount?: string
    /**
     * pattern:^[0-9]+(\.[0-9]{1,3})?$
     * example:100.00
     * The monetary amount of the total selling fare.
     */
    sellingFareAmount?: string
    /**
     * pattern:^[A-Z0-9]{1,15}$
     * example:123456789ABCDE
     * The tour code to use during Net Remit ticketing.
     */
    tourCode?: string

}