import type { SabreRequest, SabreResponse } from '../http/types';
import { createDefaultHeadersMiddleware } from './default-headers';

const dummyResponse: SabreResponse = { status: 200, statusText: 'OK', headers: {}, body: '' };

describe('createDefaultHeadersMiddleware', () => {
  it('adds User-Agent and Conversation-ID when missing', async () => {
    const mw = createDefaultHeadersMiddleware();
    const req: SabreRequest = { method: 'GET', url: 'https://example.test', headers: {} };

    await mw(req, () => Promise.resolve(dummyResponse));

    expect(req.headers['User-Agent']).toBeTruthy();
    expect(req.headers['Conversation-ID']).toBeTruthy();
  });

  it('does not overwrite headers already set on the request', async () => {
    const mw = createDefaultHeadersMiddleware();
    const req: SabreRequest = {
      method: 'GET',
      url: 'https://example.test',
      headers: { 'User-Agent': 'custom-agent', 'Conversation-ID': 'custom-id' },
    };

    await mw(req, () => Promise.resolve(dummyResponse));

    expect(req.headers['User-Agent']).toBe('custom-agent');
    expect(req.headers['Conversation-ID']).toBe('custom-id');
  });
});
