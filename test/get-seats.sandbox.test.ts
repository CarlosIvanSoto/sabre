// Get Seats `byPnrLocator` contra lo grabado en sandbox con scripts/record-get-seats-pnr.mjs
// (2026-11-03, #127): Revalidate → Get Seats por payload → Create con asiento en el PCC de la
// auth, sin targetPcc → Get → byPnrLocator → Cancel → Get. Sin red.
import { describe, expect, it, vi } from 'vitest';
import {
  buildBookingFlightDetails,
  type CancelBookingRequest,
  type CreateBookingRequest,
  type GetBookingRequest,
  type RevalidateItineraryRequest,
  Sabre,
  type SeatAvailabilityByPayloadRq,
  type SeatAvailabilityByPnrLocatorRq,
} from '../src/index.js';
import fixtureJson from './fixtures/get-seats.sandbox-pnr-locator.json';
import { config, json } from './helpers.js';

interface Exchange<T> {
  request: T;
  response: { status: number; body: unknown };
}

const fixture = fixtureJson as unknown as {
  seat: string;
  revalidate: Exchange<RevalidateItineraryRequest>;
  seatsPayload: Exchange<SeatAvailabilityByPayloadRq>;
  create: Exchange<CreateBookingRequest>;
  get: Exchange<GetBookingRequest>;
  seatsPnr: Exchange<SeatAvailabilityByPnrLocatorRq>;
  cancel: Exchange<CancelBookingRequest>;
  after: Exchange<GetBookingRequest>;
};

type BookedFlight = { airlineCode?: string; flightNumber?: number; seats?: Array<{ number?: string; statusCode?: string }> };
const flightsOf = (booking: object) => ((booking as { flights?: unknown }).flights ?? []) as BookedFlight[];

/** Responde cada servicio con su fixture; Get Booking, en orden: verificación y después final. */
function client() {
  const gets = [fixture.get.response, fixture.after.response];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/auth/token')) return json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });
    const pick = url.includes('/v5/shop/flights/revalidate')
      ? fixture.revalidate.response
      : url.includes('/getseats/byReservationPayload')
        ? fixture.seatsPayload.response
        : url.includes('/getseats/byPnrLocator')
          ? fixture.seatsPnr.response
          : url.includes('/createBooking')
            ? fixture.create.response
            : url.includes('/cancelBooking')
              ? fixture.cancel.response
              : url.includes('/getBooking')
                ? gets.shift()
                : undefined;
    if (pick === undefined) throw new Error(`llamada inesperada: ${url}`);
    return json(pick.status, pick.body);
  });
  return { fetch, sabre: new Sabre(config({ fetch })) };
}

const seatsOf = (map: { cabinCompartments?: Array<{ seatRows?: Array<{ row: number; seats: Array<{ column: string; occupationStatusCode?: string }> }> }> }) =>
  (map.cabinCompartments ?? []).flatMap((c) => c.seatRows ?? []).flatMap((r) => r.seats.map((s) => ({ number: `${r.row}${s.column}`, ...s })));

describe('Get Seats byPnrLocator contra las fixtures de sandbox (PCC de la auth)', () => {
  it('buildBookingFlightDetails rearma el flightDetails con asiento que Sabre aceptó', async () => {
    const { sabre } = client();
    const revalidated = await sabre.air.revalidateItinerary(fixture.revalidate.request);
    const group = revalidated.itineraryGroups[0]!;
    const itinerary = group.itineraries[0]!;
    const seatAvailability = await sabre.air.getSeats(fixture.seatsPayload.request);
    expect(
      buildBookingFlightDetails({
        group,
        itinerary,
        seats: [{ segmentIndex: 1, travelerIndex: 1, number: fixture.seat }],
        seatAvailability,
      }),
    ).toEqual(fixture.create.request.flightDetails);
  });

  it('Create sin targetPcc da localizador, y Get Booking devuelve el asiento HK', async () => {
    const { sabre } = client();
    expect(fixture.create.request).not.toHaveProperty('targetPcc');
    const booking = await sabre.booking.create(fixture.create.request);
    expect(booking.confirmationId).toMatch(/^[A-Z]{6}$/);
    expect(booking.warnings).toEqual([]);
    expect(booking.errors).toEqual([]);

    const verified = await sabre.booking.get(fixture.get.request);
    expect(flightsOf(verified).flatMap((f) => f.seats ?? [])).toEqual([
      expect.objectContaining({ number: fixture.seat, statusCode: 'HK' }),
    ]);
  });

  it('byPnrLocator lee el PNR del PCC de la auth: POST con solo el localizador, 200 y sin errores', async () => {
    const { sabre, fetch } = client();
    const seats = await sabre.air.getSeats(fixture.seatsPnr.request);

    const call = fetch.mock.calls.find(([url]) => String(url).includes('/v3/offers/getseats/byPnrLocator'))!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ pnrLocator: fixture.get.request.confirmationId });
    expect(fixture.seatsPnr.response.status).toBe(200);
    expect(seats.errors).toEqual([]);
    expect(seats.warnings).toEqual([]);
  });

  it('el mapa sale del PNR: pasajero y segmento con sus ids de reserva, y un mapa por segmento', async () => {
    const { sabre } = client();
    const verified = await sabre.booking.get(fixture.get.request);
    const { response } = await sabre.air.getSeats(fixture.seatsPnr.request);

    // Los ids no son P1/S1 como en byReservationPayload: los arma Sabre desde el PNR.
    expect(response.passengers).toEqual([
      expect.objectContaining({ id: 'pnr_pax_1', passengerType: 'ADT', reservationPassengerId: '01.01' }),
    ]);
    const [flight] = flightsOf(verified);
    expect(response.segments).toEqual([
      expect.objectContaining({ bookingAirlineCode: flight!.airlineCode, bookingFlightNumber: flight!.flightNumber }),
    ]);
    expect(response.seatMaps.map((m) => m.segmentRef)).toEqual(response.segments.map((s) => s.id));
    for (const price of response.priceDefinitions!) expect(typeof price.totalPrice.amount).toBe('number');
  });

  it('en CERT el asiento reservado sigue como libre (F): byPnrLocator no refleja la ocupación', async () => {
    // Igual que byReservationPayload en CERT (wiki/entities/get-seats.md): los 177 asientos
    // vienen en F, también el que el PNR tiene HK. Si una regrabación lo cambia, este test avisa.
    const { sabre } = client();
    const { response } = await sabre.air.getSeats(fixture.seatsPnr.request);
    const seats = response.seatMaps.flatMap(seatsOf);
    expect(seats.find((s) => s.number === fixture.seat)?.occupationStatusCode).toBe('F');
    expect(new Set(seats.map((s) => s.occupationStatusCode))).toEqual(new Set(['F']));
  });

  it('Cancel deja el PNR sin vuelos', async () => {
    const { sabre } = client();
    await sabre.booking.get(fixture.get.request);
    await sabre.booking.cancel(fixture.cancel.request);
    expect(flightsOf(await sabre.booking.get(fixture.after.request))).toEqual([]);
  });
});
