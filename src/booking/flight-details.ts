// Armado de `flightDetails` de Create Booking desde un itinerario de BFM/Revalidate.
// El mapeo está inferido, ninguna fuente lo documenta: ver la tabla "Mapeo desde un
// itinerario de BFM/Revalidate → flightDetails" en sabre-wiki/wiki/entities/booking-management-api.md.
import type { Itinerary, ItineraryGroup } from '../air/grouped-itinerary.js';
import { itineraryFlights } from '../air/itinerary-flights.js';
import type { FlightDetails, FlightToBook, PassengerPricing, PriceComparison } from './create-booking-request.js';

export interface BookingFlightDetailsSource {
  /** Grupo del itinerario: aporta la fecha de cada tramo. */
  group: ItineraryGroup;
  /** Itinerario elegido, idealmente el devuelto por Revalidate Itinerary. */
  itinerary: Itinerary;
  /**
   * Umbral de precio. `desiredAmount` sale de `totalFare.totalPrice` del itinerario. El spec no
   * tiene campo de moneda: se supone la del pricing (la del PCC, salvo `currencyPricing`).
   */
  priceComparison?: Omit<PriceComparison, 'desiredAmount'>;
}

/**
 * Arma `flightDetails` para reservar por el camino ATPCO un itinerario ya revalidado.
 *
 * - `flights[]`: vuelo comercializador, aeropuertos, fecha y clase con las mismas reglas que
 *   Revalidate (`itineraryFlights`); `departureTime` en `HH:MM` y `flightStatusCode: 'NN'`.
 *   `isMarriageGroup` no se manda: no hay fuente para él.
 * - `flightPricing[0].qualifiers`: `passengersPricing` desde `passengerInfoList` y
 *   `validatingAirlineCode` desde `validatingCarrierCode` de la primera cotización.
 */
export function buildBookingFlightDetails(source: BookingFlightDetailsSource): FlightDetails {
  const { group, itinerary, priceComparison } = source;
  const flights = itineraryFlights(group, itinerary).map(
    ({ schedule, departureDate, bookingCode }): FlightToBook => ({
      flightNumber: schedule.carrier.marketingFlightNumber,
      airlineCode: schedule.carrier.marketing,
      fromAirportCode: schedule.departure.airport,
      toAirportCode: schedule.arrival.airport,
      departureDate,
      departureTime: schedule.departure.time.slice(0, 5),
      bookingClass: bookingCode,
      flightStatusCode: 'NN',
    }),
  );

  const fare = itinerary.pricingInformation[0]?.fare;
  if (fare === undefined) {
    throw new TypeError('sabre-client: el itinerario no trae pricingInformation');
  }
  const passengersPricing = fare.passengerInfoList.map(
    ({ passengerInfo }): PassengerPricing => ({
      passengerCode: passengerInfo.passengerType,
      numberOfpassengers: passengerInfo.passengerNumber ?? 1,
    }),
  );

  let priceComparisons: PriceComparison[] | undefined;
  if (priceComparison !== undefined) {
    const total = fare.totalFare?.totalPrice;
    if (total === undefined) {
      throw new TypeError('sabre-client: el itinerario no trae totalFare.totalPrice para priceComparison');
    }
    priceComparisons = [{ desiredAmount: amount(total), ...priceComparison }];
  }

  return {
    flights,
    flightPricing: [
      {
        ...(priceComparisons === undefined ? {} : { priceComparisons }),
        qualifiers: {
          passengersPricing,
          ...(fare.validatingCarrierCode === undefined ? {} : { validatingAirlineCode: fare.validatingCarrierCode }),
        },
      },
    ],
  };
}

/** `1234.5` → `'1234.5'`; el spec acepta hasta 3 decimales. */
function amount(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
