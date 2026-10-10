import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { SabreBusinessError, SabreGatewayError } from '../src/errors/index.js';
import { RestTransport, type RestRequest } from '../src/http/rest-transport.js';
import type { SabreLogger } from '../src/logging/index.js';
import { config, json, mockFetch } from './helpers.js';

const shop: RestRequest = { method: 'POST', path: '/v5/offers/shop', service: 'bargainFinderMax', idempotent: true };

function transport(fetch: typeof globalThis.fetch, extra: Parameters<typeof config>[0] = {}) {
  // Sin reintentos: esta suite prueba la clasificación; los reintentos van en retry.test.ts.
  return new RestTransport(resolveConfig(config({ fetch, retry: { maxRetries: 0 }, ...extra })));
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

describe('RestTransport', () => {
  it('hace POST JSON a la base URL del entorno y devuelve el body', async () => {
    const fetch = mockFetch(json(200, { groupedItineraryResponse: { version: '5' } }));
    const data = await transport(fetch).request({ ...shop, body: { OTA_AirLowFareSearchRQ: {} }, query: { mode: 'live', x: undefined } });

    expect(data).toEqual({ groupedItineraryResponse: { version: '5' } });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.cert.platform.sabre.com/v5/offers/shop?mode=live');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"OTA_AirLowFareSearchRQ":{}}');
    const headers = init?.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('pide el header Authorization al proveedor, salvo con auth: false', async () => {
    const fetch = mockFetch(json(200, {}), json(200, {}));
    const t = transport(fetch);
    const provider = { get: vi.fn(async () => 'Bearer T1RLAQ'), invalidate: vi.fn() };
    t.setAuthorizationProvider(provider);

    await t.request(shop);
    await t.request({ ...shop, auth: false });

    expect((fetch.mock.calls[0]![1]?.headers as Headers).get('Authorization')).toBe('Bearer T1RLAQ');
    expect((fetch.mock.calls[1]![1]?.headers as Headers).has('Authorization')).toBe(false);
    expect(provider.get).toHaveBeenCalledOnce();
  });

  describe('paso 1: errores de gateway REST', () => {
    it.each([
      [400, 'ERR.2SG.CLIENT.INVALID_REQUEST', false],
      [401, 'ERR.2SG.SEC.INVALID_CREDENTIALS', false],
      [403, 'ERR.2SG.SEC.NOT_AUTHORIZED', false],
      [404, undefined, false],
      [413, 'ERR.2SG.CLIENT.INVALID_REQUEST', false],
      [429, 'ERR.2SG.GATEWAY.REQUEST_THROTTLED', true],
      [500, 'ERR.2SG.GATEWAY.TIMEOUT', true],
      [503, undefined, true],
      [504, undefined, true],
    ])('HTTP %i → SabreGatewayError (code %s, retryable %s)', async (status, code, retryable) => {
      const body = code === undefined ? undefined : { errorCode: code, message: 'detalle' };
      const error = await catchError(transport(mockFetch(json(status, body))).request(shop));

      expect(error).toBeInstanceOf(SabreGatewayError);
      const gateway = error as SabreGatewayError;
      expect(gateway.protocol).toBe('rest');
      expect(gateway.status).toBe(status);
      expect(gateway.code).toBe(code);
      expect(gateway.retryable).toBe(retryable);
      expect(gateway.raw).toEqual(body);
    });

    it('extrae el código de `error` (formato OAuth) y conserva bodies no JSON en raw', async () => {
      const oauth = await catchError(transport(mockFetch(json(401, { error: 'invalid_client' }))).request(shop));
      expect((oauth as SabreGatewayError).code).toBe('invalid_client');

      const html = new Response('<html>Gateway Timeout</html>', { status: 504 });
      const text = (await catchError(transport(mockFetch(html)).request(shop))) as SabreGatewayError;
      expect(text.code).toBeUndefined();
      expect(text.raw).toBe('<html>Gateway Timeout</html>');
    });

    it('no llama al clasificador del servicio si el status no es 2xx', async () => {
      const classify = vi.fn();
      await catchError(transport(mockFetch(json(500, {}))).request({ ...shop, classify }));
      expect(classify).not.toHaveBeenCalled();
    });

    it('un fallo de red es SabreGatewayError reintentable con cause', async () => {
      const cause = new TypeError('fetch failed');
      const error = (await catchError(transport(mockFetch(cause)).request(shop))) as SabreGatewayError;
      expect(error).toBeInstanceOf(SabreGatewayError);
      expect(error.status).toBeUndefined();
      expect(error.retryable).toBe(true);
      expect(error.cause).toBe(cause);
    });

    it('un abort del consumidor se propaga sin envolver', async () => {
      const controller = new AbortController();
      controller.abort();
      const abort = new DOMException('aborted', 'AbortError');
      const error = await catchError(transport(mockFetch(abort)).request({ ...shop, signal: controller.signal }));
      expect(error).toBe(abort);
    });
  });

  describe('pasos 2–4: catálogo del servicio y data', () => {
    it('lanza el error que devuelve el clasificador del servicio', async () => {
      const body = { errors: [{ code: 'ERR.NO_AVAILABILITY' }] };
      const classify = vi.fn(
        (b: unknown) => new SabreBusinessError('Sin disponibilidad', { service: 'bargainFinderMax', code: 'ERR.NO_AVAILABILITY', raw: b }),
      );
      const error = await catchError(transport(mockFetch(json(200, body))).request({ ...shop, classify }));
      expect(error).toBeInstanceOf(SabreBusinessError);
      expect(classify).toHaveBeenCalledWith(body, expect.any(Response));
    });

    it('si el clasificador no encuentra error, devuelve la data', async () => {
      const data = await transport(mockFetch(json(200, { ok: 1 }))).request({ ...shop, classify: () => undefined });
      expect(data).toEqual({ ok: 1 });
    });

    it('una respuesta vacía devuelve undefined', async () => {
      expect(await transport(mockFetch(new Response(null, { status: 204 }))).request(shop)).toBeUndefined();
    });
  });

  describe('logging', () => {
    it('emite start/end sin bodies, secretos ni pasajeros', async () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies SabreLogger;
      const fetch = mockFetch(json(200, { travelers: [{ givenName: 'Ana' }] }));
      const t = transport(fetch, { logger });
      t.setAuthorizationProvider({ get: async () => 'Bearer T1RLAQ-secret', invalidate: () => {} });

      await t.request({ ...shop, body: { travelers: [{ givenName: 'Luis' }] } });

      expect(logger.debug).toHaveBeenCalledWith('sabre.request.start', expect.objectContaining({ service: 'bargainFinderMax' }));
      expect(logger.info).toHaveBeenCalledWith('sabre.request.end', expect.objectContaining({ status: 200 }));
      const everything = JSON.stringify(Object.values(logger).flatMap((fn) => fn.mock.calls));
      for (const secret of ['T1RLAQ-secret', 'Ana', 'Luis', 'client-secret', 'epr-pass']) {
        expect(everything).not.toContain(secret);
      }
    });

    it('el evento de error no incluye raw', async () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies SabreLogger;
      await catchError(transport(mockFetch(json(400, { errorCode: 'X', detail: 'contenido-raw' })), { logger }).request(shop));
      const [, context] = logger.error.mock.calls[0]!;
      expect(JSON.stringify(context)).toContain('"code":"X"');
      expect(JSON.stringify(context)).not.toContain('contenido-raw');
    });
  });
});
