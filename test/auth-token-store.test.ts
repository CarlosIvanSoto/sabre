import { describe, expect, it, vi } from 'vitest';
import { AuthManager } from '../src/auth/auth-manager.js';
import { tokenStoreKey } from '../src/auth/token-store.js';
import { resolveConfig, type SabreConfig } from '../src/config.js';
import { RestTransport } from '../src/http/rest-transport.js';
import { type SabreTokenStore, type StoredToken, Sabre } from '../src/index.js';
import { config, credentials, json, mockFetch } from './helpers.js';

const HOUR = 3_600_000;
const WEEK_S = 604800;
const WEEK = WEEK_S * 1000;

function token(n: number) {
  return json(200, { access_token: `T${n}`, expires_in: WEEK_S, token_type: 'bearer' });
}

/** Store en memoria, como lo implementaría un consumidor. */
function memoryStore(initial: Record<string, StoredToken> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: StoredToken) => {
      data.set(key, value);
    }),
  } satisfies SabreTokenStore & { data: Map<string, StoredToken> };
}

function setup(fetch: typeof globalThis.fetch, extra: Partial<SabreConfig> = {}) {
  const clock = { now: 0 };
  const resolved = resolveConfig(config({ fetch, retry: { maxRetries: 0 }, ...extra } as SabreConfig));
  const auth = new AuthManager(resolved, new RestTransport(resolved), { now: () => clock.now });
  return { auth, clock, resolved };
}

const key = () => tokenStoreKey('sandbox', 'v3', credentials);

describe('tokenStoreKey', () => {
  it('separa entorno, versión de OAuth y credencial, sin secretos', async () => {
    const k = await key();
    expect(k).toMatch(/^sabre-client:sandbox:v3:[0-9a-f]{32}$/);
    for (const secret of [credentials.username, credentials.password, credentials.clientSecret, credentials.clientId]) {
      expect(k).not.toContain(secret);
    }
    expect(await tokenStoreKey('production', 'v3', credentials)).not.toBe(k);
    expect(await tokenStoreKey('sandbox', 'v2', credentials)).not.toBe(k);
    expect(await tokenStoreKey('sandbox', 'v3', { ...credentials, username: 'otro' })).not.toBe(k);
    expect(await tokenStoreKey('sandbox', 'v3', { ...credentials, clientId: 'otra-app' })).not.toBe(k);
    expect(await tokenStoreKey('sandbox', 'v3', { ...credentials, password: 'cambiada' })).toBe(k);
  });
});

