import type { components as enhancedComponents } from "./enhanced-air-ticket.interface"
import type { components as revalidatedItineraryComponents } from "./revalidate-itinerary.interface"
import type { components as bfmComponents } from "./bargain-finder-max.interface"

export type EnhancedAirTicketSchema = enhancedComponents["schemas"]
export type EnhancedAirTicketOptions = enhancedComponents["schemas"]["EnhancedAirTicketRequest"]
export type EnhancedAirTicketResponseSuccess =enhancedComponents["schemas"]["EnhancedAirTicketResponse"]

export type BargainFinderMaxSchema = bfmComponents["schemas"]
export type BargainFinderMaxOptions = bfmComponents["schemas"]["BargainFinderMaxRequest"]
export type BargainFinderMaxResponseSuccess =bfmComponents["schemas"]["GroupedItineraryResponse"]

export type RevalidatedItinerarySchema = revalidatedItineraryComponents["schemas"]
export type RevalidateItineraryOptions = revalidatedItineraryComponents["schemas"]["RevalidateItineraryRequest"]
export type RevalidateItineraryResponseSuccess =revalidatedItineraryComponents["schemas"]["GroupedItineraryResponse"]