import { describe, expect, it, vi } from 'vitest';
import { bargainFinderMax, classifyBargainFinderMax } from '../src/air/bargain-finder-max.js';
import { resolveConfig } from '../src/config.js';
import { RestTransport } from '../src/http/rest-transport.js';
import {
  type BargainFinderMaxRequest,
  Sabre,
  SabreBusinessError,
  SabreError,
  SabreGatewayError,
  type SabreLogger,
} from '../src/index.js';
import bfmExample from './fixtures/bargain-finder-max.wiki-example.json';
import { config, json } from './helpers.js';

// Request de ejemplo de raw/sources/bargain-finder-max.md.
const request: BargainFinderMaxRequest = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: { Source: [{ PseudoCityCode: 'XXXX', RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
    OriginDestinationInformation: [
      { DepartureDateTime: '2026-09-11T20:00:00', OriginLocation: { LocationCode: 'WAW' }, DestinationLocation: { LocationCode: 'SPU' } },
      { DepartureDateTime: '2026-09-18T20:00:00', OriginLocation: { LocationCode: 'SPU' }, DestinationLocation: { LocationCode: 'WAW' } },
    ],
    TravelPreferences: { MaxStopsQuantity: 0, VendorPref: [{ Code: 'LO' }] },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  },
};

const token = () => json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });

/** Respuesta 200 con un mensaje de error en `messages[]` (forma supuesta, ver classifyBargainFinderMax). */
function errorResponse(text: string, code = 'MIP') {
  return {
    groupedItineraryResponse: {
      version: '5',
      messages: [
        { severity: 'Info', type: 'WORKERTHREAD', code: 'TRANSACTIONID', text: '123' },
        { severity: 'Error', type: 'SERVER', code, text },
      ],
      statistics: { itineraryCount: 0 },
    },
  };
}

/** `fetch` que separa el endpoint de token del servicio. */
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

describe('sabre.air.bargainFinderMax', () => {
  it('hace POST /v5/offers/shop con el body tal cual y Bearer', async () => {
    const fetch = router([json(200, bfmExample)]);
    await new Sabre(config({ fetch })).air.bargainFinderMax(request);

    const [[url, init]] = serviceCalls(fetch) as [[string, RequestInit]];
    expect(url).toBe('https://api.cert.platform.sabre.com/v5/offers/shop');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(request);
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer T1');
  });

  it('devuelve el groupedItineraryResponse desnormalizado', async () => {
    const result = await new Sabre(config({ fetch: router([json(200, bfmExample)]) })).air.bargainFinderMax(request);

    expect(result.statistics).toEqual({ itineraryCount: 1 });
    const itinerary = result.itineraryGroups[0]!.itineraries[0]!;
    expect(itinerary.legs.map((leg) => leg.schedules[0]!.departure.airport)).toEqual(['WAW', 'SPU']);
    expect(itinerary.pricingInformation[0]!.fare.totalFare?.totalPrice).toBe(131.8);
    expect(JSON.stringify(result)).not.toContain('"ref"');
  });

  it('pasa el signal del consumidor a fetch', async () => {
    const fetch = router([json(200, bfmExample)]);
    const controller = new AbortController();
    await new Sabre(config({ fetch })).air.bargainFinderMax(request, { signal: controller.signal });
    expect(serviceCalls(fetch)[0]![1]?.signal).toBe(controller.signal);
  });

  it('rechaza un request sin OTA_AirLowFareSearchRQ antes de llamar a la red', async () => {
    const fetch = router([]);
    const sabre = new Sabre(config({ fetch }));
    await expect(sabre.air.bargainFinderMax({} as BargainFinderMaxRequest)).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un error de gateway sale como SabreGatewayError', async () => {
    const fetch = router([json(403, { errorCode: 'ERR.2SG.SEC.NOT_AUTHORIZED' })]);
    const error = await catchError(new Sabre(config({ fetch })).air.bargainFinderMax(request));
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error).toMatchObject({ status: 403, code: 'ERR.2SG.SEC.NOT_AUTHORIZED' });
  });

  it('un error de negocio sale como SabreBusinessError y no se reintenta', async () => {
    const fetch = router([json(200, errorResponse('NO FLIGHT SCHEDULES FOR QUALIFIERS USED'))]);
    const error = await catchError(new Sabre(config({ fetch })).air.bargainFinderMax(request));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({
      service: 'bargainFinderMax',
      code: 'NO FLIGHT SCHEDULES FOR QUALIFIERS USED',
      retryable: false,
      message: 'bargainFinderMax: NO FLIGHT SCHEDULES FOR QUALIFIERS USED',
    });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('una respuesta 200 sin groupedItineraryResponse es malformada', async () => {
    const error = await catchError(
      new Sabre(config({ fetch: router([json(200, { foo: 1 })]) })).air.bargainFinderMax(request),
    );
    expect(error).toBeInstanceOf(SabreError);
    expect(error).toMatchObject({ retryable: false });
    expect((error as Error).message).toBe('bargainFinderMax: respuesta malformada, falta groupedItineraryResponse');
  });

  it('el logger no recibe el raw del error', async () => {
    const logger: SabreLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fetch = router([json(200, errorResponse('No Availability'))]);
    await catchError(new Sabre(config({ fetch, logger })).air.bargainFinderMax(request));

    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logged).toContain('No Availability');
    expect(logged).not.toContain('TRANSACTIONID');
  });
});

describe('classifyBargainFinderMax', () => {
  it('sin mensajes de error es data válida', () => {
    expect(classifyBargainFinderMax(bfmExample)).toBeUndefined();
  });

  it.each([
    ['No Availability', 'No Availability', false],
    ['NO FLIGHT SCHEDULES FOR QUALIFIERS USED', 'NO FLIGHT SCHEDULES FOR QUALIFIERS USED', false],
    ['Communication error code=104: Connection reset by peer', 'Connection reset by peer', true],
    ['Transmission timeout after 30000 ms', 'Transmission timeout', true],
    ['DSF server returned an error: Insufficient resources to process request', 'Insufficient resources', true],
    ['MAX NBR COMBINATIONS EXCEEDED', 'MAX NBR COMBINATIONS EXCEEDED', true],
  ])('"%s" → code %s, retryable %s', (text, code, retryable) => {
    const error = classifyBargainFinderMax(errorResponse(text));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'bargainFinderMax', code, retryable, message: `bargainFinderMax: ${text}` });
  });

  it('un error fuera del catálogo usa el code del mensaje y no es reintentable', () => {
    const error = classifyBargainFinderMax(errorResponse('ALGO RARO', 'ERR42'));
    expect(error).toMatchObject({ code: 'ERR42', retryable: false });
  });

  it('el raw es el body completo', () => {
    const body = errorResponse('No Availability');
    expect(classifyBargainFinderMax(body)?.raw).toBe(body);
  });
});

describe('reintentos de los errores temporales de BFM', () => {
  function transport(fetch: typeof globalThis.fetch) {
    return new RestTransport(resolveConfig(config({ fetch })), { random: () => 1, sleep: async () => {} });
  }

  it('reintenta un temporal y devuelve los itinerarios', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(200, errorResponse('Transmission timeout')))
      .mockResolvedValueOnce(json(200, bfmExample));
    const result = await bargainFinderMax(transport(fetch), request);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.itineraryGroups).toHaveLength(1);
  });

  it('agota maxRetries y lanza el SabreBusinessError reintentable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(200, errorResponse('MAX NBR COMBINATIONS EXCEEDED')));
    const error = await catchError(bargainFinderMax(transport(fetch), request, { retry: { maxRetries: 2 } }));

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ retryable: true });
  });
});
