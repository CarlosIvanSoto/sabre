// Tests de tipos de campos que Sabre manda fuera del spec (#159): Get Seats en byPnrLocator y
// carrier.codeShared de BFM/Revalidate. Los corre `npm run typecheck`.
import { describe, expectTypeOf, it } from 'vitest';
import type { ScheduleCarrier, SeatCabinAisle, SeatCabinLayout, SeatMap, SeatSegmentRs } from '../src/index.js';
import seatsPnr from './fixtures/get-seats.sandbox-pnr-locator.json';
import revalidate from './fixtures/revalidate-itinerary.sandbox-connection.json';

describe('tipos de respuesta fuera del spec', () => {
  it('Get Seats: reservationSegmentId, aisles y flightLegRef nulo', () => {
    expectTypeOf<SeatSegmentRs['reservationSegmentId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SeatCabinLayout['aisles']>().toEqualTypeOf<SeatCabinAisle[] | undefined>();
    expectTypeOf<SeatMap['flightLegRef']>().toEqualTypeOf<string | null | undefined>();

    const response = seatsPnr.seatsPnr.response.body.response;
    const segment: SeatSegmentRs = { ...response.segments[0]!, reservationSegmentId: response.segments[0]!.reservationSegmentId };
    const aisles: SeatCabinAisle[] = response.seatMaps[0]!.cabinCompartments[0]!.cabinLayout.aisles;
    const map: Pick<SeatMap, 'segmentRef' | 'flightLegRef'> = { segmentRef: 'segment_ancs_1', flightLegRef: null };
    expectTypeOf(segment.reservationSegmentId).toEqualTypeOf<string | undefined>();
    expectTypeOf(aisles).toEqualTypeOf<SeatCabinAisle[]>();
    expectTypeOf(map.flightLegRef).toEqualTypeOf<string | null | undefined>();
  });

  it('BFM y Revalidate: carrier.codeShared', () => {
    expectTypeOf<ScheduleCarrier['codeShared']>().toEqualTypeOf<string | undefined>();
    const json = JSON.stringify(revalidate);
    const codeShared = /"codeShared":"([^"]+)"/.exec(json)?.[1];
    const carrier: Pick<ScheduleCarrier, 'marketing' | 'codeShared'> = { marketing: 'AV', ...(codeShared === undefined ? {} : { codeShared }) };
    expectTypeOf(carrier.codeShared).toEqualTypeOf<string | undefined>();
  });
});
