import { CC_Info } from "./cc-info.interface"
import { Fare } from "./fare-interface.interface"
import { Tax } from "./tax-interface"
/** Used to specify valid for BSP-based clients. */
export interface BSP_Ticketing {
    /** MultipleFOP cannot combine with .../MultipleMiscFOP, or .../PayLaterPlan. */
    MultipleFOP?: MultipleFOP 
    /** MultipleMiscFOP cannot combine with .../MultipleFOP, or .../PayLaterPlan. */
    MultipleMiscFOP?: MultipleMiscFOP
    /** It is only applicable to Brazil, cannot combine with MultipleFOP, or MultipleMiscFOP. */
    PayLaterPlan?: PayLaterPlan
}
/** Used to specify the amount to be applied to the FOP. */
export interface FOP {
    /** Used to specify payment card details. */
    CC_Info?: CC_Info
    /**
     * Used to specify the payment type. Acceptable values are "CA", "CK" or "CQ".
     * If utilizing a credit card please omit @Type, and populate the .../CC_Info child node.
     * @example "CA"
     */
    Type?: string
    /**
     * Used to refer a line number from PNR FOP field.
     * @example 1
     */
    Reference?: number
}
/** MultipleFOP cannot combine with .../MultipleMiscFOP, or .../PayLaterPlan. */
export interface MultipleFOP {
    /** Used to specify the amount to be applied to the second FOP. */
    Fare: Fare 
    /** Used to specify form of payment. */
    FOP_One: FOP
    /** Used to specify second form of payment. */
    FOP_Two: FOP
    /**
     * Used to specify individual tax details.
     * @maxItems 3
     * @minItems 1
     */
    Taxes?: Tax[]
}
/** Used to pass number of months for extended payment. */
export interface ExtendedPayment {
    /**
     * Used to pass number of months.
     * @example 11
     */
    NumMonths: number
}
/** MultipleMiscFOP cannot combine with .../MultipleFOP, or .../PayLaterPlan. */
export interface MultipleMiscFOP {
    /** Used to specify the amount to be applied to the second FOP. */
    Fare: Fare
    /** Used to specify form of payment. */
    FOP_One: FOP
    /** Used to specify second form of payment. */
    FOP_Two: FOP_Two
    /** Used to pass tax details. */
    Taxes?: Tax[]
}
/** Used to specify second form of payment. */
export interface FOP_Two {
    /** Used to pass number of months for extended payment. */
    ExtendedPayment?: ExtendedPayment
    /**
     * Used to specify the misc payment.
     * @example "PL189947"
     */
    Type?: string
    /**
     * Used to reference a line number from PNR FOP field.
     * @example 1
     */
    Reference?: number
}

/** Used to specify the number of installments. */
export interface Installment {
    /**
     * Used to specify the number of installments.
     * @example "03"
     */
    Count: string
    /**
     * Used to specify the pay later reference number.
     * @example "XRG065"
     */
    PayLaterReferenceNumber: string
    /**
     * Used to specify the value of the installments. Please note that decimals are not permitted.
     * @example "10000"
     */
    Value: string
}
/** It is only applicable to Brazil, cannot combine with MultipleFOP, or MultipleMiscFOP. */
export interface PayLaterPlan {
    /** Used to specify the amount to be applied to the second FOP. */
    Fare: Fare
    /** Used to specify form of payment. */
    FOP: FOP
    /** Used to specify the number of installments. */
    Installment: Installment
}