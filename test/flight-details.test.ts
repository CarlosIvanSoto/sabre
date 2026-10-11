import { describe, expect, it, vi } from 'vitest';
import {
  buildBookingFlightDetails,
  type Itinerary,
  type ItineraryGroup,
  type RevalidateItineraryRequest,
  Sabre,
} from '../src/index.js';
import connection from './fixtures/revalidate-itinerary.sandbox-connection.json';
import direct from './fixtures/revalidate-itinerary.sandbox-direct.json';
import { config, json } from './helpers.js';

interface Fixture {
  request: RevalidateItineraryRequest;
  response: { status: number; body: unknown };
}

async function revalidated(fixture: Fixture) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
    String(input).includes('/auth/token')
      ? json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' })
      : json(fixture.response.status, fixture.response.body),
  );
  const result = await new Sabre(config({ fetch })).air.revalidateItinerary(fixture.request);
  const group = result.itineraryGroups[0]!;
  return { group, itinerary: group.itineraries[0]! };
}

describe.each([
  ['directo ida y vuelta', direct as unknown as Fixture],
  ['con conexión al día siguiente', connection as unknown as Fixture],
])('buildBookingFlightDetails con el itinerario revalidado en sandbox (%s)', (_name, fixture) => {
  it('fija los mismos vuelos, fechas y clases que se revalidaron', async () => {
    const details = buildBookingFlightDetails(await revalidated(fixture));

    const revalidatedFlights = fixture.request.OTA_AirLowFareSearchRQ.OriginDestinationInformation.flatMap(
      (od) => od.TPA_Extensions!.Flight!,
    );
    expect(details.flights).toEqual(
      revalidatedFlights.map((f) => ({
        flightNumber: f.Number,
        airlineCode: f.Airline.Marketing,
        fromAirportCode: f.OriginLocation.LocationCode,
        toAirportCode: f.DestinationLocation.LocationCode,
        departureDate: f.DepartureDateTime.slice(0, 10),
        departureTime: f.DepartureDateTime.slice(11, 16),
        bookingClass: f.ClassOfService,
        flightStatusCode: 'NN',
      })),
    );
    for (const flight of details.flights) {
      expect(flight.departureTime).toMatch(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/);
      expect(flight).not.toHaveProperty('isMarriageGroup');
    }
  });

  it('cotiza con los pasajeros y la aerolínea validadora del itinerario', async () => {
    const { group, itinerary } = await revalidated(fixture);
    const [pricing] = buildBookingFlightDetails({ group, itinerary }).flightPricing!;
    const fare = itinerary.pricingInformation[0]!.fare;

    expect(pricing!.priceComparisons).toBeUndefined();
    expect(pricing!.qualifiers).toEqual({
      passengersPricing: [{ passengerCode: 'ADT', numberOfpassengers: 1 }],
      validatingAirlineCode: fare.validatingCarrierCode,
    });
  });
});

describe('buildBookingFlightDetails', () => {
  function sample(): { group: ItineraryGroup; itinerary: Itinerary } {
    const group: ItineraryGroup = {
      groupDescription: { legDescriptions: [{ departureDate: '2026-12-31', departureLocation: 'MEX', arrivalLocation: 'MAD' }] },
      itineraries: [],
    };
    const itinerary: Itinerary = {
      id: 1,
      legs: [
        {
          id: 1,
          schedules: [
            {
              id: 1,
              departure: { airport: 'MEX', time: '20:05:00-06:00' },
              arrival: { airport: 'CUN', time: '23:10:00-05:00' },
              carrier: { marketing: 'AM', marketingFlightNumber: 501, operating: 'AM' },
            },
            {
              id: 2,
              departure: { airport: 'CUN', time: '01:30:00-05:00' },
              arrival: { airport: 'MAD', time: '17:00:00+01:00' },
              carrier: { marketing: 'IB', marketingFlightNumber: 6402, operating: 'IB' },
              departureDateAdjustment: 1,
            },
          ],
        },
      ],
      pricingInformation: [
        {
          fare: {
            validatingCarrierCode: 'IB',
            totalFare: { totalPrice: 23456.789, currency: 'MXN' },
            passengerInfoList: [
              {
                passengerInfo: {
                  passengerType: 'ADT',
                  passengerNumber: 2,
                  fareComponents: [
                    { id: 1, fareBasisCode: 'X', segments: [{ segment: { bookingCode: 'Q' } }] },
                    { id: 2, fareBasisCode: 'Y', segments: [{ segment: { bookingCode: 'V' } }] },
                  ],
                },
              },
              { passengerInfo: { passengerType: 'CNN', passengerNumber: 1 } },
            ],
          },
        },
      ],
    };
    return { group, itinerary };
  }

  it('suma departureDateAdjustment (cruza de año) y recorta la hora a HH:MM', () => {
    const { flights } = buildBookingFlightDetails(sample());
    expect(flights.map((f) => [f.airlineCode, f.flightNumber, f.departureDate, f.departureTime, f.bookingClass])).toEqual([
      ['AM', 501, '2026-12-31', '20:05', 'Q'],
      ['IB', 6402, '2027-01-01', '01:30', 'V'],
    ]);
  });

  it('un passengersPricing por tipo de pasajero, con su cantidad', () => {
    const [pricing] = buildBookingFlightDetails(sample()).flightPricing!;
    expect(pricing!.qualifiers!.passengersPricing).toEqual([
      { passengerCode: 'ADT', numberOfpassengers: 2 },
      { passengerCode: 'CNN', numberOfpassengers: 1 },
    ]);
  });

  it('con priceComparison toma desiredAmount de totalFare.totalPrice', () => {
    const [pricing] = buildBookingFlightDetails({
      ...sample(),
      priceComparison: { comparisonType: 'INCREASE_BY_PERCENT', percent: '5' },
    }).flightPricing!;
    expect(pricing!.priceComparisons).toEqual([
      { desiredAmount: '23456.789', comparisonType: 'INCREASE_BY_PERCENT', percent: '5' },
    ]);
  });

  it('sin validatingCarrierCode no manda validatingAirlineCode', () => {
    const source = sample();
    delete source.itinerary.pricingInformation[0]!.fare.validatingCarrierCode;
    const [pricing] = buildBookingFlightDetails(source).flightPricing!;
    expect(pricing!.qualifiers).not.toHaveProperty('validatingAirlineCode');
  });

  it('rechaza un itinerario sin pricingInformation o sin precio para priceComparison', () => {
    const noPricing = sample();
    noPricing.itinerary.pricingInformation = [];
    expect(() => buildBookingFlightDetails(noPricing)).toThrow(TypeError);

    const noTotal = sample();
    delete noTotal.itinerary.pricingInformation[0]!.fare.totalFare;
    expect(() =>
      buildBookingFlightDetails({ ...noTotal, priceComparison: { comparisonType: 'INCREASE_BY_AMOUNT', amount: '100' } }),
    ).toThrow(TypeError);
  });
});
