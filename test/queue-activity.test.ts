// session.queue.activity (#161, A1 de ADR-027) contra las respuestas grabadas en F0.1 (#154):
// CERT y producción, 2026-11-06, scripts/validate-activity.mjs qa.
import { describe, expect, it, vi } from 'vitest';
import { SabreBusinessError, SabreGatewayError, SabreWarning } from '../src/index.js';
import { queueActivityPayload } from '../src/queue/queue-activity.js';
import cert from './fixtures/activity.sandbox-qa.json';
import production from './fixtures/activity.production-qa.json';
import { mockFetch } from './helpers.js';
import { entry, legacyClient, rejection, SESSION_TOKEN, sentBody, sentTag, sessionOpened, soap, success, xml } from './soap-helpers.js';

const STL = 'xmlns:stl="http://services.sabre.com/STL/v01"';
const NS = 'xmlns="http://webservices.sabre.com/sabreXML/2011/10"';

interface Fixture {
  responses: Array<{ operation: string; status: number; body: string }>;
}

/** La primera respuesta de `QueueAnalysisLLSRQ` de una fixture de F0.1. */
const recorded = (fixture: Fixture) => {
  const response = fixture.responses.find((r) => r.operation === 'probe.queueAnalysis');
  if (response === undefined) throw new Error('la fixture no tiene probe.queueAnalysis');
  return xml(response.status, response.body);
};

const analysisRS = (inner: string) => `<QueueAnalysisRS ${NS} ${STL} Version="2.0.0">${inner}</QueueAnalysisRS>`;
const complete = `<stl:ApplicationResults status="Complete">${success}</stl:ApplicationResults>`;
const zeros = (overrides: Record<string, number> = {}) =>
  ['Ended', 'Ignored', 'LeftMessageToContact', 'Moved', 'NumMessages', 'Removed', 'Transferred', 'UnableToReach']
    .map((name) => `<${name} Count="${overrides[name] ?? 0}"/>`)
    .join('');
const ZERO = { numMessages: 0, ended: 0, ignored: 0, moved: 0, removed: 0, transferred: 0, leftMessageToContact: 0, unableToReach: 0 };

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const session = await legacyClient(fetch).client.openSession();
  return { fetch, session };
}

