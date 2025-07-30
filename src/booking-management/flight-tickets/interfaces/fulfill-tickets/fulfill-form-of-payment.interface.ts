const FUL_FILL_FORM_OF_PAYMENT = {
  PAYMENTCARD: "PAYMENTCARD",
  CASH: "CASH",
  CHECK: "MISCELLANEOUS",
  INSTALLMENTS: "INSTALLMENTS",
  VIRTUAL_CARD: "VIRTUAL_CARD",
  INVOICE: "INVOICE"
} as const
/**
 * Identifies the type of the form of payment supported for fulfillment. 
 * Can be CASH, CHECK, PAYMENTCARD, VIRTUAL_CARD, INVOICE, MISCELLANEOUS 
 * (must be activated by the agency; requires a specific payment credit code), 
 * or INSTALLMENTS (applies only for BSP Brazil customers and refers to payment by means of card installments 
 * commonly referred to as "parcelado").
 */
type FulfillFormOfPaymentTypeEnum = keyof typeof FUL_FILL_FORM_OF_PAYMENT;
/** 
 * Contains strong customer authentication details for a payment card.
*/
interface FulfillStrongCustomerAuthentication {
    /**
     * pattern:^[A-Z0-9]{2}$
     * example:MO
     * The channel in which a payment transaction was initiated. Can be MO (Mail Order) or TO (Telephone Order).
     */
    channelCode?: string
}
/**
 * Contains details of a form of payment.
 */
export interface FulfillFormsOfPayment {
    /** 
     * pattern:^[A-Z]{2}$
     * example: VI
     * The vendor code of a credit or debit card. Use with PAYMENTCARD.
    */
    cardTypeCode?: string
    /** 
     * pattern:^[0-9]{12,19}|([0-9]X{7,14}[0-9]{4})$
     * example: 4537156488578956
     * The number of a credit or debit card. Use with PAYMENTCARD.
    */
    cardNumber?: string
    /** 
     * pattern:^[0-9]{3,4}$
     * example: 123
     * The security code of a credit or debit card. Use with PAYMENTCARD.
    */
    cardSecurityCode?: string
    /** 
     * pattern:^(20)\d\d-(0[1-9]|1[012])$
     * example:2024-07
     * The expiration date of a credit or debit card. Use with PAYMENTCARD.
    */
    expiryDate?: string
    /** 
     * minimum:1
     * maximum:96
     * example:12
     * The number of months by which your payment can be extended. Use with PAYMENTCARD or MISCELLANEOUS.
    */
    extendedPayment?: BigInteger
    /** 
     * minLength:2
     * maxLength:18
     * example:PL189947
     * The miscellaneous credit code. Use with MISCELLANEOUS.
    */
    miscellaneousCreditCode?: string
    /** 
     * minimum:1
     * maximum:96
     * example:4
     * The number of installments. Use with INSTALLMENTS.
    */
    numberOfInstallments?: BigInteger
    /** 
     * example:RG065
     * The airline plan code. Use with INSTALLMENTS.
    */
    airlinePlanCode?: string
    /** 
     * pattern:^[0-9]+$
     * example:100
     * The amount of the first installment. Use with INSTALLMENTS.
    */
    installmentAmount?: string
    type: FulfillFormOfPaymentTypeEnum
    /** 
     * maxLength:6
     * example:12345
     * The manual approval code of a credit or debit card. Use with PAYMENTCARD.
    */
    manualApprovalCode?: string
    /** 
     * example:SABREVIRTUAL
     * The customer account code of a virtual card. Use with VIRTUAL_CARD.
    */
    virtualCardCode?: string
    /**
     * minItems:1
     * maxItems:10
     * Lists all strong customer authentication details for a payment card. Use with PAYMENTCARD.
     */
    authentications?: FulfillStrongCustomerAuthentication[]
    /**
     * example:AGT INVOICE
     * Details of the agency invoice selected as form of payment in free text format. Use with type set to INVOICE.
     */
    invoiceDescription?: string
    /** 
     * example:false
     * If true, the invoice form of payment free text description is preceded by a substring INV/. 
     * Use with INVOICE and invoice description.
    */
    addInvoiceDescriptionPrefix?: boolean
}