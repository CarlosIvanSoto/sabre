/**
 * Used to instruct the system to price specified itinerary segments.
 */
export interface SegmentSelect{
    /**
     * Used to identify end of range for specified itinerary segments.
     * @example 3
     */
    EndNumber?: number;
    /**
     * Used to instruct the system to price specified itinerary segments.
     * @example 1
     */
    Number: number;
    /**
     * Used to match up with ".../SpecificFare/@RPH" or .../Brand.
     * @example "1"
     */
    RPH?: string;
}