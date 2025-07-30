/**
 * Contains details of the Miscellaneous Intelligent Service Fee (MISF), 
 * applied for submitting a paperless service fee request using the amount stored in the travel journal record (TJR). 
 * May be combined with formsOfPayment details. Applicable to Canadian customers only.
 */
export interface MiscellaneousServiceFee {
    /** 
     * pattern:^[0-9]+(\.[0-9]{1,3})?$
     * example:100.00
     * The override amount of the service fee.
    */
    overrideAmount?: string
    /** 
     * pattern:^[A-Z]{3}$
     * example:USD
     * The three-letter ISO 4217 currency code.
    */
    currencyCode?: string
    /**
     * pattern:^((?![&<>\"]).){1,86}?$
     * example:AIR SERVICE FEE
     * The description of the service fee.
     */
    description?: string
    /**
     * pattern:^[A-Z0-9]{1,27}$
     * example:IBM997YYZ
     * The reference to the customer.
     */
    customerReference?: string
}