import type { TokenProvider } from './auth/types';
import { baseUrl } from './config';
import { SabreApiResponseError } from './errors/sabre-api-response-error';
import { SabreParseError } from './errors/sabre-parse-error';
import { Sabre } from './sabre';

function fakeProvider(token: string): TokenProvider {
  return {
    getToken: () => Promise.resolve(token),
    invalidate: () => Promise.resolve(),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Sabre', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const newSabre = (): Sabre =>
    new Sabre({
      username: '773400',
      password: 'secret-password',
      organization: '7TZA',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

  it('post() sends a Bearer token and JSON content-type once authorized', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ hello: 'world' }));
    globalThis.fetch = fetchMock;

    const sabre = newSabre();
    sabre.setAuthorization('access-token-123');

    const result = await sabre.post<{ hello: string }>('/v5/offers/shop', { foo: 'bar' });

    expect(result).toEqual({ hello: 'world' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${baseUrl}/v5/offers/shop`);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-token-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('auth() sends Basic credentials and form-urlencoded content-type', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ access_token: 'tok' }));
    globalThis.fetch = fetchMock;

    const sabre = newSabre();
    await sabre.auth('/v2/auth/token', sabre.grant_type_v2);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${baseUrl}/v2/auth/token`);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('authClient() throws when clientId/clientSecret were never provided', async () => {
    const sabre = new Sabre({
      username: '773400',
      password: 'secret-password',
      organization: '7TZA',
    });

    await expect(sabre.authClient('/v2/auth/token', sabre.grant_type_v2)).rejects.toThrow(
      'Missing Sabre client id or client secret',
    );
  });

  it('does not leak headers between concurrent auth() and post() calls (regression)', async () => {
    const fetchMock = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
      const headers = { ...(init.headers as Record<string, string>) };
      return Promise.resolve(jsonResponse({ seenAuthorization: headers.Authorization }));
    });
    globalThis.fetch = fetchMock;

    const sabre = newSabre();
    sabre.setAuthorization('bearer-token');

    const [authResult, postResult] = await Promise.all([
      sabre.auth<{ seenAuthorization: string }>('/v2/auth/token', sabre.grant_type_v2),
      sabre.post<{ seenAuthorization: string }>('/v5/offers/shop', {}),
    ]);

    expect(authResult.seenAuthorization).toMatch(/^Basic /);
    expect(postResult.seenAuthorization).toBe('Bearer bearer-token');
  });

  it('propagates a typed error for non-2xx responses', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse({ message: 'boom' }, 500));

    const sabre = newSabre();
    sabre.setAuthorization('access-token-123');

    await expect(sabre.post('/v5/offers/shop', {})).rejects.toBeInstanceOf(SabreApiResponseError);
  });

  it('throws SabreParseError when a 2xx body is not valid JSON', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response('not json', { status: 200 }));

    const sabre = newSabre();
    sabre.setAuthorization('access-token-123');

    await expect(sabre.post('/v5/offers/shop', {})).rejects.toBeInstanceOf(SabreParseError);
  });

  it('authenticates automatically via a TokenProvider passed as options.auth, with no setAuthorization() call', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ hello: 'world' }));
    globalThis.fetch = fetchMock;

    const sabre = new Sabre({
      username: '773400',
      password: 'secret-password',
      organization: '7TZA',
      auth: fakeProvider('provider-token'),
    });

    const result = await sabre.post<{ hello: string }>('/v5/offers/shop', {});

    expect(result).toEqual({ hello: 'world' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer provider-token');
  });

  it('prefers a manually set token over the TokenProvider', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ hello: 'world' }));
    globalThis.fetch = fetchMock;

    const sabre = new Sabre({
      username: '773400',
      password: 'secret-password',
      organization: '7TZA',
      auth: fakeProvider('provider-token'),
    });
    sabre.setAuthorization('manual-token');

    await sabre.post('/v5/offers/shop', {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer manual-token');
  });
});
