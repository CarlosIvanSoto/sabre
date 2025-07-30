/**
 * This element is used to return a summary information about the documents that were found.
 */
export interface Summary {
    /**
     * Used to specify serial number.
     * @example "8298200110468"
     */
    DocumentNumber?: string
    /**
     * Used to specify issue date and time - in local time zone of the station that issued it.
     * @example "2024-09-08T16:11:32.000Z"
     */
    LocalIssueDateTime?: string
    /**
     * Used to specify type of the document. Possible values are TKT, MSR and EMD.
     * @example "TKT"
     */
    DocumentType?: string
    /**
     * Used to specify station location code (usually city code) of the station that issued the document.
     * @example "G7HE"
     */
    IssuingLocation?: string
    /** Used to specify PNR locator of the PNR containing this document. Returned if the document is a part of a PNR. */
    Reservation?: Reservation
    /**
     * Used to specify first name of the customer.
     * @example "ADAM"
     */
    FirstName?: string
    /**
     * Used to specify last name (family name or surname) of the customer.
     * @example "JONES"
     */
    LastName?: string
    /**
     * DocumentStatus is used to specify status of the document found (of the whole document, not particular coupon).
     *
     * Possible values: V - VOIDED E - EXCHANGED R - REFUNDED.
     * @example "V"
     */
    DocumentStatus?: string
    /** Used to describe amount of money paid for this document. */
    TotalAmount?: TotalAmount
    /**
     * Used to indicate that the ticket number has been commited to the face of the PNR.
     * @example true
     */
    committed?: boolean
}
/** Used to specify PNR locator of the PNR containing this document. Returned if the document is a part of a PNR. */
export interface Reservation {
    /**
     * Used to specify Passenger Name Record (PNR) locator of the PNR containing this document. Returned if the document is a part of a PNR.
     * @example "DHTYAF"
     */
    content?: string
    /**
     * Used to inform about the code of the airline that owns the PNR. Optional.
     * @example "SY"
     */
    provider?: string
    /**
     * Used to specify purge date informs about the purge date of the PNR. Optional.
     * @example "2024-12-17T09:30:47Z"
     */
    purgeDate?: string
    /**
     * Used to inform about the creation date of the PNR. Optional.
     * @example "2024-12-17T09:30:47Z"
     */
    createDate?: string
}
/** Used to describe amount of money paid for this document. */
export interface TotalAmount {
    /**
     * Used to specify amount of money paid.
     * @example "60.0"
     */
    content?: string
    /**
     * Used to specify the code of the currency in which the amount is expressed.
     * @example "USD"
     */
    currencyCode?: string
    /**
     * Used to indicate the number of decimal places required by the currency.
     * @example 2
     */
    decimalPlace?: number
}