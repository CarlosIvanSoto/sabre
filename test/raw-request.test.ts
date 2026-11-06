// onRawRequest (ADR-029): el request que salió por la red, sin Authorization y con el token SOAP
// tapado, una vez por operación.
import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { RestTransport } from '../src/http/rest-transport.js';
import { SoapTransport } from '../src/http/soap-transport.js';
import { Sabre, SabreGatewayError, type SabreLogger, type SabreRawRequest } from '../src/index.js';
import { REDACTED } from '../src/logging/redact.js';
import { config, json, mockFetch } from './helpers.js';
import {
  SESSION_TOKEN,
  legacyClient,
  memoryLogger,
  queueRS,
  rejection,
  request,
  sentBody,
  sessionOpened,
  setup,
  soap,
  success,
  xml,
} from './soap-helpers.js';

const token = () => json(200, { access_token: 'T1-SECRETO', expires_in: 604800, token_type: 'bearer' });

function router(service: Array<Response | Error>) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input).includes('/auth/token')) return token();
    const next = service.shift();
    if (next === undefined) throw new Error(`sin respuesta para ${String(input)}`);
    if (next instanceof Error) throw next;
    return next;
  });
}

const text = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
const getBody = '{"bookingId":"GLEBNY","travelers":[{"givenName":"ANAREAL"}]}';

function logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies SabreLogger;
}

/** Ni el token de OAuth, ni el secreto del cliente, ni la contraseña del EPR. */
function expectNoSecrets(raw: SabreRawRequest) {
  const all = JSON.stringify({ ...raw, headers: [...raw.headers.entries()] });
  for (const secret of ['T1-SECRETO', 'client-secret', 'epr-pass', SESSION_TOKEN]) expect(all).not.toContain(secret);
  expect(raw.headers.has('Authorization')).toBe(false);
}

