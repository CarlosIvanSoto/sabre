import { describe, expect, it, vi } from 'vitest';
import { AuthManager } from '../src/auth/auth-manager.js';
import { resolveConfig, type SabreConfig } from '../src/config.js';
import { SabreGatewayError } from '../src/errors/index.js';
import { RestTransport, type RestRequest } from '../src/http/rest-transport.js';
import { config, json } from './helpers.js';

const shop: RestRequest = { method: 'POST', path: '/v5/offers/shop', service: 'bargainFinderMax', idempotent: true };
const createBooking: RestRequest = { method: 'POST', path: '/v1/trip/orders/createBooking', service: 'createBooking', idempotent: false };

const unauthorized = () => json(401, { errorCode: 'ERR.2SG.SEC.INVALID_CREDENTIALS' });

/** `fetch` que separa las respuestas del endpoint de token de las del servicio. */
function router(tokens: Array<Response | (() => Response)>, service: Array<Response | (() => Response)>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const isToken = String(input).includes('/auth/token');
    const next = (isToken ? tokens : service).shift();
    if (next === undefined) throw new Error(`sin respuesta para ${String(input)}`);
    return typeof next === 'function' ? next() : next;
  });
  const tokenCalls = () => fetch.mock.calls.filter(([url]) => String(url).includes('/auth/token')).length;
  const bearers = () =>
    fetch.mock.calls
      .filter(([url]) => !String(url).includes('/auth/token'))
      .map(([, init]) => (init?.headers as Headers).get('Authorization'));
  return { fetch, tokenCalls, bearers };
}

function token(n: number) {
  return json(200, { access_token: `T${n}`, expires_in: 604800, token_type: 'bearer' });
}

function setup(fetch: typeof globalThis.fetch, extra: Partial<SabreConfig> = {}) {
  const resolved = resolveConfig(config({ fetch, retry: { maxRetries: 0 }, ...extra } as SabreConfig));
  const transport = new RestTransport(resolved, { random: () => 1, sleep: async () => {} });
  const auth = new AuthManager(resolved, transport);
  transport.setAuthorizationProvider(auth.bearerProvider());
  return transport;
}

describe('Bearer en cada request', () => {
  it('manda Authorization: Bearer <token> y reutiliza el token', async () => {
    const r = router([token(1)], [json(200, {}), json(200, {})]);
    const transport = setup(r.fetch);
    await transport.request(shop);
    await transport.request(shop);

    expect(r.bearers()).toEqual(['Bearer T1', 'Bearer T1']);
    expect(r.tokenCalls()).toBe(1);
  });
});

describe('reintento reactivo ante 401', () => {
  it('401 → refresh → éxito, sin consumir el presupuesto de reintentos (maxRetries: 0)', async () => {
    const r = router([token(1), token(2)], [unauthorized(), json(200, { ok: true })]);
    const data = await setup(r.fetch).request(shop);

    expect(data).toEqual({ ok: true });
    expect(r.bearers()).toEqual(['Bearer T1', 'Bearer T2']);
    expect(r.tokenCalls()).toBe(2);
  });

  it('también aplica a escrituras no idempotentes', async () => {
    const r = router([token(1), token(2)], [unauthorized(), json(200, { id: 'ABC123' })]);
    expect(await setup(r.fetch).request(createBooking)).toEqual({ id: 'ABC123' });
  });

  it('401 persistente → error sin bucle, aun con la política de reintentos por defecto', async () => {
    const r = router([token(1), token(2)], [unauthorized(), unauthorized()]);
    const error = await setup(r.fetch, { retry: {} }).request(shop).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as SabreGatewayError).status).toBe(401);
    expect(r.fetch).toHaveBeenCalledTimes(4);
  });

  it('un 401 del propio endpoint de token no se reintenta', async () => {
    const r = router([token(1), json(401, { error: 'invalid_client' })], [unauthorized()]);
    const error = await setup(r.fetch, { retry: {} }).request(shop).catch((e: unknown) => e);

    expect((error as SabreGatewayError).code).toBe('invalid_client');
    expect(r.tokenCalls()).toBe(2);
    expect(r.fetch).toHaveBeenCalledTimes(3);
  });

  it('no reintenta 403 ni otros errores de gateway por esta vía', async () => {
    const r = router([token(1)], [json(403, { errorCode: 'ERR.2SG.SEC.NOT_AUTHORIZED' })]);
    await expect(setup(r.fetch).request(shop)).rejects.toBeInstanceOf(SabreGatewayError);
    expect(r.tokenCalls()).toBe(1);
  });

  it('el reintento genérico sigue disponible después del reactivo', async () => {
    const r = router([token(1), token(2)], [unauthorized(), json(503, {}), json(200, { ok: true })]);
    const data = await setup(r.fetch, { retry: { maxRetries: 1 } }).request(shop);

    expect(data).toEqual({ ok: true });
    expect(r.bearers()).toEqual(['Bearer T1', 'Bearer T2', 'Bearer T2']);
  });

  it('401 concurrentes con el mismo token comparten un solo refresco', async () => {
    const r = router([token(1), token(2)], [unauthorized(), unauthorized(), json(200, {}), json(200, {})]);
    const transport = setup(r.fetch);
    await Promise.all([transport.request(shop), transport.request(shop)]);

    expect(r.tokenCalls()).toBe(2);
    expect(r.bearers()).toEqual(['Bearer T1', 'Bearer T1', 'Bearer T2', 'Bearer T2']);
  });

  it('loguea el reintento y el refresco reactivo sin el token', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = router([token(1), token(2)], [unauthorized(), json(200, {})]);
    await setup(r.fetch, { logger }).request(shop);

    expect(logger.warn).toHaveBeenCalledWith('sabre.request.retry', expect.objectContaining({ reason: 'unauthorized', attempt: 1 }));
    const refreshes = logger.info.mock.calls.filter(([event]) => event === 'sabre.auth.token.refresh').map(([, c]) => c?.reason);
    expect(refreshes).toEqual(['initial', 'reactive']);
    const dump = JSON.stringify([logger.debug.mock.calls, logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(dump).not.toMatch(/T1|T2|Bearer/);
  });
});
