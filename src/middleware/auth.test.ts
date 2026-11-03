import type { TokenProvider } from '../auth/types';
import type { SabreRequest, SabreResponse } from '../http/types';
import { createAuthMiddleware, createBearerAuthMiddleware } from './auth';

const dummyResponse: SabreResponse = { status: 200, statusText: 'OK', headers: {}, body: '' };
const unauthorizedResponse: SabreResponse = {
  status: 401,
  statusText: 'Unauthorized',
  headers: {},
  body: '',
};

describe('createBearerAuthMiddleware', () => {
  it('adds a Bearer Authorization header from the getter', async () => {
    const mw = createBearerAuthMiddleware(() => 'abc123');
    const req: SabreRequest = { method: 'POST', url: 'https://example.test', headers: {} };

    await mw(req, () => Promise.resolve(dummyResponse));

    expect(req.headers.Authorization).toBe('Bearer abc123');
  });

  it('does not set Authorization when there is no token', async () => {
    const mw = createBearerAuthMiddleware(() => null);
    const req: SabreRequest = { method: 'POST', url: 'https://example.test', headers: {} };

    await mw(req, () => Promise.resolve(dummyResponse));

    expect(req.headers.Authorization).toBeUndefined();
  });

  it('does not overwrite an Authorization header already set (e.g. Basic auth)', async () => {
    const mw = createBearerAuthMiddleware(() => 'abc123');
    const req: SabreRequest = {
      method: 'POST',
      url: 'https://example.test',
      headers: { Authorization: 'Basic xyz' },
    };

    await mw(req, () => Promise.resolve(dummyResponse));

    expect(req.headers.Authorization).toBe('Basic xyz');
  });
});

function fakeProvider(tokens: string[]): TokenProvider & { invalidateCalls: number } {
  let i = 0;
  const provider = {
    invalidateCalls: 0,
    getToken(): Promise<string> {
      const token = tokens[Math.min(i, tokens.length - 1)];
      i += 1;
      return Promise.resolve(token);
    },
    invalidate(): Promise<void> {
      provider.invalidateCalls += 1;
      return Promise.resolve();
    },
  };
  return provider;
}

describe('createAuthMiddleware', () => {
  it('adds a Bearer Authorization header from the provider', async () => {
    const provider = fakeProvider(['tok-1']);
    const mw = createAuthMiddleware(provider);
    const req: SabreRequest = { method: 'POST', url: 'https://example.test', headers: {} };

    await mw(req, () => Promise.resolve(dummyResponse));

    expect(req.headers.Authorization).toBe('Bearer tok-1');
  });

  it('does not overwrite an Authorization header already set (e.g. Basic auth)', async () => {
    const provider = fakeProvider(['tok-1']);
    const mw = createAuthMiddleware(provider);
    const req: SabreRequest = {
      method: 'POST',
      url: 'https://example.test',
      headers: { Authorization: 'Basic xyz' },
    };

    await mw(req, () => Promise.resolve(dummyResponse));

    expect(req.headers.Authorization).toBe('Basic xyz');
  });

  it('invalidates and retries once on a 401, then returns the retry response', async () => {
    const provider = fakeProvider(['stale-token', 'fresh-token']);
    const mw = createAuthMiddleware(provider);
    const req: SabreRequest = { method: 'POST', url: 'https://example.test', headers: {} };

    const seenAuthHeaders: string[] = [];
    const next = (r: SabreRequest): Promise<SabreResponse> => {
      seenAuthHeaders.push(r.headers.Authorization ?? '');
      return Promise.resolve(seenAuthHeaders.length === 1 ? unauthorizedResponse : dummyResponse);
    };

    const res = await mw(req, next);

    expect(seenAuthHeaders).toEqual(['Bearer stale-token', 'Bearer fresh-token']);
    expect(provider.invalidateCalls).toBe(1);
    expect(res).toBe(dummyResponse);
  });

  it('passes through a second 401 for the error-mapping middleware to translate', async () => {
    const provider = fakeProvider(['tok-1', 'tok-2']);
    const mw = createAuthMiddleware(provider);
    const req: SabreRequest = { method: 'POST', url: 'https://example.test', headers: {} };

    const res = await mw(req, () => Promise.resolve(unauthorizedResponse));

    expect(res.status).toBe(401);
    expect(provider.invalidateCalls).toBe(1);
  });
});
