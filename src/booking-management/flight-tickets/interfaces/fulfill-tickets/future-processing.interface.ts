/**
 * Contains details of a so-called future processing or future pricing line (FP).
 */
export interface FutureProcessing {
    /** 
     * minimum:1
     * maximum:999
     * example:1
     * The number of the first FP line in a sequence.
    */
    firstLineNumber: BigInteger
    /** 
     * minimum:1
     * maximum:999
     * example:3
     * The number of the last FP line in a sequence.
    */
    lastLineNumber?: BigInteger
    /** 
     * minimum:1
     * example:1
     * The item number of the traveler in the travelers array to whom the future processing or pricing is assigned.
    */
    travelerIndex?: BigInteger

}