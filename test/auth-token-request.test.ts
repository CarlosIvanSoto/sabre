import { describe, expect, it } from 'vitest';
import { AuthManager } from '../src/auth/auth-manager.js';
import { base64, buildTokenRequest } from '../src/auth/token-request.js';
import { resolveConfig, type SabreConfig } from '../src/config.js';
import { SabreGatewayError } from '../src/errors/index.js';
import { RestTransport } from '../src/http/rest-transport.js';
import { config, credentials, json, mockFetch } from './helpers.js';

const v2: Partial<SabreConfig> = {
  authVersion: 'v2',
  credentials: { username: 'V1:epr-user:PCC1:AA', password: 'epr-pass' },
};

const token = { access_token: 'T1RLAQ-token', expires_in: 604800, token_type: 'bearer' };

function manager(fetch: typeof globalThis.fetch, extra: Partial<SabreConfig> = {}) {
  const resolved = resolveConfig(config({ fetch, retry: { maxRetries: 0 }, ...extra } as SabreConfig));
  return new AuthManager(resolved, new RestTransport(resolved), { now: () => 1_000 });
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

describe('base64', () => {
  it('codifica los bytes UTF-8, no los code units', () => {
    expect(base64('contraseña')).toBe('Y29udHJhc2XDsWE=');
  });
});

describe('buildTokenRequest', () => {
  it('v3: Basic base64(clientId:clientSecret) y EPR en el body con grant_type=password', () => {
    const request = buildTokenRequest('v3', credentials);
    expect(request.path).toBe('/v3/auth/token');
    expect(request.authorization).toBe('Basic VjE6Y2xpZW50OkRFVkNFTlRFUjpFWFQ6Y2xpZW50LXNlY3JldA==');
    expect(request.body.toString()).toBe('grant_type=password&username=epr-user&password=epr-pass');
  });

  it('v3: escapa el body como form-urlencoded', () => {
    const request = buildTokenRequest('v3', { ...credentials, password: 'a&b=c d' });
    expect(request.body.toString()).toBe('grant_type=password&username=epr-user&password=a%26b%3Dc+d');
  });

  it('v2: doble Base64 sobre EPR:password y grant_type=client_credentials', () => {
    const request = buildTokenRequest('v2', { clientId: 'ignorado', clientSecret: 'ignorado', username: 'V1:epr-user:PCC1:AA', password: 'epr-pass' });
    expect(request.path).toBe('/v2/auth/token');
    expect(request.authorization).toBe('Basic VmpFNlpYQnlMWFZ6WlhJNlVFTkRNVHBCUVE9PTpaWEJ5TFhCaGMzTT0=');
    expect(request.body.toString()).toBe('grant_type=client_credentials');
  });
});

describe('AuthManager.fetchToken', () => {
  it('v3: POST form-urlencoded a /v3/auth/token y devuelve el token', async () => {
    const fetch = mockFetch(json(200, token));
    const result = await manager(fetch).fetchToken();

    expect(result).toEqual({ accessToken: 'T1RLAQ-token', expiresIn: 604800, obtainedAt: 1_000 });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.cert.platform.sabre.com/v3/auth/token');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('grant_type=password&username=epr-user&password=epr-pass');
    const headers = init?.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(headers.get('Authorization')).toBe('Basic VjE6Y2xpZW50OkRFVkNFTlRFUjpFWFQ6Y2xpZW50LXNlY3JldA==');
  });

  it('v2: POST a /v2/auth/token con grant_type=client_credentials', async () => {
    const fetch = mockFetch(json(200, token));
    await manager(fetch, v2).fetchToken();

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.cert.platform.sabre.com/v2/auth/token');
    expect(init?.body).toBe('grant_type=client_credentials');
    expect((init?.headers as Headers).get('Authorization')).toBe(
      'Basic VmpFNlpYQnlMWFZ6WlhJNlVFTkRNVHBCUVE9PTpaWEJ5TFhCaGMzTT0=',
    );
  });

  it('no usa el proveedor de Authorization del transporte (Bearer)', async () => {
    const fetch = mockFetch(json(200, token));
    const resolved = resolveConfig(config({ fetch }));
    const transport = new RestTransport(resolved, { authorization: { get: async () => 'Bearer viejo', invalidate: () => {} } });
    await new AuthManager(resolved, transport).fetchToken();
    expect((fetch.mock.calls[0]![1]?.headers as Headers).get('Authorization')).toMatch(/^Basic /);
  });

  describe('catálogo de errores (igual en v2 y v3)', () => {
    it.each([
      [401, 'invalid_request'],
      [401, 'invalid_client'],
      [403, 'unauthorized'],
    ])('HTTP %i %s → SabreGatewayError no reintentable', async (status, code) => {
      for (const extra of [{}, v2]) {
        const body = { error: code, error_description: 'detalle' };
        const fetch = mockFetch(json(status, body));
        // Con la política de reintentos por defecto: no debe reintentar.
        const resolved = resolveConfig(config({ fetch, ...extra } as SabreConfig));
        const error = await catchError(new AuthManager(resolved, new RestTransport(resolved)).fetchToken());

        expect(error).toBeInstanceOf(SabreGatewayError);
        const gateway = error as SabreGatewayError;
        expect(gateway.status).toBe(status);
        expect(gateway.code).toBe(code);
        expect(gateway.retryable).toBe(false);
        expect(gateway.raw).toEqual(body);
        expect(gateway.message).toContain('oauthTokenCreate');
        expect(fetch).toHaveBeenCalledOnce();
      }
    });

    it('respuesta 200 sin access_token → SabreGatewayError no reintentable', async () => {
      for (const body of [{}, { access_token: 'x' }, { access_token: '', expires_in: 10 }, { access_token: 'x', expires_in: 0 }, undefined]) {
        const error = await catchError(manager(mockFetch(json(200, body))).fetchToken());
        expect(error).toBeInstanceOf(SabreGatewayError);
        expect((error as SabreGatewayError).retryable).toBe(false);
      }
    });
  });

  it('no manda credenciales al logger', async () => {
    const entries: unknown[] = [];
    const log = (message: string, context?: Record<string, unknown>) => entries.push({ message, context });
    const logger = { debug: log, info: log, warn: log, error: log };
    await catchError(manager(mockFetch(json(401, { error: 'invalid_client' })), { logger }).fetchToken());
    await manager(mockFetch(json(200, token)), { logger }).fetchToken();

    const dump = JSON.stringify(entries);
    expect(entries.length).toBeGreaterThan(0);
    for (const secret of ['client-secret', 'epr-pass', 'T1RLAQ-token', 'Basic ', 'VjE6']) {
      expect(dump).not.toContain(secret);
    }
  });
});
