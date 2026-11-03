import { domain as defaultDomain } from '../config';
import { SabreAuthenticationError } from '../errors/sabre-authentication-error';
import { createOAuthV3 } from './oauth-v3';

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

const credentials = {
  username: '773400',
  password: 'secret',
  pcc: '7TZA',
  clientId: 'id',
  clientSecret: 'client-secret',
};

describe('createOAuthV3', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends the password grant body and a single-base64 Basic header', async () => {
    const fetchMock = jest.fn().mockResolvedValue(tokenResponse());
    globalThis.fetch = fetchMock;

    const provider = createOAuthV3({ credentials });
    const token = await provider.getToken();

    expect(token).toBe('TOKEN');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.platform.sabre.com/v3/auth/token');

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa('id:client-secret')}`);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('username')).toBe(`773400-7TZA-${defaultDomain}`);
    expect(body.get('password')).toBe('secret');
  });

  it('caches the token and refreshes on expiry', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: 'OLD', expires_in: 1 }))
      .mockResolvedValueOnce(tokenResponse({ access_token: 'NEW', expires_in: 604800 }));
    globalThis.fetch = fetchMock;

    const provider = createOAuthV3({ credentials, expirySkewMs: 0 });
    expect(await provider.getToken()).toBe('OLD');
    expect(await provider.getToken()).toBe('OLD');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(await provider.getToken()).toBe('NEW');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('maps a non-2xx token endpoint response to SabreAuthenticationError', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_client' }), {
        status: 401,
        statusText: 'Unauthorized',
      }),
    );

    const provider = createOAuthV3({ credentials });
    await expect(provider.getToken()).rejects.toBeInstanceOf(SabreAuthenticationError);
  });
});
