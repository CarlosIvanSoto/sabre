import { describe, expect, it, vi } from 'vitest';
import { classifyGetSeats } from '../src/air/get-seats.js';
import {
  type SabreLogger,
  type SabreRawResponse,
  Sabre,
  SabreBusinessError,
  SabreError,
  SabreGatewayError,
  SabreWarning,
  type SeatAvailabilityByPayloadRq,
} from '../src/index.js';
import synthetic from './fixtures/get-seats.synthetic.json';
import { config, json } from './helpers.js';

const request: SeatAvailabilityByPayloadRq = {
  returnSeatMapsOnlyForSegmentRefs: ['1'],
  segments: [
    {
      id: '1',
      bookingAirlineCode: 'AA',
      bookingFlightNumber: 1234,
      departureAirportCode: 'DFW',
      arrivalAirportCode: 'LAX',
      departureDate: '2026-12-10',
      bookingClassCode: 'Y',
    },
  ],
  passengers: [{ id: 'P1', passengerType: 'ADT' }],
};

const token = (value = 'T1') => json(200, { access_token: value, expires_in: 604800, token_type: 'bearer' });

function router(service: Array<Response | Error>, tokens = [token()]) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input).includes('/auth/token')) return tokens.shift() ?? token();
    const next = service.shift();
    if (next === undefined) throw new Error(`sin respuesta para ${String(input)}`);
    if (next instanceof Error) throw next;
    return next;
  });
}

function serviceCalls(fetch: ReturnType<typeof router>) {
  return fetch.mock.calls.filter(([url]) => !String(url).includes('/auth/token'));
}

