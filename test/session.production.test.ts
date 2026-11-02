// La sesión SOAP contra las respuestas grabadas en producción (#95, 2026-11-02), con `fetch`
// mockeado. Ver scripts/validate-session.mjs. Las fixtures vienen redactadas: el PCC y el usuario
// como `XXXX`, y el `BinarySecurityToken` como `[REDACTED]`.
import { describe, expect, it, vi } from 'vitest';
import { SabreLegacy, type SabreRawResponse } from '../src/index.js';
import expire16 from './fixtures/session.production-expire-16min.json';
import expire16b from './fixtures/session.production-expire-16min-2.json';
import v2 from './fixtures/session.production-v2.json';
import v3 from './fixtures/session.production-v3.json';
import { mockFetch } from './helpers.js';
import { memoryLogger, sentBody, sentTag, xml } from './soap-helpers.js';

interface Fixture {
  scenario: string;
  responses: Array<{ operation: string; status: number; body: string }>;
}

const credentials = {
  v3: { username: '7971-H8GI-AA', password: 'epr-pass', clientId: 'app-client-id', clientSecret: 'app-client-secret' },
  v2: { username: 'V1:7971:H8GI:AA', password: 'epr-pass' },
} as const;

function replay(fixture: Fixture, authVersion: 'v2' | 'v3') {
  const fetch = mockFetch(...fixture.responses.map((response) => xml(response.status, response.body)));
  const { logger, calls } = memoryLogger();
  const common = { environment: 'production', fetch, logger, retry: { maxRetries: 0 } } as const;
  const client = new SabreLegacy(
    authVersion === 'v3'
      ? { ...common, authVersion, credentials: credentials.v3 }
      : { ...common, authVersion, credentials: credentials.v2 },
  );
  return { client, fetch, calls };
}

async function openPingClose(fixture: Fixture, authVersion: 'v2' | 'v3') {
  const { client, fetch, calls } = replay(fixture, authVersion);
  const raws: SabreRawResponse[] = [];
  const onRawResponse = vi.fn((raw: SabreRawResponse) => raws.push(raw));
  const session = await client.openSession({ onRawResponse });
  await session.ping({ onRawResponse });
  await session.close({ onRawResponse });
  return { fetch, calls, raws };
}

describe.each([
  { name: 'SessionCreateRQ 2.0.0 (OAuth v3)', fixture: v3, authVersion: 'v3', version: '2.0.0' },
  { name: 'SessionCreateRQ 1.0.0 (OAuth v2, sin clientId)', fixture: v2, authVersion: 'v2', version: '1.0.0' },
] as const)('sesión real en producción: $name', ({ fixture, authVersion, version }) => {
  it('abre, hace ping y cierra con las respuestas grabadas', async () => {
    const { fetch, calls } = await openPingClose(fixture, authVersion);
    expect(fetch.mock.calls.map((_, call) => sentTag(sentBody(fetch, call), 'eb:Action'))).toEqual([
      'SessionCreateRQ',
      'OTA_PingRQ',
      'SessionCloseRQ',
    ]);
    expect(calls.find(([, message]) => message === 'sabre.session.open')?.[2]).toMatchObject({ version });
    expect(calls.some(([, message]) => message === 'sabre.session.close')).toBe(true);
  });

  it('grabó el ping con Success, el eco y el token repetido en el header', async () => {
    const { raws } = await openPingClose(fixture, authVersion);
    const ping = raws.find((raw) => raw.operation === 'ping')!;
    expect(ping.body).toContain('<Success/><EchoData>sabre-client</EchoData>');
    // Sabre repite el BinarySecurityToken en las respuestas de operación, y el SDK lo tapa.
    for (const raw of raws) expect(raw.body).toContain('>[REDACTED]</wsse:BinarySecurityToken>');
  });
});

describe('sesión inactiva más de 15 minutos', () => {
  it.each([
    ['primera corrida', expire16],
    ['segunda corrida', expire16b],
  ])('sigue viva después de 16 minutos sin actividad (%s)', async (_, fixture) => {
    const [opened, pinged] = (fixture as Fixture).responses.map((response) => /<eb:Timestamp>([^<]+)</.exec(response.body)![1]!);
    const idleMinutes = (Date.parse(`${pinged}Z`) - Date.parse(`${opened}Z`)) / 60_000;
    expect(idleMinutes).toBeGreaterThanOrEqual(16);

    const { raws } = await openPingClose(fixture as Fixture, 'v3');
    expect(raws.find((raw) => raw.operation === 'ping')!.body).toContain('<Success/>');
  });
});
