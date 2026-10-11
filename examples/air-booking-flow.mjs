// Flujo de Air Booking del Tier 1: Bargain Finder Max → Revalidate Itinerary → Create Booking.
// Solo usa la API pública del SDK y Web Standard APIs. Lo corre run-air-booking-flow.mjs y lo
// cubren los tests con `fetch` mockeado. Ver sabre-wiki/wiki/sdk/alcance-inicial-air-booking.md.
import { buildBookingFlightDetails, buildRevalidateItineraryRequest } from 'sabre-client';

/** Pasajero sintético: el ejemplo nunca usa datos reales. */
export const SYNTHETIC_TRAVELER = {
  givenName: 'TEST',
  surname: 'PASSENGER',
  passengerCode: 'ADT',
  emails: ['test@example.com'],
  phones: [{ number: '5550000000', label: 'M' }],
};

/** Búsqueda de solo ida para un adulto, la mínima que acepta Bargain Finder Max v5. */
export function oneWaySearch({ pcc, origin, destination, departureDateTime }) {
  return {
    OTA_AirLowFareSearchRQ: {
      Version: '5',
      POS: { Source: [{ PseudoCityCode: pcc, RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
      OriginDestinationInformation: [
        {
          DepartureDateTime: departureDateTime,
          OriginLocation: { LocationCode: origin },
          DestinationLocation: { LocationCode: destination },
        },
      ],
      TravelPreferences: { MaxStopsQuantity: 1 },
      TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
      TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
    },
  };
}

/**
 * Busca, revalida el primer itinerario y, solo si `book` es `true`, lo reserva por
 * `flightDetails` (ATPCO). Devuelve un resumen sin datos del pasajero ni credenciales.
 *
 * @param {import('sabre-client').Sabre} sabre
 * @param {{
 *   search: import('sabre-client').BargainFinderMaxRequest,
 *   book?: boolean,
 *   onStep?: (step: string, detail: Record<string, unknown>) => void,
 * }} options
 */
export async function airBookingFlow(sabre, { search, book = false, onStep = () => {} }) {
  const found = await sabre.air.bargainFinderMax(search);
  const candidates = found.itineraryGroups.flatMap((group) =>
    group.itineraries.map((itinerary) => ({ group, itinerary })),
  );
  onStep('bargainFinderMax', { itineraries: candidates.length });
  const first = candidates[0];
  if (first === undefined) throw new Error('Bargain Finder Max no devolvió itinerarios');

  const revalidated = await sabre.air.revalidateItinerary(buildRevalidateItineraryRequest({ search, ...first }));
  const group = revalidated.itineraryGroups[0];
  const itinerary = group?.itineraries[0];
  if (itinerary === undefined) throw new Error('Revalidate Itinerary no devolvió el itinerario');
  const summary = {
    itineraries: candidates.length,
    flights: describeFlights(itinerary),
    searchPrice: price(first.itinerary),
    revalidatedPrice: price(itinerary),
    booking: undefined,
  };
  onStep('revalidateItinerary', { flights: summary.flights, price: summary.revalidatedPrice });

  if (!book) return summary;

  const booking = await sabre.booking.create({
    flightDetails: buildBookingFlightDetails({ group, itinerary }),
    travelers: [SYNTHETIC_TRAVELER],
    contactInfo: { emails: ['test@example.com'], phones: ['5550000000'] },
  });
  summary.booking = {
    confirmationId: booking.confirmationId,
    warnings: booking.warnings.map((warning) => warning.code),
    errors: booking.errors.map((error) => error.code),
  };
  onStep('createBooking', summary.booking);
  return summary;
}

function describeFlights(itinerary) {
  return itinerary.legs
    .flatMap((leg) => leg.schedules)
    .map((s) => `${s.carrier.marketing}${s.carrier.marketingFlightNumber} ${s.departure.airport}→${s.arrival.airport}`)
    .join(' / ');
}

function price(itinerary) {
  const total = itinerary.pricingInformation[0]?.fare.totalFare;
  return total === undefined ? undefined : `${total.totalPrice} ${total.currency}`;
}
