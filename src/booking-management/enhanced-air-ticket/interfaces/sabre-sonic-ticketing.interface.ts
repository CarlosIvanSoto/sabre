import { CC_Info } from "./cc-info.interface"
import { Fare } from "./fare-interface.interface"
import { Tax } from "./tax-interface"

export interface SabreSonicTicketing {
    /** It cannot combine with .../EnhancedMultipleFOP, or .../MultipleFOP. */
    BasicFOP?: SSTBasicFOP
    /** It is only valid for SabreSonic-based airlines who have activated the enhanced multiple form of payment option, it cannot combine with .../MultipleFOP. */
    EnhancedMultipleFOP?: SSTEnhancedMultipleFOP
    /** It cannot combine with .../EnhancedMultipleFOP. */
    MultipleFOP?: SSTMultipleFOP
}
/** It cannot combine with .../EnhancedMultipleFOP, or .../MultipleFOP. */
export interface SSTBasicFOP {
    /** Used to specify payment card details. */
    CC_Info?: CC_Info
    /**
     * Used to specify a manual approval code for non-credit card forms of payment.
     * @example "1234"
     */
    ManualApprovalCode?: string
    /**
     * Used to specify the payment type. Acceptable values are "CA" (cash), "CK" (check), "CQ" (cheque) "PT", "PTACA" (PTA cash), "PTAGTCK" (PTA agency check) or "PTCK" (PTA check).
     * If utilizing a credit card please omit @Type, and populate the .../CC_Info child node, unless needing to specify a PTA credit card form of payment.
     * For a PTA credit card form of payment the client should pass Type="PT" and populate the .../CC_Info child node with the relevant credit card information.
     * @example "CK"
     */
    Type?: string
}
/** It is only valid for SabreSonic-based airlines who have activated the enhanced multiple form of payment option, it cannot combine with .../MultipleFOP. */
export interface SSTEnhancedMultipleFOP {
    /** Used to specify the amount to be applied to the second FOP. */
    Fare: Fare 
    /** Used to specify form of payment. */
    FOP_One: FOP
    /** Used to specify form of payment. */
    FOP_Two: FOP
    /** Used to pass tax details. */
    Taxes: Tax
}
/** Used to specify form of payment. */
interface FOP {
    /** Used to specify payment card details. */
    CC_Info?: CC_Info
    /**
     * It is Used to specify the payment type. Acceptable values are "CA", "CK" or "CQ".
     * If utilizing a credit card please omit @Type, and populate the .../CC_Info child node.
     * @example "CK"
     */
    Type?: string
}
 /** It cannot combine with .../EnhancedMultipleFOP. */
export interface SSTMultipleFOP {
    /** Used to specify the amount to be applied to the second FOP. */
    Fare: Fare
    /** Used to specify form of payment. */
    FOP_One: FOP
    /** Used to specify form of payment. */
    FOP_Two: FOP
    /** Used to pass tax details. */
    Taxes?: Tax
}