describe('onRawRequest: REST', () => {
  it('entrega method, url, headers sin Authorization y el body tal cual, antes que onRawResponse', async () => {
    const order: string[] = [];
    const raws: SabreRawRequest[] = [];
    const fetch = router([text(200, '{"confirmationId":"GLEBNY"}')]);
    const sabre = new Sabre(config({ fetch }));

    await sabre.booking.create(
      { travelers: [{ givenName: 'ANA' }] } as never,
      {
        onRawRequest: (raw) => {
          order.push('request');
          raws.push(raw);
        },
        onRawResponse: () => order.push('response'),
      },
    );

    expect(order).toEqual(['request', 'response']);
    expect(raws).toHaveLength(1);
    const [raw] = raws;
    expect(raw).toMatchObject({
      operation: 'booking.create',
      protocol: 'rest',
      method: 'POST',
      body: '{"travelers":[{"givenName":"ANA"}]}',
      attempts: 1,
    });
    const sent = fetch.mock.calls.find(([url]) => !String(url).includes('/auth/token'))!;
    expect(raw!.url).toBe(String(sent[0]));
    expect(raw!.headers.get('Content-Type')).toBe('application/json');
    expect(new Headers(sent[1]?.headers).get('Authorization')).toBe('Bearer T1-SECRETO');
    expectNoSecrets(raw!);
  });

  it('GET sin body: body undefined, y la url con su query string', async () => {
    const raws: SabreRawRequest[] = [];
    const fetch = router([text(200, '{}')]);
    const transport = new RestTransport(resolveConfig(config({ fetch })));
    await transport.request({
      method: 'GET',
      path: '/v1/algo',
      service: 'algo',
      idempotent: true,
      query: { locator: 'GLEBNY' },
      operation: 'algo.get',
      onRawRequest: (raw) => raws.push(raw),
    });
    expect(raws).toEqual([
      expect.objectContaining({ operation: 'algo.get', method: 'GET', url: String(fetch.mock.calls[0]![0]), body: undefined }),
    ]);
    expect(raws[0]!.url).toContain('/v1/algo?locator=GLEBNY');
  });

  it('no se llama con auth: false (la request de token)', async () => {
    const onRawRequest = vi.fn();
    const transport = new RestTransport(resolveConfig(config({ fetch: router([text(200, '{}')]) })));
    await transport.request({ method: 'POST', path: '/v2/auth/token', service: 'token', idempotent: false, auth: false, onRawRequest });
    expect(onRawRequest).not.toHaveBeenCalled();
  });

  it('con reintentos y 401: una sola llamada, con el último intento y attempts contando todos', async () => {
    const raws: SabreRawRequest[] = [];
    const fetch = router([text(401, '{"error":"invalid_token"}'), text(503, '{}'), text(200, getBody)]);
    const sabre = new Sabre(config({ retry: { maxRetries: 2, baseDelayMs: 0 }, fetch }));

    await sabre.booking.get({ confirmationId: 'GLEBNY' }, { onRawRequest: (raw) => raws.push(raw) });

    expect(raws).toHaveLength(1);
    expect(raws[0]!.attempts).toBe(3);
    expectNoSecrets(raws[0]!);
  });

  it('se llama aunque ningún intento tenga respuesta HTTP (fallo de red)', async () => {
    const onRawRequest = vi.fn();
    const onRawResponse = vi.fn();
    const sabre = new Sabre(config({ retry: { maxRetries: 0 }, fetch: router([new TypeError('fetch failed')]) }));

    await expect(sabre.booking.get({ confirmationId: 'GLEBNY' }, { onRawRequest, onRawResponse })).rejects.toThrow(
      SabreGatewayError,
    );
    expect(onRawRequest).toHaveBeenCalledTimes(1);
    expect(onRawRequest.mock.calls[0]?.[0]).toMatchObject({ operation: 'booking.get', attempts: 1 });
    expect(onRawResponse).not.toHaveBeenCalled();
  });

  it('se llama también con AbortError', async () => {
    const controller = new AbortController();
    const fetch = router([]);
    fetch.mockImplementation(async (input) => {
      if (String(input).includes('/auth/token')) return token();
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const onRawRequest = vi.fn();
    const sabre = new Sabre(config({ fetch }));

    await expect(sabre.booking.get({ confirmationId: 'GLEBNY' }, { signal: controller.signal, onRawRequest })).rejects.toThrow();
    expect(onRawRequest).toHaveBeenCalledTimes(1);
  });

  it('no se llama si la operación lanza antes de mandar nada', async () => {
    const onRawRequest = vi.fn();
    const fetch = router([]);
    const sabre = new Sabre(config({ fetch }));
    await expect(sabre.air.bargainFinderMax({} as never, { onRawRequest })).rejects.toThrow(TypeError);
    expect(onRawRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('un callback que lanza no rompe la operación, y el logger no ve el body', async () => {
    const log = logger();
    const sabre = new Sabre(config({ logger: log, fetch: router([text(200, '{"confirmationId":"GLEBNY"}')]) }));

    const result = await sabre.booking.create({ travelers: [{ givenName: 'ANAREAL' }] } as never, {
      onRawRequest: () => {
        throw new RangeError('no se pudo guardar');
      },
    });

    expect(result.confirmationId).toBe('GLEBNY');
    expect(log.warn).toHaveBeenCalledWith('sabre.request.rawRequestHookFailed', {
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
    [
      'air.getSeatsByPayload',
      (s: Sabre, o: object) => s.air.getSeats({ returnSeatMapsOnlyForSegmentRefs: [], segments: [], passengers: [] }, o),
    ],
    ['air.getSeatsByPnrLocator', (s: Sabre, o: object) => s.air.getSeats({ pnrLocator: 'GLEBNY' }, o)],
    ['booking.create', (s: Sabre, o: object) => s.booking.create({}, o)],
    ['booking.get', (s: Sabre, o: object) => s.booking.get({ confirmationId: 'GLEBNY' }, o)],
    ['booking.cancel', (s: Sabre, o: object) => s.booking.cancel({ confirmationId: 'GLEBNY', cancelAll: true }, o)],
  ])('%s acepta onRawRequest y lo identifica en operation', async (operation, call) => {
    const raws: SabreRawRequest[] = [];
    const sabre = new Sabre(config({ retry: { maxRetries: 0 }, fetch: router([text(500, '{"error":"x"}')]) }));

    await expect(call(sabre, { onRawRequest: (raw: SabreRawRequest) => raws.push(raw) })).rejects.toThrow(SabreGatewayError);
    expect(raws).toEqual([expect.objectContaining({ operation, protocol: 'rest', attempts: 1 })]);
    expectNoSecrets(raws[0]!);
  });
});

describe('onRawRequest: SOAP', () => {
  it('entrega el sobre que se mandó, con solo el token tapado', async () => {
    const raws: SabreRawRequest[] = [];
    const { fetch, transport } = setup(xml(200, soap(queueRS(success))));

    await transport.request(request({ operation: 'queue.access', onRawRequest: (raw) => raws.push(raw) }));

    expect(raws).toHaveLength(1);
    const [raw] = raws;
    expect(raw).toMatchObject({
      operation: 'queue.access',
      protocol: 'soap',
      method: 'POST',
      url: 'https://webservices.platform.sabre.com',
      attempts: 1,
    });
    expect(raw!.headers.get('Content-Type')).toBe('text/xml; charset=utf-8');
    const sent = sentBody(fetch, 0);
    expect(sent).toContain(SESSION_TOKEN.replace(/&/g, '&amp;'));
    expect(raw!.body).toBe(sent.replace(/(<wsse:BinarySecurityToken[^>]*>)[^<]*(<\/wsse:BinarySecurityToken>)/, `$1${REDACTED}$2`));
    expectNoSecrets(raw!);
  });

  it('se llama antes que onRawResponse, también sin respuesta HTTP', async () => {
    const order: string[] = [];
    const { transport } = setup(new TypeError('fetch failed'));
    await rejection(
      transport.request(
        request({ onRawRequest: () => order.push('request'), onRawResponse: () => order.push('response') }),
      ),
    );
    expect(order).toEqual(['request']);
  });

  it('con reintentos entrega el último sobre: eb:MessageId cambia en cada intento', async () => {
    let id = 0;
    const fetch = mockFetch(xml(500, 'busy'), xml(200, soap(queueRS(success))));
    const transport = new SoapTransport(resolveConfig(config({ environment: 'production', fetch, logger: memoryLogger().logger })), {
      messageId: () => `id-${++id}`,
      sleep: async () => {},
    });
    const raws: SabreRawRequest[] = [];

    await transport.request(request({ idempotent: true, retry: { maxRetries: 1, baseDelayMs: 0 }, onRawRequest: (raw) => raws.push(raw) }));

    expect(sentBody(fetch, 0)).toContain('<eb:MessageId>mid:id-1</eb:MessageId>');
    expect(sentBody(fetch, 1)).toContain('<eb:MessageId>mid:id-2</eb:MessageId>');
    expect(raws).toHaveLength(1);
    expect(raws[0]!.attempts).toBe(2);
    expect(raws[0]!.body).toContain('<eb:MessageId>mid:id-2</eb:MessageId>');
  });

  it('con usernameToken (SessionCreateRQ) no se llama: el sobre lleva la contraseña', async () => {
    const onRawRequest = vi.fn();
    const { transport } = setup(xml(200, soap(queueRS(success))));
    await transport.request(
      request({
        security: { usernameToken: { username: 'agente', password: 'clave-epr', organization: 'ABCD', domain: 'AA' } },
        onRawRequest,
      }),
    );
    expect(onRawRequest).not.toHaveBeenCalled();
  });

  it('un callback que lanza no rompe la operación', async () => {
    const { transport, calls } = setup(xml(200, soap(queueRS(success))));
    const onRawRequest = vi.fn(() => {
      throw new Error('falla del consumidor');
    });
    await expect(transport.request(request({ operation: 'queue.access', onRawRequest }))).resolves.toMatchObject({
      payloadName: 'QueueAccessRS',
    });
    expect(calls.find(([, event]) => event === 'sabre.request.rawRequestHookFailed')?.[2]).toEqual({
      service: 'queueAccess',
      operation: 'queue.access',
      errorName: 'Error',
    });
  });
});

describe('onRawRequest: sesión SOAP', () => {
  const LIST = queueRS(success, '<Line Number="1"><DateTime>2026-11-05T10:07</DateTime><UniqueID ID="ABC123"/></Line>');

  it('openSession y close no lo llaman; queue.list y ping sí, sin el token ni la contraseña', async () => {
    const fetch = mockFetch(
      sessionOpened(),
      xml(200, soap(LIST)),
      xml(200, soap('<OTA_PingRS xmlns="http://www.opentravel.org/OTA/2003/05" Version="1.0.0"><Success/><EchoData>sabre-client</EchoData></OTA_PingRS>')),
      xml(200, soap('<SessionCloseRS xmlns="http://www.opentravel.org/OTA/2002/11" status="Approved"/>')),
    );
    const raws: SabreRawRequest[] = [];
    const onRawRequest = (raw: SabreRawRequest) => raws.push(raw);
    const session = await legacyClient(fetch).client.openSession({ onRawRequest });

    await session.queue.list({ queue: 1 }, { onRawRequest });
    await session.ping({ onRawRequest });
    await session.close({ onRawRequest });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(raws.map((raw) => raw.operation)).toEqual(['queue.list', 'ping']);
    expect(raws[0]!.body).toContain('<QueueIdentifier Number="1"');
    expect(raws[0]!.body).toContain(`>${REDACTED}</wsse:BinarySecurityToken>`);
    for (const raw of raws) expectNoSecrets(raw);
  });

  it('no se llama si la operación lanza TypeError sin red', async () => {
    const fetch = mockFetch(sessionOpened());
    const onRawRequest = vi.fn();
    const session = await legacyClient(fetch).client.openSession();
    await rejection(session.queue.list({ queue: 999 }, { onRawRequest }));
    expect(onRawRequest).not.toHaveBeenCalled();
  });
});
