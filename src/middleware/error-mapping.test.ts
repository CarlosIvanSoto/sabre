import { SabreApiResponseError } from '../errors/sabre-api-response-error';
import { SabreAuthenticationError } from '../errors/sabre-authentication-error';
import type { SabreRequest, SabreResponse } from '../http/types';
import { createErrorMappingMiddleware } from './error-mapping';

const req: SabreRequest = { method: 'POST', url: 'https://example.test/x', headers: {} };

const next = (res: SabreResponse) => (): Promise<SabreResponse> => Promise.resolve(res);

describe('createErrorMappingMiddleware', () => {
  it('passes through 2xx responses untouched', async () => {
    const mw = createErrorMappingMiddleware();
    const res: SabreResponse = { status: 200, statusText: 'OK', headers: {}, body: '{"ok":true}' };

    await expect(mw(req, next(res))).resolves.toBe(res);
  });

  it('maps 401 to SabreAuthenticationError with the parsed body', async () => {
    const mw = createErrorMappingMiddleware();
    const res: SabreResponse = {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'x-trace': 'abc' },
      body: '{"error":"invalid_client"}',
    };

    const err = await mw(req, next(res)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SabreAuthenticationError);
    const authErr = err as SabreAuthenticationError;
    expect(authErr.statusCode).toBe(401);
    expect(authErr.responseBody).toEqual({ error: 'invalid_client' });
    expect(authErr.responseHeaders).toEqual({ 'x-trace': 'abc' });
  });

  it('maps 403 to SabreAuthenticationError', async () => {
    const mw = createErrorMappingMiddleware();
    const res: SabreResponse = { status: 403, statusText: 'Forbidden', headers: {}, body: '' };

    await expect(mw(req, next(res))).rejects.toBeInstanceOf(SabreAuthenticationError);
  });

  it('maps other non-2xx responses to SabreApiResponseError', async () => {
    const mw = createErrorMappingMiddleware();
    const res: SabreResponse = {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      body: '{"message":"boom"}',
    };

    const err = await mw(req, next(res)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SabreApiResponseError);
    const apiErr = err as SabreApiResponseError;
    expect(apiErr.statusCode).toBe(500);
    expect(apiErr.details).toBe('{"message":"boom"}');
    expect(apiErr.responseBody).toEqual({ message: 'boom' });
  });

  it('falls back to statusText as details when the body is not JSON', async () => {
    const mw = createErrorMappingMiddleware();
    const res: SabreResponse = {
      status: 502,
      statusText: 'Bad Gateway',
      headers: {},
      body: 'not json',
    };

    const err = await mw(req, next(res)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SabreApiResponseError);
    expect((err as SabreApiResponseError).details).toBe('Bad Gateway');
  });
});
