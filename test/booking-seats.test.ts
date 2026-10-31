import { describe, expect, it, vi } from 'vitest';
import {
  buildBookingFlightDetails,
  type CreateBookingRequest,
  type FlightDetails,
  type GetSeatsResponse,
  type Itinerary,
  type ItineraryGroup,
  Sabre,
} from '../src/index.js';
import { config, json } from './helpers.js';

/** MEX–CUN (AM501) y CUN–MAD (IB6402) al día siguiente, 2 ADT. */
function sample(): { group: ItineraryGroup; itinerary: Itinerary } {
  return {
    group: {
      groupDescription: { legDescriptions: [{ departureDate: '2026-12-31', departureLocation: 'MEX', arrivalLocation: 'MAD' }] },
      itineraries: [],
    },
    itinerary: {
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
            ],
          },
        },
      ],
    },
  };
}

/** Get Seats del vuelo IB6402 (segmento `"2"`): 30A cuesta 45 EUR, 30B tiene precio 0, 30C es gratis. */
const availability: GetSeatsResponse = {
  response: {
    segments: [
      {
        id: '2',
        bookingAirlineCode: 'IB',
        bookingFlightNumber: 6402,
        departureAirportCode: 'CUN',
        arrivalAirportCode: 'MAD',
        departureDate: '2027-01-01',
        bookingClassCode: 'V',
      },
    ],
    passengers: [{ id: 'P1' }, { id: 'P2' }],
    serviceDefinitions: [{ id: 'SD1' }],
    priceDefinitions: [
      { id: 'PD1', currencyCode: 'EUR', totalPrice: { amount: '45.00' } },
      { id: 'PD0', currencyCode: 'EUR', totalPrice: { amount: '0.00' } },
    ],
    offerItems: [
      { id: 'OI1', serviceDefinitionRef: 'SD1', priceDefinitionRef: 'PD1', segmentRefs: ['2'], passengerRefs: ['P1'] },
      { id: 'OI0', serviceDefinitionRef: 'SD1', priceDefinitionRef: 'PD0', segmentRefs: ['2'], passengerRefs: ['P1'] },
    ],
    seatMaps: [
      {
        segmentRef: '2',
        cabinCompartments: [
          {
            seatRows: [
              {
                row: 30,
                seats: [
                  { column: 'A', occupationStatusCode: 'F', offerItemRefIds: ['OI1'] },
                  { column: 'B', occupationStatusCode: 'F', offerItemRefIds: ['OI0'] },
                  { column: 'C', occupationStatusCode: 'F' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  warnings: [],
  errors: [],
};

describe('buildBookingFlightDetails con seats', () => {
  it('sin seats el resultado no cambia: ningún vuelo trae seats', () => {
    const details = buildBookingFlightDetails(sample());
    expect(details).toEqual(buildBookingFlightDetails({ ...sample(), seats: [] }));
    for (const flight of details.flights) expect(flight).not.toHaveProperty('seats');
  });

  it('vuelca cada asiento en flights[segmentIndex].seats[] con number y travelerIndex', () => {
    const { flights } = buildBookingFlightDetails({
      ...sample(),
      seats: [
        { segmentIndex: 1, travelerIndex: 1, number: '30A' },
        { segmentIndex: 1, travelerIndex: 2, number: '30B' },
        { segmentIndex: 0, travelerIndex: 2, number: '12F' },
      ],
    });
    expect(flights[0]!.seats).toEqual([{ number: '12F', travelerIndex: 2 }]);
    expect(flights[1]!.seats).toEqual([
      { number: '30A', travelerIndex: 1 },
      { number: '30B', travelerIndex: 2 },
    ]);
    expect(flights[1]).not.toHaveProperty('changeOfGaugeSeats');
  });

  it.each([
    ['número sin columna', { segmentIndex: 0, travelerIndex: 1, number: '13' }],
    ['columna en minúscula', { segmentIndex: 0, travelerIndex: 1, number: '13a' }],
    ['columna antes de la fila', { segmentIndex: 0, travelerIndex: 1, number: 'A13' }],
    ['vuelo inexistente', { segmentIndex: 2, travelerIndex: 1, number: '13A' }],
    ['vuelo negativo', { segmentIndex: -1, travelerIndex: 1, number: '13A' }],
    ['viajero 0 (es 1-based)', { segmentIndex: 0, travelerIndex: 0, number: '13A' }],
    ['viajero de más', { segmentIndex: 0, travelerIndex: 3, number: '13A' }],
  ])('rechaza con TypeError: %s', (_name, seat) => {
    expect(() => buildBookingFlightDetails({ ...sample(), seats: [seat] })).toThrow(/^sabre-client: /);
  });
});

const token = () => json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });

function router(service: Response[]) {
  return vi.fn<typeof globalThis.fetch>(async (input) =>
    String(input).includes('/auth/token') ? token() : service.shift()!,
  );
}

function bookingRequest(details: FlightDetails): CreateBookingRequest {
  return {
    flightDetails: details,
    travelers: [
      { givenName: 'ANAREAL', surname: 'PASAJERAREAL', passengerCode: 'ADT' },
      { givenName: 'LUISREAL', surname: 'PASAJERAREAL', passengerCode: 'ADT' },
    ],
  };
}

describe('sabre.booking.create con asientos', () => {
  it('asiento con precio en Get Seats: warn sabre.booking.seat.priced sin pasajero, y la reserva se envía igual', async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fetch = router([json(200, { confirmationId: 'GLEBNY' })]);
    const details = buildBookingFlightDetails({
      ...sample(),
      seats: [
        { segmentIndex: 1, travelerIndex: 1, number: '30A' },
        { segmentIndex: 1, travelerIndex: 2, number: '30C' },
      ],
      seatAvailability: availability,
    });

    const result = await new Sabre(config({ fetch, logger: log })).booking.create(bookingRequest(details));

    expect(result.confirmationId).toBe('GLEBNY');
    const seatWarns = log.warn.mock.calls.filter(([event]) => event === 'sabre.booking.seat.priced');
    expect(seatWarns).toEqual([
      [
        'sabre.booking.seat.priced',
        { service: 'createBooking', segmentIndex: 1, flight: 'IB6402', seat: '30A', amount: '45.00', currencyCode: 'EUR' },
      ],
    ]);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('REAL');
    // El request sale igual que sin Get Seats.
    const [, init] = fetch.mock.calls.find(([url]) => !String(url).includes('/auth/token'))!;
    expect(JSON.parse(init!.body as string).flightDetails.flights[1].seats).toEqual([
      { number: '30A', travelerIndex: 1 },
      { number: '30C', travelerIndex: 2 },
    ]);
  });

  it('precio 0, asiento sin offerItem o sin seatAvailability: no avisa', async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const sabre = new Sabre(
      config({ fetch: router([json(200, { confirmationId: 'A' }), json(200, { confirmationId: 'B' })]), logger: log }),
    );
    const free = buildBookingFlightDetails({
      ...sample(),
      seats: [
        { segmentIndex: 1, travelerIndex: 1, number: '30B' },
        { segmentIndex: 1, travelerIndex: 2, number: '30C' },
      ],
      seatAvailability: availability,
    });
    const unknown = buildBookingFlightDetails({ ...sample(), seats: [{ segmentIndex: 1, travelerIndex: 1, number: '30A' }] });

    await sabre.booking.create(bookingRequest(free));
    await sabre.booking.create(bookingRequest(unknown));

    expect(log.warn.mock.calls.filter(([event]) => event === 'sabre.booking.seat.priced')).toEqual([]);
  });

  it('el asiento se busca por vuelo, no por id: el mismo 30A en otro vuelo no avisa', async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const details = buildBookingFlightDetails({
      ...sample(),
      seats: [{ segmentIndex: 0, travelerIndex: 1, number: '30A' }],
      seatAvailability: availability,
    });

    await new Sabre(config({ fetch: router([json(200, { confirmationId: 'A' })]), logger: log })).booking.create(
      bookingRequest(details),
    );

    expect(log.warn.mock.calls.filter(([event]) => event === 'sabre.booking.seat.priced')).toEqual([]);
  });

  it('travelerIndex fuera de travelers lanza TypeError sin llamar a la red', async () => {
    const fetch = router([]);
    const details = buildBookingFlightDetails({ ...sample(), seats: [{ segmentIndex: 0, travelerIndex: 2, number: '12F' }] });
    const request = { ...bookingRequest(details), travelers: bookingRequest(details).travelers!.slice(0, 1) };

    await expect(new Sabre(config({ fetch })).booking.create(request)).rejects.toThrow(/^sabre-client: /);
    expect(fetch).not.toHaveBeenCalled();
  });
});
