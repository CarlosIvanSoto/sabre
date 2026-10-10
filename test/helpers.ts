import { vi } from 'vitest';
import type { SabreConfig } from '../src/config.js';

export const credentials = {
  clientId: 'V1:client:DEVCENTER:EXT',
  clientSecret: 'client-secret',
  username: 'epr-user',
  password: 'epr-pass',
};

export function config(overrides: Partial<SabreConfig> = {}): SabreConfig {
  return { credentials, environment: 'sandbox', ...overrides };
}

export function json(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** `fetch` mockeado que devuelve las respuestas en orden. */
export function mockFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn<typeof fetch>();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  return fn;
}
