import { CC_Info } from "./cc-info.interface"

export interface BasicFOP {
    /** Used to specify payment card details. */
    CC_Info?: CC_Info
    /**
     * Used to pass cost center information. It cannot combine with @Reference and @Virtual.
     * @example "123456789123"
     */
    CostCenter?: string;
    /**
     * Used to refer a line number from PNR Form of Payment (FOP) field.
     * This capability is only available once the agency has activated Sabre's new FOP functionality in the corresponding PCC (TJR setting: PNAPNR),
     * for additional information please contact your Sabre Account Team.
     * @example 1
     */
    Reference?: number;
    /**
     * Used to specify the payment type.
     * Acceptable values are "CA" (cash), "CK" (check), "CQ" (cheque).
     * If utilizing a credit card please omit @Type, and populate the .../CC_Info child node.
     * @example "CK"
     */
    Type?: string;
    /**
     * Used to pass virtual form of payment information.
     * @example "SABREAIRONETWOFOUR"
     */
    Virtual?: string;
} 