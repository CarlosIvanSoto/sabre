// Reglas para fijar los vuelos de un itinerario desnormalizado, compartidas por los
// helpers que arman requests a partir de él (Revalidate Itinerary, Create Booking).
// Ver sabre-wiki/wiki/concepts/modelo-de-itinerario.md.
import type { Itinerary, ItineraryGroup, LegSchedule } from './grouped-itinerary.js';

/** Un vuelo del itinerario con su fecha de salida ya resuelta y su clase de servicio. */
export interface ItineraryFlight {
  /** Índice del tramo (`legs[]`) al que pertenece. */
  legIndex: number;
  schedule: LegSchedule;
  /** `YYYY-MM-DD`, hora local del aeropuerto de salida. */
  departureDate: string;
  /** `YYYY-MM-DD`, hora local del aeropuerto de llegada. */
  arrivalDate: string;
  bookingCode: string;
}

/**
 * Aplana los vuelos del itinerario en orden.
 *
 * - La clase de servicio de cada vuelo sale de `fareComponents[].segments[].bookingCode` del
 *   primer pasajero de la primera cotización, en el orden de los vuelos del itinerario.
 * - Las fechas salen de `legDescriptions[].departureDate` más `departureDateAdjustment` del
 *   schedule (salida) y `arrival.dateAdjustment` (llegada).
 */
export function itineraryFlights(group: ItineraryGroup, itinerary: Itinerary): ItineraryFlight[] {
  const { legDescriptions } = group.groupDescription;
  if (legDescriptions.length !== itinerary.legs.length) {
    throw new TypeError(
      `sabre-client: el itinerario tiene ${itinerary.legs.length} tramos y el grupo ${legDescriptions.length}`,
    );
  }
  const classes = bookingCodes(itinerary);
  const flightCount = itinerary.legs.reduce((n, leg) => n + leg.schedules.length, 0);
  if (classes.length !== flightCount) {
    throw new TypeError(
      `sabre-client: el itinerario tiene ${flightCount} vuelos y ${classes.length} clases de servicio en fareComponents`,
    );
  }

  let next = 0;
  return itinerary.legs.flatMap((leg, legIndex) => {
    const legDate = legDescriptions[legIndex]!.departureDate;
    return leg.schedules.map((schedule) => {
      const departureDate = addDays(legDate, schedule.departureDateAdjustment ?? 0);
      return {
        legIndex,
        schedule,
        departureDate,
        arrivalDate: addDays(departureDate, schedule.arrival.dateAdjustment ?? 0),
        bookingCode: classes[next++]!,
      };
    });
  });
}

function bookingCodes(itinerary: Itinerary): string[] {
  const passenger = itinerary.pricingInformation[0]?.fare.passengerInfoList[0]?.passengerInfo;
  return (passenger?.fareComponents ?? []).flatMap((component) =>
    (component.segments ?? []).map(({ segment }) => {
      if (segment.bookingCode === undefined) {
        throw new TypeError('sabre-client: un segmento de fareComponents no trae bookingCode');
      }
      return segment.bookingCode;
    }),
  );
}

/** `2026-09-11` + n días, en calendario puro (sin zona horaria). */
function addDays(date: string, days: number): string {
  if (days === 0) return date;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
