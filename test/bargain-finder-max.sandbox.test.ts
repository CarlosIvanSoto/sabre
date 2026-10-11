// Reproduce respuestas reales de sandbox grabadas con scripts/record-bfm.mjs (sin red).
import { describe, expect, it, vi } from 'vitest';
import { type BargainFinderMaxRequest, Sabre, SabreBusinessError } from '../src/index.js';
import noSchedules from './fixtures/bargain-finder-max.sandbox-no-schedules.json';
import ok from './fixtures/bargain-finder-max.sandbox-ok.json';
import { config, json } from './helpers.js';

interface Fixture {
  request: BargainFinderMaxRequest;
  response: { status: number; body: unknown };
}

function replay(fixture: Fixture) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
    String(input).includes('/auth/token')
      ? json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' })
      : json(fixture.response.status, fixture.response.body),
  );
  const sabre = new Sabre(config({ fetch }));
  return { fetch, result: sabre.air.bargainFinderMax(fixture.request) };
}

describe('Bargain Finder Max contra la fixture de sandbox', () => {
  it('ida y vuelta: devuelve itinerarios desnormalizados', async () => {
    const result = await replay(ok as unknown as Fixture).result;
    const itineraries = result.itineraryGroups.flatMap((group) => group.itineraries);

    expect(itineraries.length).toBeGreaterThan(0);
    expect(itineraries).toHaveLength(result.statistics!.itineraryCount);
    expect(JSON.stringify(result)).not.toContain('"ref"');

    for (const itinerary of itineraries) {
      expect(itinerary.legs).toHaveLength(2);
      for (const leg of itinerary.legs) {
        expect(leg.schedules.length).toBeGreaterThan(0);
        for (const schedule of leg.schedules) {
          expect(schedule.departure.airport).toMatch(/^[A-Z]{3}$/);
          expect(schedule.carrier.marketing).toMatch(/^[A-Z0-9]{2}$/);
        }
      }
      const fare = itinerary.pricingInformation[0]!.fare;
      expect(fare.totalFare?.totalPrice).toBeGreaterThan(0);
      const passenger = fare.passengerInfoList[0]!.passengerInfo;
      for (const component of passenger.fareComponents ?? []) {
        expect(component.fareBasisCode).toBeTruthy();
        expect(component.segments?.every((s) => s.segment.bookingCode !== undefined)).toBe(true);
      }
      expect(passenger.taxes?.every((tax) => typeof tax.code === 'string')).toBe(true);
    }
  });

  it('ida y vuelta: el primer y último aeropuerto de cada tramo coinciden con la búsqueda', async () => {
    const fixture = ok as unknown as Fixture;
    const result = await replay(fixture).result;
    const searched = fixture.request.OTA_AirLowFareSearchRQ.OriginDestinationInformation.map((od) => [
      od.OriginLocation.LocationCode,
      od.DestinationLocation.LocationCode,
    ]);
    const first = result.itineraryGroups[0]!.itineraries[0]!;
    expect(first.legs.map((leg) => [leg.schedules[0]!.departure.airport, leg.schedules.at(-1)!.arrival.airport])).toEqual(
      searched,
    );
  });

  it('sin vuelos para los qualifiers: SabreBusinessError con el código del catálogo', async () => {
    const error = await replay(noSchedules as unknown as Fixture).result.then(
      () => expect.fail('se esperaba un error'),
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({
      service: 'bargainFinderMax',
      code: 'NO FLIGHT SCHEDULES FOR QUALIFIERS USED',
      retryable: false,
      message: 'bargainFinderMax: NO FLIGHT SCHEDULES FOR QUALIFIERS USED',
    });
  });
});
