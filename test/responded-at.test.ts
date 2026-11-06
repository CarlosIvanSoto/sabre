// `respondedAt`: el `eb:Timestamp` de la respuesta SOAP, en UTC (#157, ADR-027 C1).
import { describe, expect, it } from 'vitest';
import { respondedAtOf } from '../src/http/soap-transport.js';
import walk from './fixtures/queue.production-walk.json';
import { mockFetch } from './helpers.js';
import { legacyClient, xml } from './soap-helpers.js';

const recorded = (operation: string) => {
  const response = walk.responses.find((r) => r.operation === operation)!;
  return xml(response.status, response.body);
};

describe('respondedAt con un sobre real de producción', () => {
  it('count y list lo traen en UTC, con Z, a partir del eb:Timestamp sin zona', async () => {
    const fetch = mockFetch(recorded('openSession'), recorded('queue.count'), recorded('queue.list'));
    const session = await legacyClient(fetch).client.openSession();

    const count = await session.queue.count();
    expect(count.respondedAt).toBe('2026-11-02T02:55:52Z');
    // `countedAt` sigue como lo da el host: sin año y en hora local del PCC.
    expect(count.countedAt).not.toBe(count.respondedAt);
    expect((await session.queue.list({ queue: 2 })).respondedAt).toBe('2026-11-02T02:55:52Z');
  });
});

describe('respondedAtOf', () => {
  const envelope = (header: string, body = '<X/>') =>
    `<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/"><soap-env:Header>${header}</soap-env:Header><soap-env:Body>${body}</soap-env:Body></soap-env:Envelope>`;
  const header = (timestamp: string) =>
    `<eb:MessageHeader xmlns:eb="http://www.ebxml.org/namespaces/messageHeader"><eb:MessageData><eb:Timestamp>${timestamp}</eb:Timestamp></eb:MessageData></eb:MessageHeader>`;

  it.each([
    ['sin zona → Z', '2026-11-06T17:34:16', '2026-11-06T17:34:16Z'],
    ['sin segundos', '2026-11-06T17:34', '2026-11-06T17:34Z'],
    ['con fracción', '2026-11-06T17:34:16.123', '2026-11-06T17:34:16.123Z'],
    ['con Z, tal cual', '2026-11-06T17:34:16Z', '2026-11-06T17:34:16Z'],
    ['con offset, tal cual', '2026-11-06T11:34:16-06:00', '2026-11-06T11:34:16-06:00'],
  ])('%s', (_, timestamp, expected) => {
    expect(respondedAtOf(envelope(header(timestamp)))).toBe(expected);
  });

  it.each([
    ['vacío', envelope(header(''))],
    ['sin año, como las fechas del host', envelope(header('11-06T17:34'))],
    ['sin eb:Timestamp', envelope('')],
    ['solo un Timestamp en el Body', envelope('', '<Timestamp>2026-11-06T17:34:16</Timestamp>')],
    ['no es un string', undefined],
  ])('%s → undefined', (_, raw) => {
    expect(respondedAtOf(raw)).toBeUndefined();
  });
});
