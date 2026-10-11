import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { SabreBusinessError, SabreGatewayError } from '../src/errors/index.js';
import { RestTransport, type RestRequest } from '../src/http/rest-transport.js';
import { retryDelay, shouldRetry } from '../src/http/retry.js';
import type { SabreLogger } from '../src/logging/index.js';
import { config, json, mockFetch } from './helpers.js';

const shop: RestRequest = { method: 'POST', path: '/v5/offers/shop', service: 'bargainFinderMax', idempotent: true };
const createBooking: RestRequest = { method: 'POST', path: '/v1/trip/orders/createBooking', service: 'createBooking', idempotent: false };

describe('retryDelay (full jitter con piso de 500 ms)', () => {
  it('crece como baseDelayMs · 2^n con random = 1', () => {
    expect([0, 1, 2, 3].map((n) => retryDelay(n, 500, () => 1))).toEqual([500, 1000, 2000, 4000]);
  });

  it('nunca baja de 500 ms', () => {
    expect(retryDelay(3, 500, () => 0)).toBe(500);
    expect(retryDelay(0, 100, () => 0.9)).toBe(500);
  });

  it('es aleatorio entre el piso y el tope', () => {
    expect(retryDelay(2, 500, () => 0.5)).toBe(1000);
  });
});

describe('shouldRetry', () => {
  const retryable = new SabreGatewayError('x', { protocol: 'rest', status: 503, retryable: true });
  it('solo SabreError retryable en operaciones idempotentes', () => {
    expect(shouldRetry(retryable, true)).toBe(true);
    expect(shouldRetry(retryable, false)).toBe(false);
    expect(shouldRetry(new SabreGatewayError('x', { protocol: 'rest', status: 400, retryable: false }), true)).toBe(false);
    expect(shouldRetry(new SabreBusinessError('x', { service: 's', code: '1' }), true)).toBe(false);
    // Un error de negocio temporal se reintenta solo si la operación es idempotente.
    const temporary = new SabreBusinessError('x', { service: 's', code: '1', retryable: true });
    expect(shouldRetry(temporary, true)).toBe(true);
    expect(shouldRetry(temporary, false)).toBe(false);
    expect(shouldRetry(new Error('x'), true)).toBe(false);
  });
});

describe('RestTransport con reintentos (timers falsos)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function transport(fetch: typeof globalThis.fetch, extra: Parameters<typeof config>[0] = {}) {
    return new RestTransport(resolveConfig(config({ fetch, ...extra })), { random: () => 1 });
  }

  it('por defecto hace 3 reintentos (4 llamadas) con delays 500/1000/2000 y luego lanza', async () => {
    const fetch = mockFetch(json(503), json(503), json(503), json(503));
    const result = transport(fetch).request(shop);
    const settled = result.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(4);

    const error = await settled;
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as SabreGatewayError).status).toBe(503);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('devuelve la data si un reintento tiene éxito', async () => {
    const fetch = mockFetch(json(429), json(200, { ok: true }));
    const result = transport(fetch).request(shop);
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reintenta fallos de red', async () => {
    const fetch = mockFetch(new TypeError('fetch failed'), json(200, {}));
    const result = transport(fetch).request(shop);
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toEqual({});
  });

  it('una escritura no idempotente nunca se reintenta', async () => {
    const fetch = mockFetch(json(503), json(200, {}));
    await expect(transport(fetch).request(createBooking)).rejects.toBeInstanceOf(SabreGatewayError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('no reintenta errores no reintentables ni de negocio', async () => {
    const fetch = mockFetch(json(400), json(200, { errors: [] }));
    const t = transport(fetch);
    await expect(t.request(shop)).rejects.toMatchObject({ status: 400 });
    const classify = () => new SabreBusinessError('x', { service: 'bargainFinderMax', code: '1' });
    await expect(t.request({ ...shop, classify })).rejects.toBeInstanceOf(SabreBusinessError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('la config del cliente se puede pisar por request', async () => {
    const fetch = mockFetch(json(500), json(500), json(500));
    const t = transport(fetch, { retry: { maxRetries: 0 } });
    await expect(t.request(shop)).rejects.toBeInstanceOf(SabreGatewayError);
    expect(fetch).toHaveBeenCalledTimes(1);

    const result = t.request({ ...shop, retry: { maxRetries: 1, baseDelayMs: 1000 } }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await result).toBeInstanceOf(SabreGatewayError);
  });

  it('emite sabre.request.retry por cada reintento', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies SabreLogger;
    const fetch = mockFetch(json(503), json(200, {}));
    const result = transport(fetch, { logger }).request(shop);
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(logger.warn).toHaveBeenCalledWith(
      'sabre.request.retry',
      expect.objectContaining({ service: 'bargainFinderMax', attempt: 1, maxRetries: 3, delayMs: 500 }),
    );
  });

  it('un abort durante la espera corta los reintentos', async () => {
    const controller = new AbortController();
    const fetch = mockFetch(json(503), json(200, {}));
    const result = transport(fetch).request({ ...shop, signal: controller.signal }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new DOMException('cancelado', 'AbortError'));
    const error = await result;
    expect((error as DOMException).name).toBe('AbortError');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('valida el retry por request', async () => {
    await expect(transport(mockFetch()).request({ ...shop, retry: { maxRetries: 1.5 } })).rejects.toThrow(/maxRetries/);
  });
});
