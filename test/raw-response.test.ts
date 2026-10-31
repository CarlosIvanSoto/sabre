import { describe, expect, it, vi } from 'vitest';
import {
  Sabre,
  SabreBusinessError,
  SabreGatewayError,
  type SabreLogger,
  type SabreRawResponse,
} from '../src/index.js';
import { config, json } from './helpers.js';

const token = () => json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });

function router(service: Array<Response | Error>) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input).includes('/auth/token')) return token();
    const next = service.shift();
    if (next === undefined) throw new Error(`sin respuesta para ${String(input)}`);
    if (next instanceof Error) throw next;
    return next;
  });
}

function tokenCalls(fetch: ReturnType<typeof router>) {
  return fetch.mock.calls.filter(([url]) => String(url).includes('/auth/token')).length;
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'r-1' } });
}

/** Sin espera real entre reintentos. */
const fast = { retry: { maxRetries: 2, baseDelayMs: 0 } };

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies SabreLogger;
}

const getBody = '{"bookingId":"GLEBNY","travelers":[{"givenName":"ANAREAL"}]}';
const notFound = '{"errors":[{"category":"RESOURCE_NOT_FOUND","type":"BOOKING_NOT_FOUND","description":"x"}]}';

describe('onRawResponse', () => {
  it('200 con éxito: entrega el body tal cual, una vez y antes de devolver', async () => {
    const order: string[] = [];
    const raws: SabreRawResponse[] = [];
    const sabre = new Sabre(config({ fetch: router([text(200, getBody)]) }));

    const result = await sabre.booking.get(
      { confirmationId: 'GLEBNY' },
      {
        onRawResponse: (raw) => {
          order.push('raw');
          raws.push(raw);
        },
      },
    );
    order.push('result');

    expect(order).toEqual(['raw', 'result']);
    expect(result.bookingId).toBe('GLEBNY');
    expect(raws).toHaveLength(1);
    expect(raws[0]).toMatchObject({ operation: 'booking.get', protocol: 'rest', status: 200, body: getBody, attempts: 1 });
    expect(raws[0]!.headers).toBeInstanceOf(Headers);
    expect(raws[0]!.headers.get('X-Request-Id')).toBe('r-1');
  });

  it('200 con errors[] que lanza SabreBusinessError: entrega el body completo antes de lanzar', async () => {
    const raws: SabreRawResponse[] = [];
    const sabre = new Sabre(config({ fetch: router([text(200, notFound)]) }));

    const error = await catchError(
      sabre.booking.get({ confirmationId: 'GLEBNY' }, { onRawResponse: (raw) => raws.push(raw) }),
    );

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(raws).toHaveLength(1);
    expect(raws[0]).toMatchObject({ status: 200, body: notFound, attempts: 1 });
  });

  it('no 2xx que lanza SabreGatewayError: entrega el texto sin parsear', async () => {
    const raws: SabreRawResponse[] = [];
    const body = '<html>Bad Request</html>';
    const sabre = new Sabre(config({ fetch: router([text(400, body)]) }));

    const error = await catchError(
      sabre.air.bargainFinderMax({ OTA_AirLowFareSearchRQ: {} as never }, { onRawResponse: (raw) => raws.push(raw) }),
    );

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(raws).toEqual([expect.objectContaining({ operation: 'air.bargainFinderMax', status: 400, body, attempts: 1 })]);
  });

  it('con reintentos entrega solo el último intento, con attempts contando todos', async () => {
    const raws: SabreRawResponse[] = [];
    const sabre = new Sabre(config({ ...fast, fetch: router([text(503, '{"error":"busy"}'), text(200, getBody)]) }));

    await sabre.booking.get({ confirmationId: 'GLEBNY' }, { onRawResponse: (raw) => raws.push(raw) });

    expect(raws).toEqual([expect.objectContaining({ status: 200, body: getBody, attempts: 2 })]);
  });

  it('401 con refresco del token: entrega el body del reintento y no la llamada de token', async () => {
    const raws: SabreRawResponse[] = [];
    const fetch = router([text(401, '{"error":"invalid_token"}'), text(200, getBody)]);

    await new Sabre(config({ fetch })).booking.get(
      { confirmationId: 'GLEBNY' },
      { onRawResponse: (raw) => raws.push(raw) },
    );

    expect(tokenCalls(fetch)).toBe(2);
    expect(raws).toEqual([expect.objectContaining({ status: 200, body: getBody, attempts: 2 })]);
    expect(raws[0]!.body).not.toContain('access_token');
  });

  it('error de red sin ninguna respuesta HTTP: no se llama', async () => {
    const onRawResponse = vi.fn();
    const sabre = new Sabre(config({ retry: { maxRetries: 0 }, fetch: router([new TypeError('fetch failed')]) }));

    await expect(sabre.booking.get({ confirmationId: 'GLEBNY' }, { onRawResponse })).rejects.toThrow(
      SabreGatewayError,
    );
    expect(onRawResponse).not.toHaveBeenCalled();
  });

  it('si el último intento falla por red, entrega el último que sí tuvo respuesta HTTP', async () => {
    const raws: SabreRawResponse[] = [];
    const sabre = new Sabre(
      config({ retry: { maxRetries: 1, baseDelayMs: 0 }, fetch: router([text(503, '{"error":"busy"}'), new TypeError('fetch failed')]) }),
    );

    await expect(
      sabre.booking.get({ confirmationId: 'GLEBNY' }, { onRawResponse: (raw) => raws.push(raw) }),
    ).rejects.toThrow(SabreGatewayError);
    expect(raws).toEqual([expect.objectContaining({ status: 503, body: '{"error":"busy"}', attempts: 2 })]);
  });

  it('el callback lanza en booking.create: se devuelve el confirmationId y el logger no ve el body', async () => {
    const log = logger();
    const body = '{"confirmationId":"GLEBNY","booking":{"bookingId":"GLEBNY","travelers":[{"givenName":"ANAREAL"}]}}';
    const sabre = new Sabre(config({ logger: log, fetch: router([text(200, body)]) }));

    const result = await sabre.booking.create(
      {},
      {
        onRawResponse: () => {
          throw new RangeError('no se pudo guardar');
        },
      },
    );

    expect(result.confirmationId).toBe('GLEBNY');
    expect(log.warn).toHaveBeenCalledWith('sabre.request.rawResponseHookFailed', {
      service: 'createBooking',
      operation: 'booking.create',
      errorName: 'RangeError',
    });
    const logged = JSON.stringify(Object.values(log).flatMap((fn) => fn.mock.calls));
    expect(logged).not.toContain('ANAREAL');
    expect(logged).not.toContain('no se pudo guardar');
  });

  it.each([
    ['air.bargainFinderMax', (s: Sabre, o: object) => s.air.bargainFinderMax({ OTA_AirLowFareSearchRQ: {} as never }, o)],
    ['air.revalidateItinerary', (s: Sabre, o: object) => s.air.revalidateItinerary({ OTA_AirLowFareSearchRQ: {} as never }, o)],
    ['booking.create', (s: Sabre, o: object) => s.booking.create({}, o)],
    ['booking.get', (s: Sabre, o: object) => s.booking.get({ confirmationId: 'GLEBNY' }, o)],
    ['booking.cancel', (s: Sabre, o: object) => s.booking.cancel({ confirmationId: 'GLEBNY', cancelAll: true }, o)],
  ])('%s acepta onRawResponse y lo identifica en operation', async (operation, call) => {
    const raws: SabreRawResponse[] = [];
    const sabre = new Sabre(config({ retry: { maxRetries: 0 }, fetch: router([text(500, '{"error":"x"}')]) }));

    await expect(call(sabre, { onRawResponse: (raw: SabreRawResponse) => raws.push(raw) })).rejects.toThrow(
      SabreGatewayError,
    );
    expect(raws).toEqual([expect.objectContaining({ operation, protocol: 'rest', status: 500, body: '{"error":"x"}' })]);
  });
});
