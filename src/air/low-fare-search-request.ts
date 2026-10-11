// Wrapper de request `OTA_AirLowFareSearchRQ` (v5), compartido por Bargain Finder Max y
// Revalidate Itinerary. Ver sabre-wiki/wiki/concepts/modelo-de-itinerario.md.
//
// Se tipan los campos confirmados por los ejemplos del wiki; el schema real de Sabre es mucho
// más amplio, así que cada bloque acepta campos extra sin tiparlos.

export interface LowFareSearchLocation {
  LocationCode: string;
  [key: string]: unknown;
}

export interface LowFareSearchRequestorId {
  Type: string;
  ID: string;
  CompanyName: { Code: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface LowFareSearchSource {
  /** PCC desde el que se busca. El SDK no lo inyecta desde `config.pcc`. */
  PseudoCityCode: string;
  RequestorID: LowFareSearchRequestorId;
  [key: string]: unknown;
}

export interface LowFareSearchOriginDestination {
  /** Fecha y hora local sin offset, p. ej. `2026-09-11T20:00:00`. */
  DepartureDateTime: string;
  OriginLocation: LowFareSearchLocation;
  DestinationLocation: LowFareSearchLocation;
  [key: string]: unknown;
}

export interface LowFareSearchTravelPreferences {
  /** `0` = solo directos. */
  MaxStopsQuantity?: number;
  /** Filtro por aerolínea. */
  VendorPref?: Array<{ Code: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface LowFareSearchPassengerTypeQuantity {
  /** Tipo de pasajero, p. ej. `ADT`. */
  Code: string;
  Quantity: number;
  [key: string]: unknown;
}

export interface LowFareSearchTravelerInfoSummary {
  AirTravelerAvail: Array<{ PassengerTypeQuantity: LowFareSearchPassengerTypeQuantity[]; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface LowFareSearchTpaExtensions {
  IntelliSellTransaction?: {
    /** Propietario de Sabre, p. ej. `50ITINS`; significado exacto sin confirmar. */
    RequestType: { Name: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Contenido de `OTA_AirLowFareSearchRQ`. */
export interface OtaAirLowFareSearchRq {
  /** `"5"`. El SDK no lo completa. */
  Version: string;
  POS: { Source: LowFareSearchSource[]; [key: string]: unknown };
  OriginDestinationInformation: LowFareSearchOriginDestination[];
  TravelPreferences?: LowFareSearchTravelPreferences;
  TravelerInfoSummary: LowFareSearchTravelerInfoSummary;
  TPA_Extensions?: LowFareSearchTpaExtensions;
  [key: string]: unknown;
}