describe('queue.activity: request', () => {
  it('manda QueueAnalysisRQ 2.0.0 con el PCC de la sesión y su token', async () => {
    const { fetch, session } = await openWith(recorded(cert));
    await session.queue.activity();

    const envelope = sentBody(fetch, 1);
    expect(sentTag(envelope, 'eb:Action')).toBe('QueueAnalysisLLSRQ');
    expect(envelope).toContain(
      '<soap-env:Body><QueueAnalysisRQ Version="2.0.0" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><QueueInfo><QueueIdentifier PseudoCityCode="H8GI"/></QueueInfo></QueueAnalysisRQ></soap-env:Body>',
    );
    expect(envelope).toContain(`>${SESSION_TOKEN}</wsse:BinarySecurityToken>`);
  });

  it('con pcc analiza las colas de ese PCC, escapado', async () => {
    const { fetch, session } = await openWith(recorded(cert));
    await session.queue.activity({ pcc: 'ABC1' });
    expect(sentBody(fetch, 1)).toContain('<QueueIdentifier PseudoCityCode="ABC1"/>');
    expect(queueActivityPayload('A&B')).toContain('PseudoCityCode="A&amp;B"');
  });

  it.each([['AB'], ['ABCDE'], ['AB-C'], [''], [123]])('un pcc inválido (%j) lanza TypeError sin red', async (pcc) => {
    const { fetch, session } = await openWith();
    expect(await rejection(session.queue.activity({ pcc: pcc as string }))).toBeInstanceOf(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('es idempotente: se reintenta ante un fallo de red', async () => {
    const { fetch, session } = await openWith(new TypeError('fetch failed'), recorded(cert));
    const result = await session.queue.activity({}, { retry: { maxRetries: 1, baseDelayMs: 0 } });
    expect(result.queues).toHaveLength(7);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('entrega la respuesta cruda como queue.activity y no cambia state', async () => {
    const onRawResponse = vi.fn();
    const { session } = await openWith(recorded(cert));
    await session.queue.activity({}, { onRawResponse });
    expect(onRawResponse.mock.calls[0]?.[0]).toMatchObject({ operation: 'queue.activity', protocol: 'soap', status: 200 });
    expect(session.queue.state).toBe('outside');
  });
});

describe('queue.activity: respuestas reales', () => {
  it('CERT: las colas en orden, la S como en count, y los totales', async () => {
    const { session } = await openWith(recorded(cert));
    const result = await session.queue.activity();

    expect(result.queues.map((q) => q.queue)).toEqual(['S', 1, 9, 50, 60, 70, 100]);
    expect(result.queues[0]).toEqual({ queue: 'S', ...ZERO, numMessages: 1 });
    expect(result.queues[3]).toEqual({ queue: 50, ...ZERO, numMessages: 5, ignored: 30, removed: 1, transferred: 1 });
    expect(result.totals).toEqual({ ...ZERO, numMessages: 7, ignored: 77, removed: 4, transferred: 9 });
    expect(result.analyzedAt).toBe('11-06T11:33');
    expect(result.respondedAt).toBe('2026-11-06T17:33:59Z');
    expect(result.warnings).toEqual([]);
  });

  it('producción: colas vacías con contadores, como la 300', async () => {
    const { session } = await openWith(recorded(production));
    const result = await session.queue.activity();

    expect(result.queues.map((q) => q.queue)).toEqual(['S', 100, 200, 300, 305]);
    expect(result.queues.find((q) => q.queue === 300)).toEqual({ queue: 300, ...ZERO, ended: 1 });
    expect(result.totals).toEqual({ ...ZERO, numMessages: 6, ended: 5, ignored: 9, transferred: 2 });
  });

  it('el queue de la S pasa a access y viaja en Number="S"', async () => {
    const { fetch, session } = await openWith(recorded(cert), xml(200, soap(analysisRS(complete))));
    const { queues } = await session.queue.activity();
    await rejection(session.queue.access({ queue: queues[0]!.queue }));
    expect(sentBody(fetch, 2)).toContain('<QueueIdentifier Number="S" PseudoCityCode="H8GI"/>');
  });
});

describe('queue.activity: formas raras', () => {
  it('sin QueueInfo ni Totals: lista vacía y totals en undefined', async () => {
    const { session } = await openWith(xml(200, soap(analysisRS(complete))));
    expect(await session.queue.activity()).toEqual({ queues: [], warnings: [], respondedAt: '2026-10-31T12:00:00Z' });
  });

  it('una cola con Name sale como { name }, y Count con relleno de puntos se lee', async () => {
    const payload = analysisRS(`${complete}<QueueInfo><QueueIdentifier Name="HOTELS">${zeros().replace('NumMessages Count="0"', 'NumMessages Count="....3"')}</QueueIdentifier></QueueInfo>`);
    const { session } = await openWith(xml(200, soap(payload)));
    expect((await session.queue.activity()).queues).toEqual([{ queue: { name: 'HOTELS' }, ...ZERO, numMessages: 3 }]);
  });

  it('los stl:Warning no lanzan: van en warnings', async () => {
    const payload = analysisRS(
      `<stl:ApplicationResults status="Complete">${success}${entry('Warning', 'WARN.SWS.HOST.WARNING_RETURNED', 'ALGO')}</stl:ApplicationResults>`,
    );
    const { session } = await openWith(xml(200, soap(payload)));
    const result = await session.queue.activity();
    expect(result.warnings[0]).toBeInstanceOf(SabreWarning);
    expect(result.warnings[0]).toMatchObject({ service: 'queueAnalysis' });
  });

  it('un stl:Error es un SabreBusinessError de queueAnalysis', async () => {
    const payload = analysisRS(`<stl:ApplicationResults status="NotProcessed">${entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'INVALID PSEUDO CITY')}</stl:ApplicationResults>`);
    const { session } = await openWith(xml(200, soap(payload)));
    const error = await rejection(session.queue.activity());
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'queueAnalysis', code: 'ERR.SWS.HOST.ERROR_IN_RESPONSE', retryable: false });
  });

  it.each([
    ['un contador que falta', `<QueueIdentifier Number="12">${zeros().replace('<Moved Count="0"/>', '')}</QueueIdentifier>`],
    ['un contador ilegible', `<QueueIdentifier Number="12">${zeros().replace('Moved Count="0"', 'Moved Count="x"')}</QueueIdentifier>`],
    ['un QueueIdentifier sin Number ni Name', `<QueueIdentifier>${zeros()}</QueueIdentifier>`],
  ])('%s es un SabreGatewayError con el sobre en raw', async (_name, identifier) => {
    const payload = analysisRS(`${complete}<QueueInfo>${identifier}</QueueInfo>`);
    const { session } = await openWith(xml(200, soap(payload)));
    const error = await rejection(session.queue.activity());
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as Error).message).toMatch(/^queueAnalysis: respuesta no reconocida/);
    expect((error as SabreGatewayError).raw).toContain('<QueueAnalysisRS');
  });

  it('Totals con un contador que falta es un SabreGatewayError', async () => {
    const payload = analysisRS(`${complete}<Totals>${zeros().replace('<Ended Count="0"/>', '')}</Totals>`);
    const { session } = await openWith(xml(200, soap(payload)));
    expect(await rejection(session.queue.activity())).toBeInstanceOf(SabreGatewayError);
  });
});
