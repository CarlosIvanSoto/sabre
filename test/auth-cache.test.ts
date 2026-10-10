import { describe, expect, it, vi } from 'vitest';
import { AuthManager } from '../src/auth/auth-manager.js';
import { resolveConfig, type SabreConfig } from '../src/config.js';
import { SabreGatewayError } from '../src/errors/index.js';
import { RestTransport } from '../src/http/rest-transport.js';
import { config, json, mockFetch } from './helpers.js';

const HOUR = 3_600_000;
const WEEK_S = 604800;

function token(n: number, expiresIn = WEEK_S) {
  return json(200, { access_token: `T${n}`, expires_in: expiresIn, token_type: 'bearer' });
}

function setup(fetch: typeof globalThis.fetch, extra: Partial<SabreConfig> = {}) {
  const clock = { now: 0 };
  const resolved = resolveConfig(config({ fetch, retry: { maxRetries: 0 }, ...extra } as SabreConfig));
  const auth = new AuthManager(resolved, new RestTransport(resolved), { now: () => clock.now });
  return { auth, clock };
}

describe('AuthManager: caché en memoria', () => {
  it('reutiliza el token entre llamadas', async () => {
    const fetch = mockFetch(token(1));
    const { auth } = setup(fetch);

    expect(await auth.getToken()).toBe('T1');
    expect(await auth.getToken()).toBe('T1');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('N requests concurrentes con caché vacía → 1 sola llamada de token', async () => {
    const fetch = mockFetch(token(1));
    const { auth } = setup(fetch);

    const tokens = await Promise.all(Array.from({ length: 10 }, () => auth.getToken()));
    expect(tokens).toEqual(Array(10).fill('T1'));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('si la petición en vuelo falla, todas las que esperaban reciben el error y la siguiente reintenta', async () => {
    const fetch = mockFetch(json(401, { error: 'invalid_client' }), token(2));
    const { auth } = setup(fetch);

    const results = await Promise.allSettled([auth.getToken(), auth.getToken(), auth.getToken()]);
    expect(results.every((r) => r.status === 'rejected' && r.reason instanceof SabreGatewayError)).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();

    expect(await auth.getToken()).toBe('T2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('AuthManager: refresco proactivo', () => {
  it('no refresca antes del umbral de 1 h y refresca al cruzarlo', async () => {
    const fetch = mockFetch(token(1), token(2));
    const { auth, clock } = setup(fetch);
    await auth.getToken();

    clock.now = WEEK_S * 1000 - HOUR - 1;
    expect(await auth.getToken()).toBe('T1');
    expect(fetch).toHaveBeenCalledOnce();

    clock.now = WEEK_S * 1000 - HOUR;
    expect(await auth.getToken()).toBe('T2');
    expect(fetch).toHaveBeenCalledTimes(2);

    // El nuevo token cuenta su vida desde que se obtuvo.
    clock.now += HOUR;
    expect(await auth.getToken()).toBe('T2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('con tokens de vida corta el umbral es la mitad de expires_in', async () => {
    const fetch = mockFetch(token(1, 1200), token(2, 1200));
    const { auth, clock } = setup(fetch);
    await auth.getToken();

    clock.now = 600_000 - 1;
    expect(await auth.getToken()).toBe('T1');
    clock.now = 600_000;
    expect(await auth.getToken()).toBe('T2');
  });

  it('si el refresco proactivo falla, propaga el error en vez de servir el token viejo', async () => {
    const fetch = mockFetch(token(1), json(403, { error: 'unauthorized' }));
    const { auth, clock } = setup(fetch);
    await auth.getToken();

    clock.now = WEEK_S * 1000 - HOUR;
    await expect(auth.getToken()).rejects.toBeInstanceOf(SabreGatewayError);
  });

  it('emite sabre.auth.token.refresh con el motivo y sin el token', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { auth, clock } = setup(mockFetch(token(1), token(2)), { logger });
    await auth.getToken();
    clock.now = WEEK_S * 1000;
    await auth.getToken();

    const refreshes = logger.info.mock.calls.filter(([event]) => event === 'sabre.auth.token.refresh');
    expect(refreshes.map(([, context]) => context)).toEqual([
      { authVersion: 'v3', reason: 'initial', expiresIn: WEEK_S },
      { authVersion: 'v3', reason: 'proactive', expiresIn: WEEK_S },
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('T1');
  });
});
