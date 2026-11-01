// Armado de `SeatAvailabilityByPayloadRq` de Get Seats desde un itinerario de BFM/Revalidate.
// El mapeo está inferido: ver la tabla "Armado del request desde el itinerario revalidado" en
// sabre-wiki/wiki/sdk/get-seats-en-el-sdk.md.
import { definedOnly } from '../config.js';
import type {
  SeatAvailabilityByPayloadRq,
  SeatFareComponent,
  SeatPassengerPayloadRq,
  SeatSegmentPayloadRq,
} from './get-seats.js';
import type { FareComponent, Itinerary, ItineraryGroup } from './grouped-itinerary.js';
import { itineraryFlights } from './itinerary-flights.js';

export interface SeatAvailabilityRequestSource {
  /** Grupo del itinerario: aporta la fecha de cada tramo. */
  group: ItineraryGroup;
  /** Itinerario elegido, idealmente el devuelto por Revalidate Itinerary. */
  itinerary: Itinerary;
  /** Índices 0-based de los vuelos para los que se piden mapas. Por defecto, todos. */
  segments?: number[];
  /** ISO 4217 para los precios de los asientos. Si falta, Sabre la elige. */
  currencyCode?: string;
}

/**
 * Arma el request de `sabre.air.getSeats` por payload para un itinerario ya revalidado.
 *
 * - `segments[]`: un segmento por vuelo, en el orden del itinerario, con `id` `S1`, `S2`, …
 *   (`IdType` exige empezar por letra). Vuelo, fechas y clase con las mismas reglas que
 *   `buildBookingFlightDetails`; horas en `HH:MM`. Si el operador o su número de vuelo difieren
 *   del comercializador, van en `operatingAirlineCode` / `operatingFlightNumber`.
 * - `fareComponents[]`: uno por componente de tarifa (`FC` + su `id` en BFM), con `fareBasis`,
 *   `governingCarrier` y `fareDetail`. `brandCode` no se manda: el itinerario no lo trae.
 * - `passengers[]`: `P1`, `P2`, … en el orden de `passengerInfoList`, repetidos según
 *   `passengerNumber`. Coinciden con `travelerIndex` de Create Booking si `travelers[]` va en
 *   el mismo orden. `fareSegmentAssociation` une cada segmento con su componente de tarifa.
 */
export function buildSeatAvailabilityRequest(source: SeatAvailabilityRequestSource): SeatAvailabilityByPayloadRq {
  const { group, itinerary, segments: only, currencyCode } = source;
  const flights = itineraryFlights(group, itinerary);

  const segments = flights.map(
    ({ schedule, departureDate, arrivalDate, bookingCode }, i): SeatSegmentPayloadRq => {
      const { carrier } = schedule;
      const operating =
        carrier.operating !== undefined &&
        (carrier.operating !== carrier.marketing ||
          (carrier.operatingFlightNumber !== undefined && carrier.operatingFlightNumber !== carrier.marketingFlightNumber));
      return {
        id: segmentId(i),
        bookingAirlineCode: carrier.marketing,
        bookingFlightNumber: carrier.marketingFlightNumber,
        departureAirportCode: schedule.departure.airport,
        arrivalAirportCode: schedule.arrival.airport,
        departureDate,
        departureTime: schedule.departure.time.slice(0, 5),
        arrivalDate,
        arrivalTime: schedule.arrival.time.slice(0, 5),
        bookingClassCode: bookingCode,
        ...(operating ? { operatingAirlineCode: carrier.operating! } : {}),
        ...(operating && carrier.operatingFlightNumber !== undefined
          ? { operatingFlightNumber: carrier.operatingFlightNumber }
          : {}),
      };
    },
  );

  const fare = itinerary.pricingInformation[0]?.fare;
  if (fare === undefined) {
    throw new TypeError('sabre-client: el itinerario no trae pricingInformation');
  }
  const fareComponents = new Map<string, SeatFareComponent>();
  const passengers: SeatPassengerPayloadRq[] = [];
  for (const { passengerInfo } of fare.passengerInfoList) {
    const fareSegmentAssociation: NonNullable<SeatPassengerPayloadRq['fareSegmentAssociation']> = [];
    let next = 0;
    for (const component of passengerInfo.fareComponents ?? []) {
      const fareComponentId = `FC${component.id}`;
      if (!fareComponents.has(fareComponentId)) fareComponents.set(fareComponentId, fareComponent(fareComponentId, component));
      for (const { segment } of component.segments ?? []) {
        const flight = segments[next];
        if (flight === undefined) break;
        if (flight.cabinCode === undefined && segment.cabinCode !== undefined) flight.cabinCode = segment.cabinCode;
        fareSegmentAssociation.push({ segmentRef: flight.id, fareComponentRef: fareComponentId });
        next++;
      }
    }
    for (let n = 0; n < (passengerInfo.passengerNumber ?? 1); n++) {
      passengers.push({
        id: `P${passengers.length + 1}`,
        passengerType: passengerInfo.passengerType,
        ...(fareSegmentAssociation.length === 0 ? {} : { fareSegmentAssociation }),
      });
    }
  }

  const refs = (only ?? segments.map((_s, i) => i)).map((i) => {
    if (!Number.isInteger(i) || i < 0 || i >= segments.length) {
      throw new TypeError(`sabre-client: segments pide el vuelo ${i}, y hay ${segments.length} (0-based)`);
    }
    return segmentId(i);
  });
  if (refs.length === 0) {
    throw new TypeError('sabre-client: segments no puede ir vacío');
  }

  return {
    returnSeatMapsOnlyForSegmentRefs: refs,
    segments,
    passengers,
    ...(fareComponents.size === 0 ? {} : { fareComponents: [...fareComponents.values()] }),
    ...(currencyCode === undefined ? {} : { currencyCode }),
  };
}

function segmentId(index: number): string {
  return `S${index + 1}`;
}

function fareComponent(fareComponentId: string, component: FareComponent): SeatFareComponent {
  const { fareBasisCode, governingCarrier, fareType, fareTariff, fareRule, fareTypeBitmap } = component;
  const fareDetail = definedOnly({ fareType, fareTariff, fareRule, fareTypeBitmap });
  return {
    fareComponentId,
    fareBasis: fareBasisCode,
    ...(governingCarrier === undefined ? {} : { governingCarrier }),
    ...(Object.keys(fareDetail).length === 0 ? {} : { fareDetail }),
  };
}

