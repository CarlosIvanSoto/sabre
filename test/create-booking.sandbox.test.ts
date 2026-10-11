// Reproduce Revalidate → Create Booking grabados en sandbox con scripts/record-booking.mjs (sin red).
import { describe, expect, it, vi } from 'vitest';
import {
  buildBookingFlightDetails,
  type CreateBookingRequest,
  type RevalidateItineraryRequest,
  Sabre,
  SabreBusinessError,
} from '../src/index.js';
import unauthorized from './fixtures/create-booking.sandbox-unauthorized-v3.json';
import { config, json } from './helpers.js';

interface Fixture {
  revalidate: { request: RevalidateItineraryRequest; response: { status: number; body: unknown } };
  request: CreateBookingRequest;
  response: { status: number; body: unknown };
}

const fixture = unauthorized as unknown as Fixture;

function client() {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/auth/token')) return json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });
    if (url.includes('/v5/shop/flights/revalidate')) {
      return json(fixture.revalidate.response.status, fixture.revalidate.response.body);
    }
    return json(fixture.response.status, fixture.response.body);
  });
  return { fetch, sabre: new Sabre(config({ fetch })) };
}

describe('Create Booking contra la fixture de sandbox (token v3 rechazado)', () => {
  it('buildBookingFlightDetails rearma, desde el itinerario revalidado, el flightDetails que se mandó', async () => {
    const { sabre } = client();
    const revalidated = await sabre.air.revalidateItinerary(fixture.revalidate.request);
    const group = revalidated.itineraryGroups[0]!;
    expect(buildBookingFlightDetails({ group, itinerary: group.itineraries[0]! })).toEqual(
      fixture.request.flightDetails,
    );
  });

  it('el rechazo llega en un 200 dentro de errors[] y sale como SabreBusinessError, sin reintento', async () => {
    expect(fixture.response.status).toBe(200);
    const { sabre, fetch } = client();
    const error = await sabre.booking.create(fixture.request).then(
      () => expect.fail('se esperaba un error'),
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({
      service: 'createBooking',
      code: 'UNAUTHORIZED_ACCESS',
      retryable: false,
      warnings: [],
    });
    expect((error as Error).message).toBe(
      'createBooking: UNAUTHORIZED UNAUTHORIZED_ACCESS: Expired or invalid security token',
    );
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/createBooking'))).toHaveLength(1);
  });

  it('la fixture solo lleva el pasajero sintético', () => {
    const text = JSON.stringify(fixture);
    expect(fixture.request.travelers).toEqual([
      {
        givenName: 'TEST',
        surname: 'PASSENGER',
        passengerCode: 'ADT',
        emails: ['test@example.com'],
        phones: [{ number: '5550000000', label: 'M' }],
      },
    ]);
    expect(text.match(/"(givenName|surname)":"(?!TEST"|PASSENGER")/g)).toBeNull();
  });
});
