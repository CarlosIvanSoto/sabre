import { describe, expect, it, vi } from 'vitest';
import { classifyRevalidateItinerary, REVALIDATE_ITINERARY_CATALOG } from '../src/air/revalidate-itinerary.js';
import {
  type BargainFinderMaxRequest,
  buildRevalidateItineraryRequest,
  type Itinerary,
  type ItineraryGroup,
  type RevalidateItineraryRequest,
  Sabre,
  SabreBusinessError,
  SabreError,
  SabreGatewayError,
} from '../src/index.js';
import bfmSandbox from './fixtures/bargain-finder-max.sandbox-ok.json';
import revalidateExample from './fixtures/revalidate-itinerary.wiki-example.json';
import { config, json } from './helpers.js';

// Request de ejemplo de raw/sources/revalidate-itinerary.md.
const request: RevalidateItineraryRequest = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: { Source: [{ PseudoCityCode: 'XXXX', RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
    OriginDestinationInformation: [
      {
        Fixed: false,
        DepartureDateTime: '2026-09-11T06:55:00',
        OriginLocation: { LocationCode: 'LHR' },
        DestinationLocation: { LocationCode: 'FRA' },
        TPA_Extensions: {
          Flight: [
            {
              Type: 'A',
              Number: 902,
              DepartureDateTime: '2026-09-11T06:55:00',
              ArrivalDateTime: '2026-09-11T09:30:00',
              ClassOfService: 'V',
              OriginLocation: { LocationCode: 'LHR' },
              DestinationLocation: { LocationCode: 'FRA' },
              Airline: { Marketing: 'BA', Operating: 'BA' },
            },
          ],
        },
      },
    ],
    TravelPreferences: { MaxStopsQuantity: 0, TPA_Extensions: { VerificationItinCallLogic: { Value: 'L' } } },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  },
};

const token = () => json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });

function router(service: Response[]) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input).includes('/auth/token')) return token();
    const next = service.shift();
    if (next === undefined) throw new Error(`sin respuesta para ${String(input)}`);
    return next;
  });
}

