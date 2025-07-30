/** Used to specify individual tax details. */
export interface Tax {
    /**
     * Used to specify the tax amount.
     * @example "30.00"
     */
    Amount: string;
    /**
     * Used to specify the tax code.
     * @example "XT"
     */
    TaxCode: string;
}