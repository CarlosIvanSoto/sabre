import { domain as defaultDomain } from '../config';
import { SabreAuthenticationError } from '../errors/sabre-authentication-error';
import { createOAuthV2 } from './oauth-v2';

const tokenResponse = (
  overrides: Partial<{ access_token: string; expires_in: number }> = {},
): Response =>
  new Response(
    JSON.stringify({
      access_token: 'TOKEN',
      token_type: 'bearer',
      expires_in: 604800,
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('createOAuthV2', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('encodes EPR (user) credentials and caches the token', async () => {
    const fetchMock = jest.fn().mockResolvedValue(tokenResponse());
    globalThis.fetch = fetchMock;

    const provider = createOAuthV2({
      credentials: { type: 'user', username: '773400', password: 'secret', pcc: '7TZA' },
    });
    const token = await provider.getToken();

    expect(token).toBe('TOKEN');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.platform.sabre.com/v2/auth/token');
    const headers = init.headers as Record<string, string>;
    const expectedUserId = btoa(`V1:773400:7TZA:${defaultDomain}`);
    const expected = btoa(`${expectedUserId}:${btoa('secret')}`);
    expect(headers.Authorization).toBe(`Basic ${expected}`);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.body).toBe('grant_type=client_credentials');

    const token2 = await provider.getToken();
    expect(token2).toBe('TOKEN');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('encodes client (clientId/clientSecret) credentials with double base64', async () => {
    const fetchMock = jest.fn().mockResolvedValue(tokenResponse());
    globalThis.fetch = fetchMock;

    const provider = createOAuthV2({
      credentials: { type: 'client', clientId: 'id', clientSecret: 'secret' },
    });
    await provider.getToken();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expected = btoa(`${btoa('id')}:${btoa('secret')}`);
    expect(headers.Authorization).toBe(`Basic ${expected}`);
  });

  it('refreshes when the cached token is past expiry', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: 'OLD', expires_in: 1 }))
      .mockResolvedValueOnce(tokenResponse({ access_token: 'NEW', expires_in: 604800 }));
    globalThis.fetch = fetchMock;

    const provider = createOAuthV2({
      credentials: { type: 'client', clientId: 'id', clientSecret: 'secret' },
      expirySkewMs: 0,
    });
    const t1 = await provider.getToken();
    expect(t1).toBe('OLD');

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const t2 = await provider.getToken();
    expect(t2).toBe('NEW');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('serializes concurrent getToken() calls into a single fetch', async () => {
    let resolveFetch!: (res: Response) => void;
    const fetchMock = jest.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    globalThis.fetch = fetchMock;

    const provider = createOAuthV2({
      credentials: { type: 'client', clientId: 'id', clientSecret: 'secret' },
    });

    const calls = Promise.all([provider.getToken(), provider.getToken(), provider.getToken()]);
    resolveFetch(tokenResponse());
    const tokens = await calls;

    expect(tokens).toEqual(['TOKEN', 'TOKEN', 'TOKEN']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('invalidate() forces the next getToken() to refetch', async () => {
    // mockImplementation (not mockResolvedValue) so each call gets a fresh
    // Response — a single Response's body can only be read once.
    const fetchMock = jest.fn().mockImplementation(() => Promise.resolve(tokenResponse()));
    globalThis.fetch = fetchMock;

    const provider = createOAuthV2({
      credentials: { type: 'client', clientId: 'id', clientSecret: 'secret' },
    });
    await provider.getToken();
    await provider.invalidate();
    await provider.getToken();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps a non-2xx token endpoint response to SabreAuthenticationError', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_client', error_description: 'bad creds' }), {
        status: 401,
        statusText: 'Unauthorized',
      }),
    );

    const provider = createOAuthV2({
      credentials: { type: 'client', clientId: 'id', clientSecret: 'wrong' },
    });

    await expect(provider.getToken()).rejects.toBeInstanceOf(SabreAuthenticationError);
  });

  it('maps a fetch failure to SabreAuthenticationError with the network cause preserved', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

    const provider = createOAuthV2({
      credentials: { type: 'client', clientId: 'id', clientSecret: 'secret' },
    });

    const err = await provider.getToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SabreAuthenticationError);
    expect((err as SabreAuthenticationError).cause).toBeInstanceOf(Error);
  });
});
