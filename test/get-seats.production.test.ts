// Get Seats contra las respuestas grabadas en producción (#67, 2026-10-31): Revalidate → Get
// Seats por payload, con `fetch` mockeado. Ver scripts/record-get-seats.mjs.
import { describe, expect, it, vi } from 'vitest';
import {
  buildBookingFlightDetails,
  buildSeatAvailabilityRequest,
  type GetSeatsResponse,
  type RevalidateItineraryRequest,
  Sabre,
  type SabreLogger,
  type SeatAvailabilityByPayloadRq,
} from '../src/index.js';
import connection from './fixtures/get-seats.production-connection.json';
import direct from './fixtures/get-seats.production-direct.json';
import { config, json } from './helpers.js';

interface Fixture {
  revalidate: { request: RevalidateItineraryRequest; response: { status: number; body: unknown } };
  request: SeatAvailabilityByPayloadRq;
  response: { status: number; body: unknown };
}

function client(fixture: Fixture, logger?: SabreLogger) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/auth/token')) return json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });
    if (url.includes('/v5/shop/flights/revalidate')) return json(fixture.revalidate.response.status, fixture.revalidate.response.body);
    if (url.includes('/v3/offers/getseats/byReservationPayload')) return json(fixture.response.status, fixture.response.body);
    if (url.includes('/v1/trip/orders/createBooking')) return json(200, { confirmationId: 'GLEBNY' });
    throw new Error(`URL inesperada: ${url}`);
  });
  return new Sabre(config({ fetch, ...(logger === undefined ? {} : { logger }) }));
}

async function flow(fixture: Fixture, logger?: SabreLogger) {
  const sabre = client(fixture, logger);
  const revalidated = await sabre.air.revalidateItinerary(fixture.revalidate.request);
  const group = revalidated.itineraryGroups[0]!;
  const itinerary = group.itineraries[0]!;
  const request = buildSeatAvailabilityRequest({ group, itinerary });
  const seats = await sabre.air.getSeats(request);
  return { sabre, group, itinerary, request, seats };
}

/** Primer asiento libre del segmento cuyo precio es mayor que cero, con su monto. */
function pricedFreeSeat({ response }: GetSeatsResponse, segmentRef: string) {
  for (const row of response.seatMaps.find((m) => m.segmentRef === segmentRef)!.cabinCompartments!.flatMap((c) => c.seatRows ?? [])) {
    for (const seat of row.seats) {
      if (seat.occupationStatusCode !== 'F') continue;
      for (const id of seat.offerItemRefIds ?? []) {
        const item = response.offerItems.find((i) => i.id === id);
        const price = response.priceDefinitions!.find((p) => p.id === item?.priceDefinitionRef);
        if (price !== undefined && Number(price.totalPrice.amount) > 0) {
          return { number: `${row.row}${seat.column}`, amount: String(price.totalPrice.amount), currencyCode: price.currencyCode };
        }
      }
    }
  }
  return undefined;
}

describe.each([
  ['directo DFW–LAX (AA1508)', direct as unknown as Fixture, 1],
  ['conexión MEX–YUL–MAD (AC2094 / LH6761)', connection as unknown as Fixture, 2],
])('Get Seats en producción: %s', (_name, fixture, segments) => {
  it('buildSeatAvailabilityRequest rearma exactamente el request que Sabre aceptó', async () => {
    const { request } = await flow(fixture);
    expect(request).toEqual(fixture.request);
    expect(request.segments).toHaveLength(segments);
  });

  it('un mapa por segmento pedido, con los ids del request, y sin errores ni avisos', async () => {
    const { request, seats } = await flow(fixture);
    expect(fixture.response.status).toBe(200);
    expect(seats.errors).toEqual([]);
    expect(seats.warnings).toEqual([]);
    expect(seats.response.seatMaps.map((m) => m.segmentRef)).toEqual(request.returnSeatMapsOnlyForSegmentRefs);
    expect(seats.response.segments.map((s) => s.id)).toEqual(request.segments.map((s) => s.id));
    expect(seats.response.passengers).toEqual([{ id: 'P1', passengerType: 'ADT' }]);
  });

  it('los importes llegan como número, no como el string del spec', async () => {
    const { seats } = await flow(fixture);
    for (const price of seats.response.priceDefinitions!) expect(typeof price.totalPrice.amount).toBe('number');
  });

  it('un asiento libre con precio emite sabre.booking.seat.priced con el monto como string, y se reserva igual', async () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { sabre, group, itinerary, seats } = await flow(fixture, log);
    const seat = pricedFreeSeat(seats, 'S1')!;
    expect(seat).toBeDefined();

    const flightDetails = buildBookingFlightDetails({
      group,
      itinerary,
      seats: [{ segmentIndex: 0, travelerIndex: 1, number: seat.number }],
      seatAvailability: seats,
    });
    const result = await sabre.booking.create({
      flightDetails,
      travelers: [{ givenName: 'TEST', surname: 'PASSENGER', passengerCode: 'ADT' }],
    });

    expect(result.confirmationId).toBe('GLEBNY');
    expect(log.warn).toHaveBeenCalledWith(
      'sabre.booking.seat.priced',
      expect.objectContaining({ segmentIndex: 0, seat: seat.number, amount: seat.amount, currencyCode: seat.currencyCode }),
    );
  });
});