function serviceCalls(fetch: ReturnType<typeof router>) {
  return fetch.mock.calls.filter(([url]) => !String(url).includes('/auth/token'));
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

function errorResponse(text: string, code = 'MIP') {
  return {
    groupedItineraryResponse: {
      version: '5',
      messages: [{ severity: 'Error', type: 'SERVER', code, text }],
      statistics: { itineraryCount: 0 },
    },
  };
}

describe('sabre.air.revalidateItinerary', () => {
  it('hace POST /v5/shop/flights/revalidate con el body tal cual y Bearer', async () => {
    const fetch = router([json(200, revalidateExample)]);
    await new Sabre(config({ fetch })).air.revalidateItinerary(request);

    const [[url, init]] = serviceCalls(fetch) as [[string, RequestInit]];
    expect(url).toBe('https://api.cert.platform.sabre.com/v5/shop/flights/revalidate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(request);
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer T1');
  });

  it('devuelve el groupedItineraryResponse desnormalizado, con los campos propios de Revalidate', async () => {
    const result = await new Sabre(config({ fetch: router([json(200, revalidateExample)]) })).air.revalidateItinerary(
      request,
    );

    const itinerary = result.itineraryGroups[0]!.itineraries[0]!;
    expect(itinerary.currentItinerary).toBe(true);
    expect(itinerary.legs[0]!.schedules[0]!.carrier.marketingFlightNumber).toBe(902);
    const passenger = itinerary.pricingInformation[0]!.fare.passengerInfoList[0]!.passengerInfo;
    expect(passenger.fareCalcLine?.info).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain('"ref"');
  });

  it('rechaza un request sin OTA_AirLowFareSearchRQ antes de llamar a la red', async () => {
    const fetch = router([]);
    await expect(
      new Sabre(config({ fetch })).air.revalidateItinerary({} as RevalidateItineraryRequest),
    ).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un error de gateway sale como SabreGatewayError', async () => {
    const fetch = router([json(403, { errorCode: 'ERR.2SG.SEC.NOT_AUTHORIZED' })]);
    const error = await catchError(new Sabre(config({ fetch })).air.revalidateItinerary(request));
    expect(error).toBeInstanceOf(SabreGatewayError);
  });

  it('un error de negocio sale como SabreBusinessError con service revalidateItinerary', async () => {
    const fetch = router([json(200, errorResponse('No Availability'))]);
    const error = await catchError(new Sabre(config({ fetch })).air.revalidateItinerary(request));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'revalidateItinerary', code: 'NO AVAILABILITY', retryable: false });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('una respuesta 200 sin groupedItineraryResponse es malformada', async () => {
    const error = await catchError(
      new Sabre(config({ fetch: router([json(200, { foo: 1 })]) })).air.revalidateItinerary(request),
    );
    expect(error).toBeInstanceOf(SabreError);
    expect((error as Error).message).toBe('revalidateItinerary: respuesta malformada, falta groupedItineraryResponse');
  });
});

describe('classifyRevalidateItinerary', () => {
  it('sin mensajes de error es data válida', () => {
    expect(classifyRevalidateItinerary(revalidateExample)).toBeUndefined();
  });

  it.each([
    'NO COMBINABLE FARES FOR CLASS USED',
    'NO FARE FOR CLASS USED',
    'NO FLIGHT SCHEDULES FOR QUALIFIERS USED',
    'NO SUCH FLIGHT',
    'NO AVAILABILITY',
  ])('%s es del catálogo oficial y no es reintentable', (text) => {
    expect(classifyRevalidateItinerary(errorResponse(text))).toMatchObject({
      service: 'revalidateItinerary',
      code: text,
      retryable: false,
    });
  });

  it('NO FARE FOR CLASS USED como llegó en producción (code PROCESS) sale con el code del catálogo', () => {
    const error = classifyRevalidateItinerary(errorResponse('NO FARE FOR CLASS USED', 'PROCESS'));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ code: 'NO FARE FOR CLASS USED', retryable: false });
    expect((error as Error).message).toBe('revalidateItinerary: NO FARE FOR CLASS USED');
  });

  it('NO COMBINABLE FARES no se confunde con NO FARE', () => {
    expect(classifyRevalidateItinerary(errorResponse('NO COMBINABLE FARES FOR CLASS USED'))).toMatchObject({
      code: 'NO COMBINABLE FARES FOR CLASS USED',
    });
    expect(REVALIDATE_ITINERARY_CATALOG.filter((e) => !e.retryable)).toHaveLength(5);
  });

  it('hereda los temporales reintentables del catálogo de BFM', () => {
    expect(classifyRevalidateItinerary(errorResponse('Transmission timeout after 30000 ms'))).toMatchObject({
      service: 'revalidateItinerary',
      code: 'Transmission timeout',
      retryable: true,
    });
  });

  it('un error fuera del catálogo no es reintentable', () => {
    expect(classifyRevalidateItinerary(errorResponse('ITINERARIO CAMBIADO', 'X1'))).toMatchObject({
      code: 'X1',
      retryable: false,
    });
  });
});

