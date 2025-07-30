import { FlightQualifiers } from "./ticketing/flight-qualifiers.interface";
import { FOP_Qualifiers } from "./ticketing/fop-qualifiers.interface";
import { MiscQualifiers } from "./ticketing/misc-qualifiers.interface";
import { PricingQualifiers } from "./ticketing/pricing-qualifiers.interface";

/**
 * Used to repeat the node as many times as many tickets/ ticket types/EMDs are to be issued.
 * @maxItems 99
 * @minItems 1
 */
export interface Ticketing {
    FlightQualifiers?: FlightQualifiers
    FOP_Qualifiers?: FOP_Qualifiers
    MiscQualifiers?: MiscQualifiers
    PricingQualifiers?: PricingQualifiers
}