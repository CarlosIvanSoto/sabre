import { SabreNetworkError } from '../errors/sabre-network-error';
import { SabreTimeoutError } from '../errors/sabre-timeout-error';
import { buildChain } from './chain';
import type { Middleware, SabreRequest } from './types';

const baseRequest = (): SabreRequest => ({
  method: 'GET',
  url: 'https://example.test/v1/thing',
  headers: {},
});

describe('buildChain', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('runs through fetch when there are no middlewares', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const run = buildChain([]);
    const res = await run(baseRequest());

    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
    expect(res.headers['content-type']).toBe('application/json');
  });

  it('runs middlewares outermost-first and unwinds in reverse', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(new Response('hi', { status: 200 }));

    const order: string[] = [];
    const a: Middleware = async (req, next) => {
      order.push('a-in');
      const res = await next(req);
      order.push('a-out');
      return res;
    };
    const b: Middleware = async (req, next) => {
      order.push('b-in');
      const res = await next(req);
      order.push('b-out');
      return res;
    };

    const run = buildChain([a, b]);
    await run(baseRequest());

    expect(order).toEqual(['a-in', 'b-in', 'b-out', 'a-out']);
  });

  it('lets a middleware mutate the request before fetch sees it', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('', { status: 200 }));
    globalThis.fetch = fetchMock;

    const addAuth: Middleware = (req, next) => {
      req.headers.Authorization = 'Bearer xyz';
      return next(req);
    };

    const run = buildChain([addAuth]);
    await run(baseRequest());

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((callArgs[1].headers as Record<string, string>).Authorization).toBe('Bearer xyz');
  });

  it('lets a middleware short-circuit without calling next', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;

    const cached: Middleware = () =>
      Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: 'cached',
      });

    const run = buildChain([cached]);
    const res = await run(baseRequest());

    expect(res.body).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('translates fetch network failures into SabreNetworkError', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'));

    const run = buildChain([]);
    await expect(run(baseRequest())).rejects.toBeInstanceOf(SabreNetworkError);
  });

  it('translates aborts into SabreTimeoutError', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    globalThis.fetch = jest.fn().mockRejectedValue(abortErr);

    const run = buildChain([]);
    await expect(run(baseRequest())).rejects.toBeInstanceOf(SabreTimeoutError);
  });
});
