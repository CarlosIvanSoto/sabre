/** Used to pass flight related qualifiers. */
export interface FlightQualifiers {
    VendorPrefs?: VendorPrefers
}
export interface VendorPrefers {
    /** Used to specify the airline. */
    Airline: Airline
}
export interface Airline {
    /**
     * Used to specify a particular vendor code.
     * @example "XX"
     */
    Code: string
}