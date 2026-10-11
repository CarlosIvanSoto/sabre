import { describe, expect, it } from 'vitest';
import {
  denormalizeGroupedItineraryResponse,
  type RawGroupedItineraryResponse,
} from '../src/air/grouped-itinerary.js';
import { SabreError } from '../src/index.js';
import bfmExample from './fixtures/bargain-finder-max.wiki-example.json';
import revalidateExample from './fixtures/revalidate-itinerary.wiki-example.json';

// Respuestas de ejemplo de raw/sources/ del wiki (bargain-finder-max y revalidate-itinerary).
const bfm = (bfmExample as unknown as { groupedItineraryResponse: RawGroupedItineraryResponse })
  .groupedItineraryResponse;
const revalidate = (revalidateExample as unknown as { groupedItineraryResponse: RawGroupedItineraryResponse })
  .groupedItineraryResponse;

describe('denormalizeGroupedItineraryResponse — ejemplo de Bargain Finder Max', () => {
  const result = denormalizeGroupedItineraryResponse(bfm, 'bargainFinderMax');
  const itinerary = result.itineraryGroups[0]!.itineraries[0]!;
  const fare = itinerary.pricingInformation[0]!.fare;
  const passenger = fare.passengerInfoList[0]!.passengerInfo;

  it('conserva version, messages, statistics y groupDescription', () => {
    expect(result.version).toBe('5');
    expect(result.statistics).toEqual({ itineraryCount: 1 });
    expect(result.messages.find((m) => m.code === 'TRANSACTIONID')?.text).toBe('7346539295149655838');
    expect(result.itineraryGroups[0]!.groupDescription.legDescriptions).toHaveLength(2);
  });

  it('no expone los arrays de descriptores', () => {
    expect(Object.keys(result).sort()).toEqual(['itineraryGroups', 'messages', 'statistics', 'version']);
  });

  it('resuelve legs → legDescs → scheduleDescs en el orden de las referencias', () => {
    expect(itinerary.legs.map((leg) => leg.id)).toEqual([2, 1]);
    const [outbound, inbound] = itinerary.legs;
    expect(outbound).toMatchObject({ id: 2, elapsedTime: 120 });
    expect(outbound!.schedules[0]).toMatchObject({
      id: 2,
      departure: { airport: 'WAW', time: '14:20:00+02:00' },
      arrival: { airport: 'SPU' },
      carrier: { marketing: 'LO', marketingFlightNumber: 575, equipment: { code: 'E75' } },
    });
    expect(inbound!.schedules[0]!.carrier.marketingFlightNumber).toBe(576);
    expect(outbound!.schedules[0]).not.toHaveProperty('ref');
  });

  it('resuelve impuestos, resúmenes y OB fees en el orden de las referencias', () => {
    expect(passenger.taxes!.map((t) => t.id)).toEqual([5, 6, 4, 3, 1, 2]);
    expect(passenger.taxes![0]).toEqual({
      id: 5,
      code: 'HR',
      amount: 17.8,
      currency: 'USD',
      description: 'PASSENGER SERVICE AND SECURITY CHARGE',
      publishedAmount: 16.4,
      publishedCurrency: 'EUR',
      station: 'SPU',
      country: 'HR',
    });
    expect(passenger.taxSummaries!.map((t) => t.code)).toEqual(['HR', 'MI', 'ND', 'XW', 'YQ']);
    expect(passenger.obFees).toEqual([{ id: 1, amount: 0, currency: 'USD' }]);
  });

  it('fusiona el componente de tarifa con sus datos del itinerario, segmento a segmento', () => {
    expect(passenger.fareComponents![0]).toEqual({
      id: 1,
      governingCarrier: 'LO',
      fareAmount: 26.86,
      fareCurrency: 'NUC',
      fareBasisCode: 'OSAVI5',
      farePassengerType: 'ADT',
      publishedFareAmount: 235,
      publishedFareCurrency: 'PLN',
      directionality: 'FROM',
      applicablePricingCategories: '4 5 6 7 8 9 10 15 16 17 31 33',
      vendorCode: 'ATP',
      fareTypeBitmap: '00',
      fareType: 'XPN',
      fareTariff: '21',
      fareRule: 'SAV1',
      cabinCode: 'Y',
      beginAirport: 'WAW',
      endAirport: 'SPU',
      segments: [
        {
          segment: {
            stopover: true,
            bookingCode: 'O',
            cabinCode: 'Y',
            mealCode: 'RF',
            seatsAvailable: 9,
            availabilityBreak: true,
          },
        },
      ],
    });
  });

  it('resuelve la franquicia de equipaje y deja los índices de segmento tal cual', () => {
    expect(passenger.baggageInformation![0]).toEqual({
      provisionType: 'A',
      airlineCode: 'LO',
      segments: [{ id: 0 }],
      allowance: { id: 1, pieceCount: 0 },
    });
  });

  it('resuelve las aerolíneas validadoras y conserva el resto de la tarifa', () => {
    expect(fare.validatingCarriers).toEqual([
      { id: 1, settlementMethod: 'ARC', newVcxProcess: true, default: { code: 'LO' } },
    ]);
    expect(fare).toMatchObject({ validatingCarrierCode: 'LO', lastTicketDate: '2026-11-21', totalFare: { totalPrice: 131.8 } });
    expect(passenger).toMatchObject({
      passengerType: 'ADT',
      nonRefundable: true,
      currencyConversion: { from: 'PLN', to: 'USD' },
      passengerTotalFare: { totalFare: 131.8, constructionCurrency: 'NUC' },
    });
  });

  it('no deja ningún `ref` en la salida', () => {
    expect(JSON.stringify(result)).not.toContain('"ref"');
  });

  it('no muta la entrada', () => {
    const before = JSON.stringify(bfm);
    denormalizeGroupedItineraryResponse(bfm, 'bargainFinderMax');
    expect(JSON.stringify(bfm)).toBe(before);
  });
});

