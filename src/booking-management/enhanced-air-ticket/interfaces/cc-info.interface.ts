/** Used to specify payment card details. */
export interface CC_Info {
    PaymentCard: PaymentCard
    /**
     * Used to specify whether or not to suppress credit card information on an itinerary.
     * @example true
     */
    Suppress?: boolean;
}
/** Used to specify payment card details. */
export interface PaymentCard {
    /**
     * Used to specify the credit card vendor code.
     * @example "VI"
     */
    Code?: string;
    /**
     * Used to specify the credit card security code.
     * @example "123"
     */
    CardSecurityCode?: string;
    /**
     * ExpireDate is used to specify the credit card expiration date, follows this format: YYYY-MM.
     * @pattern \d{4}-\d{2}
     * @example "2012-12"
     */
    ExpireDate?: string;
    /**
     * Used to specify extended payment if applicable.
     * @example 12
     */
    ExtendedPayment?: number;
    /**
     * Used to specify a manual credit card approval code if applicable.
     * @example "1234"
     */
    ManualApprovalCode?: string;
    /**
     * Used to indicate that the manual OB fee should be associated with the card.
     * @example "10.00"
     */
    ManualOBFee?: string;
    /**
     * Used to specify the credit card number.
     * @example 4123412341234123
     */
    Number?: number;
}