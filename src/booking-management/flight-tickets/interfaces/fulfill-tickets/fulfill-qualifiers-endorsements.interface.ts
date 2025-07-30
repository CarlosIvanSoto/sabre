/**
 * 	Contains information that may be used to replace the ticket endorsement text stored during pricing.
 */
export interface Endorsements{
    /**
     * example:REF AGY ONLY
     * The original text for the endorsements field.
    */
    description?: string
    /** 
     *  example:true
     * If true, overrides all pre-programmed endorsements and prints special endorsements of the fare.
    */
    useOverride?: string
}