describe('denormalizeGroupedItineraryResponse — ejemplo de Revalidate Itinerary', () => {
  const result = denormalizeGroupedItineraryResponse(revalidate, 'revalidateItinerary');
  const itinerary = result.itineraryGroups[0]!.itineraries[0]!;
  const pricing = itinerary.pricingInformation[0]!;
  const passenger = pricing.fare.passengerInfoList[0]!.passengerInfo;

  it('conserva los campos que solo aparecen en Revalidate', () => {
    expect(itinerary.currentItinerary).toBe(true);
    expect(pricing.distributionModel).toBe('ATPCO');
    expect(passenger.fareCalcLine).toEqual({ info: 'LON BA FRA12.08NUC12.08END ROE0.744929' });
    expect(passenger.fareMessages).toHaveLength(2);
    expect(passenger.passengerTotalFare).toMatchObject({ commissionPercentage: 3, commissionSource: 'C' });
    expect(itinerary.legs[0]!.schedules[0]!.departure.terminal).toBe('5');
  });

  it('fusiona un segmento vacío del descriptor con la disponibilidad del itinerario', () => {
    expect(passenger.fareComponents![0]).toMatchObject({
      fareBasisCode: 'VTEST/ROBB',
      privateFare: true,
      direction: 'EH',
      beginAirport: 'LHR',
      segments: [{ segment: { bookingCode: 'V', fareBreakPoint: true } }],
    });
  });

  it('no deja ningún `ref` en la salida', () => {
    expect(JSON.stringify(result)).not.toContain('"ref"');
  });
});

describe('denormalizeGroupedItineraryResponse — casos borde', () => {
  it('lanza SabreError no reintentable ante un ref sin descriptor', () => {
    const broken: RawGroupedItineraryResponse = { ...bfm, legDescs: [] };
    let error: unknown;
    try {
      denormalizeGroupedItineraryResponse(broken, 'bargainFinderMax');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SabreError);
    expect(error).toMatchObject({ retryable: false });
    expect((error as Error).message).toBe('bargainFinderMax: respuesta malformada, ref 2 sin descriptor en legDescs');
  });

  it('lanza SabreError si los segments del componente y del descriptor no tienen el mismo largo', () => {
    const descs = bfm.fareComponentDescs!.map((desc) =>
      desc.id === 1 ? { ...desc, segments: [{ segment: { stopover: true } }, { segment: { stopover: false } }] } : desc,
    );
    expect(() => denormalizeGroupedItineraryResponse({ ...bfm, fareComponentDescs: descs }, 'bargainFinderMax')).toThrow(
      'bargainFinderMax: respuesta malformada, fareComponents con 1 segmentos y fareComponentDescs 1 con 2',
    );
  });

  it('si solo un lado trae segments, se usan tal cual', () => {
    const descs = bfm.fareComponentDescs!.map(({ segments: _segments, ...desc }) => desc);
    const result = denormalizeGroupedItineraryResponse({ ...bfm, fareComponentDescs: descs }, 'bargainFinderMax');
    const component = result.itineraryGroups[0]!.itineraries[0]!.pricingInformation[0]!.fare.passengerInfoList[0]!
      .passengerInfo.fareComponents![0]!;
    expect(component.segments).toEqual([
      { segment: { bookingCode: 'O', cabinCode: 'Y', mealCode: 'RF', seatsAvailable: 9, availabilityBreak: true } },
    ]);
  });

  it('una respuesta sin itinerarios da listas vacías', () => {
    expect(denormalizeGroupedItineraryResponse({ version: '5' }, 'bargainFinderMax')).toEqual({
      version: '5',
      messages: [],
      itineraryGroups: [],
    });
  });

  it('conserva campos extra del sitio que referencia', () => {
    const raw: RawGroupedItineraryResponse = {
      ...bfm,
      legDescs: [{ id: 1, schedules: [{ ref: 1, extra: 'x' } as never] }],
      itineraryGroups: [
        {
          groupDescription: { legDescriptions: [] },
          itineraries: [{ id: 9, legs: [{ ref: 1 }], pricingInformation: [] }],
        },
      ],
    };
    const leg = denormalizeGroupedItineraryResponse(raw, 'bargainFinderMax').itineraryGroups[0]!.itineraries[0]!.legs[0]!;
    expect(leg.schedules[0]).toMatchObject({ id: 1, extra: 'x' });
  });
});
