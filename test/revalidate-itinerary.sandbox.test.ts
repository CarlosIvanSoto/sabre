// Reproduce BFM → Revalidate grabados en sandbox con scripts/record-revalidate.mjs (sin red).
import { describe, expect, it, vi } from 'vitest';
import {
  type BargainFinderMaxRequest,
  buildRevalidateItineraryRequest,
  type RevalidateItineraryRequest,
  Sabre,
} from '../src/index.js';
import connection from './fixtures/revalidate-itinerary.sandbox-connection.json';
import direct from './fixtures/revalidate-itinerary.sandbox-direct.json';
import { config, json } from './helpers.js';

interface Fixture {
  search: { request: BargainFinderMaxRequest; response: { status: number; body: unknown } };
  request: RevalidateItineraryRequest;
  response: { status: number; body: unknown };
}

function client(fixture: Fixture) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/auth/token')) return json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });
    if (url.includes('/v5/offers/shop')) return json(fixture.search.response.status, fixture.search.response.body);
    return json(fixture.response.status, fixture.response.body);
  });
  return { fetch, sabre: new Sabre(config({ fetch })) };
}

describe.each([
  ['directo ida y vuelta', direct as unknown as Fixture],
  ['con conexión al día siguiente', connection as unknown as Fixture],
])('BFM → Revalidate contra la fixture de sandbox (%s)', (_name, fixture) => {
  it('el helper rearma, desde la búsqueda, el request que se mandó a sandbox', async () => {
    const { sabre } = client(fixture);
    const result = await sabre.air.bargainFinderMax(fixture.search.request);
    const candidates = result.itineraryGroups.flatMap((group) =>
      group.itineraries.map((itinerary) =>
        buildRevalidateItineraryRequest({ search: fixture.search.request, group, itinerary }),
      ),
    );
    expect(candidates).toContainEqual(fixture.request);
  });

  it('revalida el itinerario: uno solo, marcado como actual y con los mismos vuelos', async () => {
    const { sabre, fetch } = client(fixture);
    const result = await sabre.air.revalidateItinerary(fixture.request);

    const urls = fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/revalidate'));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://api.cert.platform.sabre.com/v5/shop/flights/revalidate');

    const itineraries = result.itineraryGroups.flatMap((group) => group.itineraries);
    expect(itineraries).toHaveLength(1);
    const [itinerary] = itineraries;
    expect(itinerary!.currentItinerary).toBe(true);
    expect(JSON.stringify(result)).not.toContain('"ref"');

    const sent = fixture.request.OTA_AirLowFareSearchRQ.OriginDestinationInformation.map((od) =>
      od.TPA_Extensions!.Flight!.map((f) => `${f.Airline.Marketing}${f.Number}`),
    );
    const got = itinerary!.legs.map((leg) =>
      leg.schedules.map((s) => `${s.carrier.marketing}${s.carrier.marketingFlightNumber}`),
    );
    expect(got).toEqual(sent);
    expect(itinerary!.pricingInformation[0]!.fare.totalFare?.totalPrice).toBeGreaterThan(0);
  });
});

describe('departureDateAdjustment en sandbox', () => {
  it('BFM lo manda en legDescs[].schedules[] y el desnormalizador lo deja en el schedule', async () => {
    const fixture = connection as unknown as Fixture;
    const { sabre } = client(fixture);
    const result = await sabre.air.bargainFinderMax(fixture.search.request);
    const adjusted = result.itineraryGroups
      .flatMap((group) => group.itineraries)
      .flatMap((itinerary) => itinerary.legs.flatMap((leg) => leg.schedules))
      .filter((schedule) => schedule.departureDateAdjustment !== undefined);
    expect(adjusted.length).toBeGreaterThan(0);
    expect(adjusted.every((schedule) => schedule.departureDateAdjustment === 1)).toBe(true);
  });
});
