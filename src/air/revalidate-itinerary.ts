// Revalidate Itinerary v5 (`POST /v5/shop/flights/revalidate`).
// Ver sabre-wiki/wiki/entities/revalidate-itinerary.md.
import type { SabreError } from '../errors/index.js';
import type { RestTransport } from '../http/rest-transport.js';
import { BARGAIN_FINDER_MAX_CATALOG, type BargainFinderMaxRequest, type RequestOptions } from './bargain-finder-max.js';
import {
  denormalizeGroupedItineraryResponse,
  type GroupedItineraryResponse,
  type Itinerary,
  type ItineraryGroup,
  type RawGroupedItineraryResponse,
} from './grouped-itinerary.js';
import { type ItineraryFlight, itineraryFlights } from './itinerary-flights.js';
import { classifyItineraryMessages, type ItineraryMessageCatalogEntry } from './itinerary-messages.js';
import type {
  LowFareSearchFlight,
  LowFareSearchOriginDestination,
  OtaAirLowFareSearchRq,
} from './low-fare-search-request.js';

export const REVALIDATE_ITINERARY_SERVICE = 'revalidateItinerary';
const PATH = '/v5/shop/flights/revalidate';

/** Body de Revalidate Itinerary v5: el mismo `OTA_AirLowFareSearchRQ` que BFM, con los vuelos fijados. */
export interface RevalidateItineraryRequest {
  OTA_AirLowFareSearchRQ: OtaAirLowFareSearchRq;
}

/** `groupedItineraryResponse` con las referencias ya resueltas. */
export type RevalidateItineraryResponse = GroupedItineraryResponse;

export async function revalidateItinerary(
  transport: RestTransport,
  request: RevalidateItineraryRequest,
  options: RequestOptions = {},
): Promise<RevalidateItineraryResponse> {
  if (typeof request !== 'object' || request === null || typeof request.OTA_AirLowFareSearchRQ !== 'object') {
    throw new TypeError('sabre-client: revalidateItinerary espera { OTA_AirLowFareSearchRQ: { ... } }');
  }
  const body = await transport.request<{ groupedItineraryResponse: RawGroupedItineraryResponse }>({
    method: 'POST',
    path: PATH,
    service: REVALIDATE_ITINERARY_SERVICE,
    // POST, pero de solo lectura: no sostiene inventario, se puede reintentar.
    idempotent: true,
    body: request,
    classify: classifyRevalidateItinerary,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onRawResponse === undefined
      ? {}
      : { operation: 'air.revalidateItinerary', onRawResponse: options.onRawResponse }),
  });
  return denormalizeGroupedItineraryResponse(body.groupedItineraryResponse, REVALIDATE_ITINERARY_SERVICE);
}

/**
 * Catálogo de errores de Revalidate (guía oficial de errores de Revalidate Itinerary, en la
 * documentación SOAP de BFM 7.2.0; ver sabre-wiki/wiki/entities/revalidate-itinerary.md).
 * Las cinco condiciones describen un dato que no existe (tarifa, horario o disponibilidad):
 * reintentar no cambia el resultado. En producción, `NO FARE FOR CLASS USED` llegó con
 * `code: 'PROCESS'`; el catálogo le da un `code` estable.
 *
 * Los temporales se heredan de BFM (mismo motor), con `retryable: true`.
 */
export const REVALIDATE_ITINERARY_CATALOG: ReadonlyArray<ItineraryMessageCatalogEntry> = [
  { code: 'NO COMBINABLE FARES FOR CLASS USED', retryable: false },
  { code: 'NO FARE FOR CLASS USED', retryable: false },
  { code: 'NO FLIGHT SCHEDULES FOR QUALIFIERS USED', retryable: false },
  { code: 'NO SUCH FLIGHT', retryable: false },
  { code: 'NO AVAILABILITY', retryable: false },
  ...BARGAIN_FINDER_MAX_CATALOG.filter((entry) => entry.retryable),
];

/** Ver `classifyItineraryMessages`. */
export function classifyRevalidateItinerary(body: unknown): SabreError | undefined {
  return classifyItineraryMessages(body, REVALIDATE_ITINERARY_SERVICE, REVALIDATE_ITINERARY_CATALOG);
}

export interface RevalidateItineraryRequestSource {
  /** Request de BFM que produjo el itinerario: aporta `Version`, `POS`, pasajeros y `TPA_Extensions`. */
  search: BargainFinderMaxRequest;
  /** Grupo del itinerario: aporta la fecha de cada tramo. */
  group: ItineraryGroup;
  itinerary: Itinerary;
}

/**
 * Arma el request de Revalidate Itinerary para un itinerario devuelto por BFM, fijando cada
 * vuelo en `OriginDestinationInformation[].TPA_Extensions.Flight[]`.
 *
 * - Clases de servicio y fechas: ver `itineraryFlights`. Las horas salen de `time` sin el offset.
 * - `MaxStopsQuantity` es el máximo de conexiones de un tramo, para no rechazar itinerarios
 *   con escala.
 * - `Fixed: false` y `VerificationItinCallLogic: "L"` se copian del ejemplo de Sabre; su
 *   efecto no está documentado.
 */
export function buildRevalidateItineraryRequest(source: RevalidateItineraryRequestSource): RevalidateItineraryRequest {
  const { search, group, itinerary } = source;
  const flights = itineraryFlights(group, itinerary);

  const originDestinations = itinerary.legs.map((_leg, i): LowFareSearchOriginDestination => {
    const legFlights = flights.filter((f) => f.legIndex === i).map(flight);
    const first = legFlights[0]!;
    const last = legFlights.at(-1)!;
    return {
      Fixed: false,
      DepartureDateTime: first.DepartureDateTime,
      OriginLocation: { LocationCode: first.OriginLocation.LocationCode },
      DestinationLocation: { LocationCode: last.DestinationLocation.LocationCode },
      TPA_Extensions: { Flight: legFlights },
    };
  });

  const { Version, POS, TravelerInfoSummary, TPA_Extensions } = search.OTA_AirLowFareSearchRQ;
  return {
    OTA_AirLowFareSearchRQ: {
      Version,
      POS,
      OriginDestinationInformation: originDestinations,
      TravelPreferences: {
        MaxStopsQuantity: Math.max(...itinerary.legs.map((leg) => leg.schedules.length - 1)),
        TPA_Extensions: { VerificationItinCallLogic: { Value: 'L' } },
      },
      TravelerInfoSummary,
      ...(TPA_Extensions === undefined ? {} : { TPA_Extensions }),
    },
  };
}

function flight({ schedule, departureDate, arrivalDate, bookingCode }: ItineraryFlight): LowFareSearchFlight {
  const { carrier } = schedule;
  return {
    Type: 'A',
    Number: carrier.marketingFlightNumber,
    DepartureDateTime: `${departureDate}T${localTime(schedule.departure.time)}`,
    ArrivalDateTime: `${arrivalDate}T${localTime(schedule.arrival.time)}`,
    ClassOfService: bookingCode,
    OriginLocation: { LocationCode: schedule.departure.airport },
    DestinationLocation: { LocationCode: schedule.arrival.airport },
    Airline: {
      Marketing: carrier.marketing,
      ...(carrier.operating === undefined ? {} : { Operating: carrier.operating }),
    },
  };
}

/** `17:10:00+02:00` → `17:10:00`. */
function localTime(time: string): string {
  return time.slice(0, 8);
}