describe('buildRevalidateItineraryRequest', () => {
  async function searchResult() {
    const fixture = bfmSandbox as unknown as { request: BargainFinderMaxRequest; response: { body: unknown } };
    const sabre = new Sabre(config({ fetch: router([json(200, fixture.response.body)]) }));
    return { search: fixture.request, result: await sabre.air.bargainFinderMax(fixture.request) };
  }

  it('fija cada vuelo del itinerario de BFM y conserva POS, pasajeros y TPA_Extensions', async () => {
    const { search, result } = await searchResult();
    const group = result.itineraryGroups[0]!;
    const itinerary = group.itineraries[0]!;

    const built = buildRevalidateItineraryRequest({ search, group, itinerary }).OTA_AirLowFareSearchRQ;
    const original = search.OTA_AirLowFareSearchRQ;

    expect(built.Version).toBe(original.Version);
    expect(built.POS).toEqual(original.POS);
    expect(built.TravelerInfoSummary).toEqual(original.TravelerInfoSummary);
    expect(built.TPA_Extensions).toEqual(original.TPA_Extensions);
    expect(built.TravelPreferences).toEqual({
      MaxStopsQuantity: Math.max(...itinerary.legs.map((leg) => leg.schedules.length - 1)),
      TPA_Extensions: { VerificationItinCallLogic: { Value: 'L' } },
    });

    expect(built.OriginDestinationInformation).toHaveLength(itinerary.legs.length);
    built.OriginDestinationInformation.forEach((od, i) => {
      const leg = itinerary.legs[i]!;
      const flights = od.TPA_Extensions!.Flight!;
      const date = group.groupDescription.legDescriptions[i]!.departureDate;
      expect(od.Fixed).toBe(false);
      expect(od.DepartureDateTime.startsWith(date)).toBe(true);
      expect(od.OriginLocation.LocationCode).toBe(leg.schedules[0]!.departure.airport);
      expect(od.DestinationLocation.LocationCode).toBe(leg.schedules.at(-1)!.arrival.airport);
      expect(flights.map((f) => f.Number)).toEqual(leg.schedules.map((s) => s.carrier.marketingFlightNumber));
      for (const f of flights) {
        expect(f.ClassOfService).toMatch(/^[A-Z]$/);
        expect(f.DepartureDateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
        expect(f.ArrivalDateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      }
    });
  });

  // Itinerario mínimo con forma desnormalizada, para controlar fechas y clases.
  function itinerary(overrides: { arrivalAdjust?: number; departureAdjust?: number } = {}) {
    const group: ItineraryGroup = {
      groupDescription: { legDescriptions: [{ departureDate: '2026-12-31', departureLocation: 'MEX', arrivalLocation: 'MAD' }] },
      itineraries: [],
    };
    const schedule = (id: number, from: string, to: string, dep: string, arr: string, number: number) => ({
      id,
      departure: { airport: from, time: dep },
      arrival: { airport: to, time: arr },
      carrier: { marketing: 'IB', marketingFlightNumber: number },
    });
    const itin: Itinerary = {
      id: 1,
      legs: [
        {
          id: 1,
          schedules: [
            { ...schedule(1, 'MEX', 'CUN', '20:00:00-06:00', '23:10:00-05:00', 100) },
            {
              ...schedule(2, 'CUN', 'MAD', '01:30:00-05:00', '17:00:00+01:00', 6402),
              departureDateAdjustment: overrides.departureAdjust ?? 1,
              arrival: { airport: 'MAD', time: '17:00:00+01:00', dateAdjustment: overrides.arrivalAdjust ?? 0 },
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
                  fareComponents: [
                    { id: 1, fareBasisCode: 'X', segments: [{ segment: { bookingCode: 'Q' } }] },
                    { id: 2, fareBasisCode: 'Y', segments: [{ segment: { bookingCode: 'V' } }] },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    return { group, itinerary: itin };
  }

  const search = { OTA_AirLowFareSearchRQ: request.OTA_AirLowFareSearchRQ } as BargainFinderMaxRequest;

  it('suma departureDateAdjustment y arrival.dateAdjustment a la fecha del tramo (cruza de año)', () => {
    const { group, itinerary: itin } = itinerary({ departureAdjust: 1, arrivalAdjust: 1 });
    const [od] = buildRevalidateItineraryRequest({ search, group, itinerary: itin }).OTA_AirLowFareSearchRQ
      .OriginDestinationInformation;
    const flights = od!.TPA_Extensions!.Flight!;

    expect(od!.DepartureDateTime).toBe('2026-12-31T20:00:00');
    expect(flights.map((f) => [f.DepartureDateTime, f.ArrivalDateTime, f.ClassOfService])).toEqual([
      ['2026-12-31T20:00:00', '2026-12-31T23:10:00', 'Q'],
      ['2027-01-01T01:30:00', '2027-01-02T17:00:00', 'V'],
    ]);
    expect(od!.DestinationLocation.LocationCode).toBe('MAD');
  });

  it('con una conexión calcula MaxStopsQuantity 1 y omite Operating si no viene', () => {
    const { group, itinerary: itin } = itinerary();
    const built = buildRevalidateItineraryRequest({ search, group, itinerary: itin }).OTA_AirLowFareSearchRQ;
    expect(built.TravelPreferences?.MaxStopsQuantity).toBe(1);
    expect(built.OriginDestinationInformation[0]!.TPA_Extensions!.Flight![0]!.Airline).toEqual({ Marketing: 'IB' });
  });

  it('rechaza un itinerario con menos clases de servicio que vuelos', () => {
    const { group, itinerary: itin } = itinerary();
    itin.pricingInformation[0]!.fare.passengerInfoList[0]!.passengerInfo.fareComponents!.pop();
    expect(() => buildRevalidateItineraryRequest({ search, group, itinerary: itin })).toThrow(TypeError);
  });

  it('rechaza un grupo con distinto número de tramos que el itinerario', () => {
    const { group, itinerary: itin } = itinerary();
    group.groupDescription.legDescriptions.push(group.groupDescription.legDescriptions[0]!);
    expect(() => buildRevalidateItineraryRequest({ search, group, itinerary: itin })).toThrow(TypeError);
  });
});
