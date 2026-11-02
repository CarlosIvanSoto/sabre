// Reproduce Revalidate → Create → Get → Cancel → Get grabados en sandbox con
// scripts/record-booking.mjs y `targetPcc` (2026-11-02, #34 y #42). Sin red.
import { describe, expect, it, vi } from 'vitest';
import {
  buildBookingFlightDetails,
  type CancelBookingRequest,
  type CreateBookingRequest,
  type GetBookingRequest,
  type RevalidateItineraryRequest,
  Sabre,
} from '../src/index.js';
import cancelFixture from './fixtures/cancel-booking.sandbox-ok.json';
import createFixture from './fixtures/create-booking.sandbox-ok.json';
import getFixture from './fixtures/get-booking.sandbox-atpco.json';
import { config, json } from './helpers.js';

interface Exchange<T> {
  request: T;
  response: { status: number; body: unknown };
}

const create = createFixture as unknown as Exchange<CreateBookingRequest> & {
  revalidate: Exchange<RevalidateItineraryRequest>;
};
const get = getFixture as unknown as Exchange<GetBookingRequest>;
const cancel = cancelFixture as unknown as Exchange<CancelBookingRequest> & { after: Exchange<GetBookingRequest> };

/** `Booking.flights` y `travelers` van sin tipar en el Tier 1: el test lee solo lo que compara. */
type BookedFlight = Record<string, unknown>;
const flightsOf = (booking: object) => ((booking as { flights?: unknown }).flights ?? []) as BookedFlight[];
const travelersOf = (booking: object) =>
  ((booking as { travelers?: unknown }).travelers ?? []) as Array<{ passengerCode?: string }>;

/** Responde cada servicio con su fixture; Get Booking, en orden: verificación y después final. */
function client() {
  const gets = [get.response, cancel.after.response];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/auth/token')) return json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });
    const pick = url.includes('/v5/shop/flights/revalidate')
      ? create.revalidate.response
      : url.includes('/createBooking')
        ? create.response
        : url.includes('/cancelBooking')
          ? cancel.response
          : url.includes('/getBooking')
            ? gets.shift()
            : undefined;
    if (pick === undefined) throw new Error(`llamada inesperada: ${url}`);
    return json(pick.status, pick.body);
  });
  return { fetch, sabre: new Sabre(config({ fetch })) };
}

describe('Ciclo de reserva contra las fixtures de sandbox (targetPcc)', () => {
  it('buildBookingFlightDetails rearma, desde el itinerario revalidado, el flightDetails que se mandó', async () => {
    const { sabre } = client();
    const revalidated = await sabre.air.revalidateItinerary(create.revalidate.request);
    const group = revalidated.itineraryGroups[0]!;
    expect(buildBookingFlightDetails({ group, itinerary: group.itineraries[0]! })).toEqual(
      create.request.flightDetails,
    );
  });

  it('Create → Get → Cancel → Get: localizador, vuelo HK con el mapeo pedido y PNR sin vuelos al final', async () => {
    const { sabre } = client();
    const booking = await sabre.booking.create(create.request);
    expect(booking.confirmationId).toMatch(/^[A-Z]{6}$/);
    expect(booking.warnings).toEqual([]);
    expect(booking.errors).toEqual([]);
    const { confirmationId } = booking;
    expect(get.request.confirmationId).toBe(confirmationId);

    const verified = await sabre.booking.get(get.request);
    const requested = create.request.flightDetails!.flights;
    // El mapeo de flightDetails es el que Sabre devuelve en el PNR (antes, solo inferido).
    expect(
      flightsOf(verified).map((f) => ({
        airlineCode: f.airlineCode,
        flightNumber: f.flightNumber,
        fromAirportCode: f.fromAirportCode,
        toAirportCode: f.toAirportCode,
        departureDate: f.departureDate,
        bookingClass: f.bookingClass,
        flightStatusCode: f.flightStatusCode,
      })),
    ).toEqual(
      requested.map((f) => ({
        airlineCode: f.airlineCode,
        flightNumber: f.flightNumber,
        fromAirportCode: f.fromAirportCode,
        toAirportCode: f.toAirportCode,
        departureDate: f.departureDate,
        bookingClass: f.bookingClass,
        flightStatusCode: 'HK',
      })),
    );
    expect(travelersOf(verified).map((t) => t.passengerCode)).toEqual(['ADT']);
    expect(verified.warnings).toEqual([]);

    const cancelled = await sabre.booking.cancel(cancel.request);
    expect(cancelled.warnings).toEqual([]);

    const after = await sabre.booking.get(cancel.after.request);
    expect(flightsOf(after)).toEqual([]);
  });

  it('Create, Get y Cancel mandan el targetPcc en el body', async () => {
    const { sabre, fetch } = client();
    await sabre.booking.create(create.request);
    await sabre.booking.get(get.request);
    await sabre.booking.cancel(cancel.request);
    const bodies = fetch.mock.calls
      .filter(([u]) => /\/(createBooking|getBooking|cancelBooking)$/.test(String(u)))
      .map(([, init]) => JSON.parse(String(init?.body)) as { targetPcc?: string });
    expect(bodies).toHaveLength(3);
    for (const body of bodies) expect(body.targetPcc).toBe('XXXX');
  });

  it('las fixtures solo llevan el pasajero sintético y ningún PCC ni DK real', () => {
    for (const fixture of [create, get, cancel]) {
      const text = JSON.stringify(fixture);
      expect(text.match(/"(givenName|surname)":"(?!TEST"|PASSENGER")/g)).toBeNull();
      expect(text.match(/"(targetPcc|ticketingPcc|userWorkPcc|userHomePcc|agencyCustomerNumber)":"(?!XXXX")/g)).toBeNull();
      expect(text).not.toMatch(/"bookingSignature":"(?!XXXX")/);
    }
  });
});
