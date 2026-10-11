// El flujo de examples/ contra fixtures de sandbox, con `fetch` mockeado (sin red).
import { describe, expect, it, vi } from 'vitest';
import { airBookingFlow, oneWaySearch, SYNTHETIC_TRAVELER } from '../examples/air-booking-flow.mjs';
import { Sabre } from '../src/index.js';
import direct from './fixtures/revalidate-itinerary.sandbox-direct.json';
import { config, json } from './helpers.js';

const search = oneWaySearch({ pcc: 'XXXX', origin: 'DFW', destination: 'LAX', departureDateTime: '2026-12-01T10:00:00' });

function client({ shop = direct.search.response.body as unknown } = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/auth/token')) return json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });
    if (url.includes('/v5/offers/shop')) return json(200, shop);
    if (url.includes('/v5/shop/flights/revalidate')) return json(200, direct.response.body);
    if (url.includes('/v1/trip/orders/createBooking')) {
      return json(200, {
        confirmationId: 'ABCDEF',
        booking: { bookingId: 'ABCDEF' },
        errors: [{ category: 'WARNING', type: 'SOME_WARNING', description: 'aviso' }],
      });
    }
    throw new Error(`URL inesperada: ${url}`);
  });
  return { fetch, sabre: new Sabre(config({ fetch, retry: { maxRetries: 0 } })) };
}

const calls = (fetch: ReturnType<typeof client>['fetch'], path: string) =>
  fetch.mock.calls.filter(([input]) => String(input).includes(path));

describe('examples/air-booking-flow', () => {
  it('sin book: busca y revalida con un solo token, y no reserva', async () => {
    const { fetch, sabre } = client();
    const steps: string[] = [];
    const summary = await airBookingFlow(sabre, { search, onStep: (step: string) => steps.push(step) });

    expect(steps).toEqual(['bargainFinderMax', 'revalidateItinerary']);
    expect(summary.itineraries).toBeGreaterThan(0);
    expect(summary.flights).toMatch(/→/);
    expect(summary.revalidatedPrice).toBeDefined();
    expect(summary.booking).toBeUndefined();
    expect(calls(fetch, '/auth/token')).toHaveLength(1);
    expect(calls(fetch, '/v1/trip/orders/createBooking')).toHaveLength(0);
  });

  it('con book: reserva el itinerario revalidado reutilizando el token en las tres llamadas', async () => {
    const { fetch, sabre } = client();
    const summary = await airBookingFlow(sabre, { search, book: true });

    expect(summary.booking).toEqual({ confirmationId: 'ABCDEF', warnings: ['SOME_WARNING'], errors: [] });
    expect(calls(fetch, '/auth/token')).toHaveLength(1);
    const authorized = fetch.mock.calls.filter(([input]) => !String(input).includes('/auth/token'));
    expect(authorized).toHaveLength(3);
    for (const [, init] of authorized) expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer T1');

    const [, init] = calls(fetch, '/v1/trip/orders/createBooking')[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.travelers).toEqual([SYNTHETIC_TRAVELER]);
    expect(body.flightDetails.flights.length).toBeGreaterThan(0);
  });

  it('falla con un mensaje claro si BFM no devuelve itinerarios', async () => {
    const { sabre } = client({ shop: { groupedItineraryResponse: { version: '5', messages: [], statistics: { itineraryCount: 0 } } } });
    await expect(airBookingFlow(sabre, { search })).rejects.toThrow('no devolvió itinerarios');
  });
});
