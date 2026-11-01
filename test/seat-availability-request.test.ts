import { describe, expect, it, vi } from 'vitest';
import {
  buildBookingFlightDetails,
  buildSeatAvailabilityRequest,
  type Itinerary,
  type ItineraryGroup,
  type RevalidateItineraryRequest,
  Sabre,
  type SeatAvailabilityByPayloadRq,
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

// Patrones del spec de Get Seats 3.0.
const ID = /^[a-zA-Z_][a-zA-Z0-9_\-.]*$/;
const AIRLINE = /^([A-Z0-9]{2}|[A-Z]{3})$/;
const AIRPORT = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^[0-9]{2}:[0-9]{2}$/;
const LETTER = /^[A-Z]$/;

/** Campos obligatorios y patrones de `SeatAvailabilityByPayloadRq`. */
function expectValidAgainstSpec(rq: SeatAvailabilityByPayloadRq) {
  expect(rq.returnSeatMapsOnlyForSegmentRefs.length).toBeGreaterThan(0);
  expect(rq.segments.length).toBeGreaterThan(0);
  expect(rq.passengers.length).toBeGreaterThan(0);
  const segmentIds = new Set(rq.segments.map((s) => s.id));
  const fareIds = new Set((rq.fareComponents ?? []).map((f) => f.fareComponentId));
  for (const ref of rq.returnSeatMapsOnlyForSegmentRefs) expect(segmentIds.has(ref)).toBe(true);
  for (const s of rq.segments) {
    expect(s.id).toMatch(ID);
    expect(s.bookingAirlineCode).toMatch(AIRLINE);
    expect(Number.isInteger(s.bookingFlightNumber) && s.bookingFlightNumber >= 1 && s.bookingFlightNumber <= 9999).toBe(true);
    expect(s.departureAirportCode).toMatch(AIRPORT);
    expect(s.arrivalAirportCode).toMatch(AIRPORT);
    expect(s.departureDate).toMatch(DATE);
    expect(s.arrivalDate).toMatch(DATE);
    expect(s.departureTime).toMatch(TIME);
    expect(s.arrivalTime).toMatch(TIME);
    expect(s.bookingClassCode).toMatch(LETTER);
    if (s.cabinCode !== undefined) expect(s.cabinCode).toMatch(LETTER);
    if (s.operatingAirlineCode !== undefined) expect(s.operatingAirlineCode).toMatch(AIRLINE);
  }
  for (const f of rq.fareComponents ?? []) {
    expect(f.fareComponentId).toMatch(ID);
    expect(f.fareBasis.length).toBeGreaterThan(0);
  }
  for (const p of rq.passengers) {
    expect(p.id).toMatch(ID);
    for (const a of p.fareSegmentAssociation ?? []) {
      expect(segmentIds.has(a.segmentRef)).toBe(true);
      expect(fareIds.has(a.fareComponentRef)).toBe(true);
    }
  }
}

describe.each([
  ['directo ida y vuelta', direct as unknown as Fixture],
  ['con conexión al día siguiente', connection as unknown as Fixture],
])('buildSeatAvailabilityRequest con el itinerario revalidado en sandbox (%s)', (_name, fixture) => {
  it('valida contra los obligatorios y patrones del spec 3.0', async () => {
    expectValidAgainstSpec(buildSeatAvailabilityRequest(await revalidated(fixture)));
  });

  it('un segmento por vuelo, con el mismo vuelo, fecha y clase que reserva Create Booking', async () => {
    const source = await revalidated(fixture);
    const rq = buildSeatAvailabilityRequest(source);
    const { flights } = buildBookingFlightDetails(source);

    expect(rq.segments.map((s) => [s.bookingAirlineCode, s.bookingFlightNumber, s.departureAirportCode, s.departureDate, s.departureTime, s.bookingClassCode])).toEqual(
      flights.map((f) => [f.airlineCode, f.flightNumber, f.fromAirportCode, f.departureDate, f.departureTime, f.bookingClass]),
    );
    expect(rq.returnSeatMapsOnlyForSegmentRefs).toEqual(rq.segments.map((s) => s.id));
  });

  it('cada segmento queda asociado a un componente de tarifa, con su cabina', async () => {
    const rq = buildSeatAvailabilityRequest(await revalidated(fixture));
    for (const passenger of rq.passengers) {
      expect(passenger.fareSegmentAssociation!.map((a) => a.segmentRef)).toEqual(rq.segments.map((s) => s.id));
    }
    for (const segment of rq.segments) expect(segment.cabinCode).toBe('Y');
  });
});

describe('buildSeatAvailabilityRequest', () => {
  it('directo DFW–LAX: request completo', async () => {
    const rq = buildSeatAvailabilityRequest({ ...(await revalidated(direct as unknown as Fixture)), currencyCode: 'USD' });
    expect(rq.segments[0]).toMatchObject({ id: 'S1', departureAirportCode: 'DFW', arrivalAirportCode: 'LAX' });
    expect(rq.passengers).toEqual([
      { id: 'P1', passengerType: 'ADT', fareSegmentAssociation: expect.any(Array) },
    ]);
    expect(rq.currencyCode).toBe('USD');
  });

  it('conexión MEX–CDG–MAD: un componente MEX–MAD para los dos vuelos, con fareBasis y governingCarrier', async () => {
    const rq = buildSeatAvailabilityRequest(await revalidated(connection as unknown as Fixture));
    expect(rq.segments.map((s) => `${s.departureAirportCode}-${s.arrivalAirportCode}`)).toEqual(['MEX-CDG', 'CDG-MAD']);
    expect(rq.fareComponents).toEqual([
      {
        fareComponentId: 'FC1',
        fareBasis: 'VNN01SBA',
        governingCarrier: 'AF',
        fareDetail: { fareType: 'EOU', fareTariff: '27', fareRule: '1SNB', fareTypeBitmap: '00' },
      },
    ]);
    expect(rq.passengers[0]!.fareSegmentAssociation).toEqual([
      { segmentRef: 'S1', fareComponentRef: 'FC1' },
      { segmentRef: 'S2', fareComponentRef: 'FC1' },
    ]);
  });

  it('segments elige los vuelos con mapa, empezando en 1; 0, uno inexistente o una lista vacía lanzan TypeError', async () => {
    const source = await revalidated(connection as unknown as Fixture);
    expect(buildSeatAvailabilityRequest({ ...source, segments: [2] }).returnSeatMapsOnlyForSegmentRefs).toEqual(['S2']);
    expect(buildSeatAvailabilityRequest({ ...source, segments: [1, 2] }).returnSeatMapsOnlyForSegmentRefs).toEqual(['S1', 'S2']);
    expect(() => buildSeatAvailabilityRequest({ ...source, segments: [0] })).toThrow('(empieza en 1)');
    expect(() => buildSeatAvailabilityRequest({ ...source, segments: [3] })).toThrow(/^sabre-client: /);
    expect(() => buildSeatAvailabilityRequest({ ...source, segments: [] })).toThrow(/^sabre-client: /);
  });

  function codeshare(): { group: ItineraryGroup; itinerary: Itinerary } {
    return {
      group: {
        groupDescription: { legDescriptions: [{ departureDate: '2026-12-10', departureLocation: 'MEX', arrivalLocation: 'MAD' }] },
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
                departure: { airport: 'MEX', time: '18:00:00-06:00' },
                arrival: { airport: 'MAD', time: '12:30:00+01:00', dateAdjustment: 1 },
                carrier: { marketing: 'AM', marketingFlightNumber: 6001, operating: 'IB', operatingFlightNumber: 6402 },
              },
            ],
          },
        ],
        pricingInformation: [
          {
            fare: {
              passengerInfoList: [
                {
                  passengerInfo: {
                    passengerType: 'ADT',
                    passengerNumber: 2,
                    fareComponents: [{ id: 7, fareBasisCode: 'QLOW', segments: [{ segment: { bookingCode: 'Q', cabinCode: 'Y' } }] }],
                  },
                },
                {
                  passengerInfo: {
                    passengerType: 'CNN',
                    passengerNumber: 1,
                    fareComponents: [{ id: 8, fareBasisCode: 'QLOWCH', segments: [{ segment: { bookingCode: 'Q', cabinCode: 'Y' } }] }],
                  },
                },
              ],
            },
          },
        ],
      },
    };
  }

  it('codeshare: manda operatingAirlineCode y operatingFlightNumber; fecha de llegada con dateAdjustment', () => {
    const rq = buildSeatAvailabilityRequest(codeshare());
    expect(rq.segments[0]).toEqual({
      id: 'S1',
      bookingAirlineCode: 'AM',
      bookingFlightNumber: 6001,
      operatingAirlineCode: 'IB',
      operatingFlightNumber: 6402,
      departureAirportCode: 'MEX',
      arrivalAirportCode: 'MAD',
      departureDate: '2026-12-10',
      departureTime: '18:00',
      arrivalDate: '2026-12-11',
      arrivalTime: '12:30',
      bookingClassCode: 'Q',
      cabinCode: 'Y',
    });
    expectValidAgainstSpec(rq);
  });

  it('un pasajero por plaza, P1…Pn en el orden de passengerInfoList, cada uno con su componente', () => {
    const rq = buildSeatAvailabilityRequest(codeshare());
    expect(rq.passengers.map((p) => [p.id, p.passengerType, p.fareSegmentAssociation![0]!.fareComponentRef])).toEqual([
      ['P1', 'ADT', 'FC7'],
      ['P2', 'ADT', 'FC7'],
      ['P3', 'CNN', 'FC8'],
    ]);
    expect(rq.fareComponents!.map((f) => f.fareComponentId)).toEqual(['FC7', 'FC8']);
  });

  it('sin codeshare no manda operating*', async () => {
    const rq = buildSeatAvailabilityRequest(await revalidated(direct as unknown as Fixture));
    for (const segment of rq.segments) {
      expect(segment).not.toHaveProperty('operatingAirlineCode');
      expect(segment).not.toHaveProperty('operatingFlightNumber');
    }
  });
});
