// Flujo de Air Booking del Tier 1: Bargain Finder Max → Revalidate Itinerary → Create Booking.
// Solo usa la API pública del SDK y Web Standard APIs. Lo corre run-air-booking-flow.mjs y lo
// cubren los tests con `fetch` mockeado. Ver sabre-wiki/wiki/sdk/alcance-inicial-air-booking.md.
import { buildBookingFlightDetails, buildRevalidateItineraryRequest, SabreBusinessError } from 'sabre-client';

/** Pasajero sintético: el ejemplo nunca usa datos reales. */
export const SYNTHETIC_TRAVELER = {
  givenName: 'TEST',
  surname: 'PASSENGER',
  passengerCode: 'ADT',
  emails: ['test@example.com'],
  phones: [{ number: '5550000000', label: 'M' }],
};

/**
 * Itinerarios de BFM que se intentan revalidar antes de rendirse. En producción, Revalidate
 * rechazó con `NO FARE FOR CLASS USED` itinerarios de DL en clase E que BFM sí había cotizado.
 */
export const REVALIDATE_ATTEMPTS = 3;

/**
 * Búsqueda de solo ida para un adulto, la mínima que acepta Bargain Finder Max v5.
 * `maxStops: 0` deja solo vuelos directos.
 */
export function oneWaySearch({ pcc, origin, destination, departureDateTime, maxStops = 1 }) {
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
      TravelPreferences: { MaxStopsQuantity: maxStops },
      TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
      TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
    },
  };
}

/**
 * Busca y revalida el primer itinerario que Revalidate acepte (prueba hasta `REVALIDATE_ATTEMPTS`
 * y salta los que rechaza con `SabreBusinessError`). Solo si `book` es `true`, lo reserva por
 * `flightDetails` (ATPCO). Con `preview` arma el request de Create Booking y lo devuelve en
 * `bookingPreview` sin enviarlo: no crea PNR, así que sirve también en producción.
 * `priceComparison` fija el umbral de precio de Create Booking sobre el precio revalidado.
 * Devuelve un resumen sin datos del pasajero ni credenciales.
 *
 * @param {import('sabre-client').Sabre} sabre
 * @param {{
 *   search: import('sabre-client').BargainFinderMaxRequest,
 *   book?: boolean,
 *   preview?: boolean,
 *   priceComparison?: import('sabre-client').BookingFlightDetailsSource['priceComparison'],
 *   onStep?: (step: string, detail: Record<string, unknown>) => void,
 * }} options
 */
export async function airBookingFlow(sabre, { search, book = false, preview = false, priceComparison, onStep = () => {} }) {
  if (book && preview) throw new TypeError('book y preview son excluyentes');
  const found = await sabre.air.bargainFinderMax(search);
  const candidates = found.itineraryGroups.flatMap((group) =>
    group.itineraries.map((itinerary) => ({ group, itinerary })),
  );
  onStep('bargainFinderMax', { itineraries: candidates.length });
  if (candidates.length === 0) throw new Error('Bargain Finder Max no devolvió itinerarios');

  let chosen, revalidated, lastError;
  const skipped = [];
  for (const candidate of candidates.slice(0, REVALIDATE_ATTEMPTS)) {
    try {
      revalidated = await sabre.air.revalidateItinerary(buildRevalidateItineraryRequest({ search, ...candidate }));
      chosen = candidate;
      break;
    } catch (error) {
      if (!(error instanceof SabreBusinessError)) throw error;
      lastError = error;
      const detail = { flights: describeFlights(candidate.itinerary), code: error.code, message: error.message };
      skipped.push(detail);
      onStep('revalidateItinerarySkipped', detail);
    }
  }
  if (chosen === undefined || revalidated === undefined) throw lastError;

  const group = revalidated.itineraryGroups[0];
  const itinerary = group?.itineraries[0];
  if (itinerary === undefined) throw new Error('Revalidate Itinerary no devolvió el itinerario');
  const summary = {
    itineraries: candidates.length,
    skipped,
    flights: describeFlights(itinerary),
    searchPrice: price(chosen.itinerary),
    revalidatedPrice: price(itinerary),
    bookingPreview: /** @type {import('sabre-client').CreateBookingRequest | undefined} */ (undefined),
    booking: undefined,
  };
  onStep('revalidateItinerary', { flights: summary.flights, price: summary.revalidatedPrice });

  if (!book && !preview) return summary;

  /** @type {import('sabre-client').CreateBookingRequest} */
  const request = {
    flightDetails: buildBookingFlightDetails({ group, itinerary, ...(priceComparison === undefined ? {} : { priceComparison }) }),
    travelers: [SYNTHETIC_TRAVELER],
    contactInfo: { emails: ['test@example.com'], phones: ['5550000000'] },
  };
  if (preview) {
    summary.bookingPreview = request;
    onStep('createBookingPreview', { flights: request.flightDetails.flights.length });
    return summary;
  }

  const booking = await sabre.booking.create(request);
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