describe('AuthManager con tokenStore', () => {
  it('sin token en el store pide uno y lo guarda con tiempos absolutos', async () => {
    const store = memoryStore();
    const fetch = mockFetch(token(1));
    const { auth, clock } = setup(fetch, { tokenStore: store });
    clock.now = 5_000;

    expect(await auth.getToken()).toBe('T1');
    expect(store.set).toHaveBeenCalledWith(await key(), { accessToken: 'T1', obtainedAt: 5_000, expiresAt: 5_000 + WEEK });
  });

  it('un token vigente del store se reutiliza sin llamar a OAuth Token Create', async () => {
    const store = memoryStore({ [await key()]: { accessToken: 'GUARDADO', obtainedAt: 0, expiresAt: WEEK } });
    const fetch = mockFetch();
    const { auth, clock } = setup(fetch, { tokenStore: store });
    clock.now = 2 * HOUR;

    expect(await auth.getToken()).toBe('GUARDADO');
    expect(await auth.getToken()).toBe('GUARDADO');
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get).toHaveBeenCalledOnce();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('un token del store que cruzó el umbral de refresco se reemplaza', async () => {
    const store = memoryStore({ [await key()]: { accessToken: 'VIEJO', obtainedAt: 0, expiresAt: WEEK } });
    const fetch = mockFetch(token(2));
    const { auth, clock } = setup(fetch, { tokenStore: store });
    clock.now = WEEK - HOUR;

    expect(await auth.getToken()).toBe('T2');
    expect(store.data.get(await key())?.accessToken).toBe('T2');
  });

  it('el refresco proactivo adopta el token que otro proceso dejó en el store', async () => {
    const store = memoryStore();
    const fetch = mockFetch(token(1));
    const { auth, clock } = setup(fetch, { tokenStore: store });
    await auth.getToken();

    // Otro proceso renovó el token.
    store.data.set(await key(), { accessToken: 'DE_OTRO', obtainedAt: WEEK - 2 * HOUR, expiresAt: 2 * WEEK });
    clock.now = WEEK - HOUR;
    expect(await auth.getToken()).toBe('DE_OTRO');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('un valor del store sin la forma de StoredToken se ignora', async () => {
    const store = memoryStore();
    store.get.mockResolvedValueOnce({ access_token: 'X', expires_in: 3 } as unknown as StoredToken);
    const fetch = mockFetch(token(1));
    const { auth } = setup(fetch, { tokenStore: store });

    expect(await auth.getToken()).toBe('T1');
  });

  it('el 401 reactivo no vuelve a usar el token rechazado y escribe el nuevo en el store', async () => {
    const k = await key();
    const store = memoryStore({ [k]: { accessToken: 'RECHAZADO', obtainedAt: 0, expiresAt: WEEK } });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input).includes('/auth/token')) return token(2);
      const auth = (init?.headers as Headers).get('Authorization');
      return auth === 'Bearer RECHAZADO' ? json(401, { errorCode: 'ERR.2SG.SEC.INVALID_CREDENTIALS' }) : json(200, {});
    });
    const sabre = new Sabre(config({ fetch, tokenStore: store }));

    await sabre.air.bargainFinderMax({ OTA_AirLowFareSearchRQ: {} } as never).catch(() => undefined);

    const tokenCalls = fetch.mock.calls.filter(([u]) => String(u).includes('/auth/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(store.data.get(k)?.accessToken).toBe('T2');
  });

  it('si get o set lanzan, la llamada sigue con el caché en memoria y lo avisa sin el mensaje', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store: SabreTokenStore = {
      get: async () => {
        throw new Error('disco lleno T1');
      },
      set: async () => {
        throw new TypeError('sin permisos');
      },
    };
    const fetch = mockFetch(token(1));
    const { auth } = setup(fetch, { tokenStore: store, logger });

    expect(await auth.getToken()).toBe('T1');
    expect(await auth.getToken()).toBe('T1');
    expect(fetch).toHaveBeenCalledOnce();

    const warnings = logger.warn.mock.calls.filter(([event]) => event === 'sabre.auth.token.store').map(([, c]) => c);
    expect(warnings).toEqual([
      { authVersion: 'v3', operation: 'get', errorName: 'Error' },
      { authVersion: 'v3', operation: 'set', errorName: 'TypeError' },
    ]);
    const dump = JSON.stringify([logger.debug.mock.calls, logger.info.mock.calls, logger.warn.mock.calls]);
    expect(dump).not.toContain('T1');
  });

  it('dos clientes con distinta credencial y el mismo store no comparten token', async () => {
    const store = memoryStore();
    const a = setup(mockFetch(token(1)), { tokenStore: store });
    const b = setup(mockFetch(token(2)), {
      tokenStore: store,
      credentials: { ...credentials, username: 'otro-epr' },
    });

    expect(await a.auth.getToken()).toBe('T1');
    expect(await b.auth.getToken()).toBe('T2');
    expect(store.data.size).toBe(2);
  });

  it('N llamadas concurrentes leen el store y piden token una sola vez', async () => {
    const store = memoryStore();
    const fetch = mockFetch(token(1));
    const { auth } = setup(fetch, { tokenStore: store });

    const tokens = await Promise.all(Array.from({ length: 5 }, () => auth.getToken()));
    expect(tokens).toEqual(Array(5).fill('T1'));
    expect(fetch).toHaveBeenCalledOnce();
    expect(store.get).toHaveBeenCalledOnce();
    expect(store.set).toHaveBeenCalledOnce();
  });

  it('la config rechaza un tokenStore sin get/set', () => {
    expect(() => resolveConfig(config({ tokenStore: { get: async () => undefined } as never }))).toThrow(
      'tokenStore debe ser un objeto con get(key) y set(key, token)',
    );
  });
});