/** Sin espera real entre reintentos: `baseDelayMs: 0`. */
function sabre(fetch: typeof globalThis.fetch, logger?: SabreLogger) {
  return new Sabre(config({ fetch, retry: { baseDelayMs: 0 }, ...(logger === undefined ? {} : { logger }) }));
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

const issue = (category: string, type: string, description = 'detalle') => ({ category, type, description });

describe('sabre.air.getSeats por payload', () => {
  it('hace POST /v3/offers/getseats/byReservationPayload con el body tal cual y Bearer', async () => {
    const fetch = router([json(200, synthetic)]);
    await sabre(fetch).air.getSeats(request);

    const [[url, init]] = serviceCalls(fetch) as [[string, RequestInit]];
    expect(url).toBe('https://api.cert.platform.sabre.com/v3/offers/getseats/byReservationPayload');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(request);
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer T1');
  });

  it('devuelve response tal cual, con warnings y errors vacíos', async () => {
    const result = await sabre(router([json(200, synthetic)])).air.getSeats(request);

    expect(result).toEqual({ response: synthetic.response, warnings: [], errors: [] });
    const row8 = result.response.seatMaps[0]!.cabinCompartments![0]!.seatRows![0]!;
    expect(row8.seats[0]).toEqual({ column: 'A', occupationStatusCode: 'F', offerItemRefIds: ['OI1'] });
  });

  it('warnings[] se exponen como SabreWarning sin lanzar', async () => {
    const body = { ...synthetic, warnings: [issue('USER_PROFILE', 'STRING_LENGTH', 'truncado')] };
    const result = await sabre(router([json(200, body)])).air.getSeats(request);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toBeInstanceOf(SabreWarning);
    expect(result.warnings[0]).toMatchObject({ service: 'getSeatsByPayload', code: 'STRING_LENGTH' });
    expect(result.errors).toEqual([]);
  });

  it('errors[] junto con response no lanzan: van adjuntos al resultado', async () => {
    const body = { ...synthetic, errors: [issue('APPLICATION_ERROR', 'PARTIAL_CONTENT')] };
    const result = await sabre(router([json(200, body)])).air.getSeats(request);

    expect(result.response).toEqual(synthetic.response);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(SabreBusinessError);
    expect(result.errors[0]).toMatchObject({ code: 'PARTIAL_CONTENT', retryable: false });
  });

  it('errors[] sin response lanza SabreBusinessError con el primero y adjunta el resto', async () => {
    const body = {
      errors: [
        issue('BAD_REQUEST', 'REQUIRED_FIELD_MISSING', 'Client did not provide required data'),
        issue('BAD_REQUEST', 'INVALID_VALUE'),
      ],
      warnings: [issue('USER_PROFILE', 'STRING_LENGTH')],
    };
    const fetch = router([json(200, body)]);
    const error = await catchError(sabre(fetch).air.getSeats(request));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({
      service: 'getSeatsByPayload',
      code: 'REQUIRED_FIELD_MISSING',
      retryable: false,
      message: 'getSeatsByPayload: BAD_REQUEST REQUIRED_FIELD_MISSING: Client did not provide required data',
    });
    const business = error as SabreBusinessError;
    expect(business.errors.map((e) => e.code)).toEqual(['INVALID_VALUE']);
    expect(business.warnings.map((w) => w.code)).toEqual(['STRING_LENGTH']);
    // Sin catálogo, un error de negocio no se reintenta.
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('el mensaje no copia fieldValue, que puede traer datos del pasajero', async () => {
    const body = { errors: [{ ...issue('BAD_REQUEST', 'INVALID_VALUE'), fieldPath: 'passengers[0].surname', fieldValue: 'ANAREAL' }] };
    const error = (await catchError(sabre(router([json(200, body)])).air.getSeats(request))) as SabreBusinessError;

    expect(error.message).toContain('passengers[0].surname');
    expect(error.message).not.toContain('ANAREAL');
    expect(JSON.stringify(error)).not.toContain('ANAREAL');
  });

  it('error de gateway: 400 lanza SabreGatewayError sin reintentar', async () => {
    const fetch = router([json(400, { errorCode: 'ERR.2SG.CLIENT.BAD_REQUEST' })]);
    const error = await catchError(sabre(fetch).air.getSeats(request));

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error).toMatchObject({ status: 400, code: 'ERR.2SG.CLIENT.BAD_REQUEST', retryable: false });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('503 se reintenta: es una lectura', async () => {
    const fetch = router([json(503, {}), json(200, synthetic)]);
    const result = await sabre(fetch).air.getSeats(request);

    expect(result.response.offerId).toBe('OFFER_1');
    expect(serviceCalls(fetch)).toHaveLength(2);
  });

  it('401 renueva el token y reintenta una vez', async () => {
    const fetch = router([json(401, { errorCode: 'ERR.2SG.SEC.INVALID_CREDENTIALS' }), json(200, synthetic)], [
      token('T1'),
      token('T2'),
    ]);
    const result = await sabre(fetch).air.getSeats(request);

    expect(result.response.offerId).toBe('OFFER_1');
    const calls = serviceCalls(fetch) as Array<[string, RequestInit]>;
    expect(calls.map(([, init]) => (init.headers as Headers).get('Authorization'))).toEqual(['Bearer T1', 'Bearer T2']);
  });

  it('onRawResponse recibe operation air.getSeatsByPayload, y los logs service getSeatsByPayload', async () => {
    const raws: SabreRawResponse[] = [];
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await sabre(router([json(200, synthetic)]), log).air.getSeats(request, { onRawResponse: (raw) => raws.push(raw) });

    expect(raws).toEqual([expect.objectContaining({ operation: 'air.getSeatsByPayload', status: 200, attempts: 1 })]);
    expect(log.info).toHaveBeenCalledWith(
      'sabre.request.end',
      expect.objectContaining({ service: 'getSeatsByPayload', path: '/v3/offers/getseats/byReservationPayload' }),
    );
  });

  it('valida la forma del request sin llamar a la red', async () => {
    const fetch = router([]);
    const client = sabre(fetch);

    await expect(client.air.getSeats(null as never)).rejects.toThrow(/^sabre-client: /);
    await expect(client.air.getSeats({ segments: [] } as never)).rejects.toThrow(/^sabre-client: /);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('sabre.air.getSeats por localizador', () => {
  it('con pnrLocator hace POST /v3/offers/getseats/byPnrLocator con el body tal cual', async () => {
    const fetch = router([json(200, synthetic)]);
    const pnr = { pnrLocator: 'GLEBNY', returnSeatMapsOnlyForSegmentIds: ['1'], currencyCode: 'USD' };
    const result = await sabre(fetch).air.getSeats(pnr);

    const [[url, init]] = serviceCalls(fetch) as [[string, RequestInit]];
    expect(url).toBe('https://api.cert.platform.sabre.com/v3/offers/getseats/byPnrLocator');
    expect(JSON.parse(init.body as string)).toEqual(pnr);
    expect(result).toEqual({ response: synthetic.response, warnings: [], errors: [] });
  });

  it('con y sin pnrLocator, cada request llega a su endpoint', async () => {
    const fetch = router([json(200, synthetic), json(200, synthetic)]);
    const client = sabre(fetch);
    await client.air.getSeats({ pnrLocator: 'GLEBNY' });
    await client.air.getSeats(request);

    expect(serviceCalls(fetch).map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/v3/offers/getseats/byPnrLocator',
      '/v3/offers/getseats/byReservationPayload',
    ]);
  });

  it('errors[] sin response lanza SabreBusinessError con service getSeatsByPnrLocator', async () => {
    const body = { errors: [issue('NOT_FOUND', 'PNR_NOT_FOUND', 'PNR not found')] };
    const error = await catchError(sabre(router([json(200, body)])).air.getSeats({ pnrLocator: 'ZZZZZZ' }));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'getSeatsByPnrLocator', code: 'PNR_NOT_FOUND', retryable: false });
  });

  it('onRawResponse recibe operation air.getSeatsByPnrLocator, y los logs service getSeatsByPnrLocator', async () => {
    const raws: SabreRawResponse[] = [];
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await sabre(router([json(200, synthetic)]), log).air.getSeats(
      { pnrLocator: 'GLEBNY' },
      { onRawResponse: (raw) => raws.push(raw) },
    );

    expect(raws).toEqual([expect.objectContaining({ operation: 'air.getSeatsByPnrLocator', status: 200 })]);
    expect(log.info).toHaveBeenCalledWith(
      'sabre.request.end',
      expect.objectContaining({ service: 'getSeatsByPnrLocator', path: '/v3/offers/getseats/byPnrLocator' }),
    );
  });

  it.each([
    ['vacío', { pnrLocator: '' }],
    ['no string', { pnrLocator: 123 }],
    ['con segments', { pnrLocator: 'GLEBNY', segments: request.segments }],
    ['con passengers', { pnrLocator: 'GLEBNY', passengers: request.passengers }],
    ['con returnSeatMapsOnlyForSegmentRefs', { pnrLocator: 'GLEBNY', returnSeatMapsOnlyForSegmentRefs: ['1'] }],
  ])('pnrLocator %s lanza TypeError sin llamar a la red', async (_name, rq) => {
    const fetch = router([]);
    await expect(sabre(fetch).air.getSeats(rq as never)).rejects.toThrow(/^sabre-client: /);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('classifyGetSeats', () => {
  it('body que no es objeto, o sin response ni errors: SabreError de respuesta malformada', () => {
    for (const body of [undefined, 'texto', {}, { errors: [] }]) {
      const error = classifyGetSeats(body, 'getSeatsByPayload');
      expect(error).toBeInstanceOf(SabreError);
      expect(error).not.toBeInstanceOf(SabreBusinessError);
      expect(error?.message).toMatch(/^getSeatsByPayload: respuesta malformada/);
    }
  });

  it('con response no clasifica como error', () => {
    expect(classifyGetSeats(synthetic, 'getSeatsByPayload')).toBeUndefined();
  });
});
