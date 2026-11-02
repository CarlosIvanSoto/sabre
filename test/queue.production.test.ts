// Colas contra las respuestas grabadas en producción (#96, 2026-11-01), con `fetch` mockeado. Ver
// scripts/validate-queue.mjs. Las fixtures vienen anonimizadas: PCC y firmas como `XXXX`/`AAA`,
// localizadores como alias y el párrafo enmascarado.
import { describe, expect, it } from 'vitest';
import { SabreBusinessError } from '../src/index.js';
import emptyQueueWalk from './fixtures/queue.production-walk-empty-queue.json';
import { mockFetch } from './helpers.js';
import { legacyClient, queueRS, rejection, soap, success, xml } from './soap-helpers.js';

interface Fixture {
  responses: Array<{ operation: string; status: number; body: string }>;
}

/** Las respuestas grabadas de `operation`, en orden. */
const recorded = (fixture: Fixture, operation: string) =>
  fixture.responses.filter((response) => response.operation === operation).map((response) => xml(response.status, response.body));
const one = (fixture: Fixture, operation: string) => recorded(fixture, operation)[0]!;

async function open(...responses: Array<Response | Error>) {
  const fetch = mockFetch(one(emptyQueueWalk, 'openSession'), ...responses);
  const { client, calls } = legacyClient(fetch);
  return { fetch, calls, session: await client.openSession() };
}

describe('cola vacía en producción: QUEUE SELECTED WAS EMPTY', () => {
  it('count la deja fuera de la lista de colas con PNR', async () => {
    const { session } = await open(one(emptyQueueWalk, 'queue.count'));
    const count = await session.queue.count();
    expect(count.queues.map((queue) => queue.queue)).toEqual([{ name: 'S' }, 100, 200, 300]);
    expect(count.totals).toEqual({ messages: 6, specials: 0, pnrs: 4 });
    expect(count.countedAt).toBe('11-01T20:48');
  });

  it('list devuelve una lista vacía', async () => {
    const { session } = await open(one(emptyQueueWalk, 'queue.list'));
    expect(await session.queue.list({ queue: 2 })).toEqual({ locators: [], entries: [], paragraph: [], warnings: [] });
  });

  it('access devuelve el fin de cola con reason empty y deja la sesión afuera', async () => {
    const { session } = await open(one(emptyQueueWalk, 'queue.access'));
    expect(await session.queue.access({ queue: 2 })).toEqual({
      done: true,
      reason: 'empty',
      message: 'QUEUE SELECTED WAS EMPTY',
      warnings: [],
    });
    expect(session.queue.state).toBe('outside');
  });

  it('process termina con ended empty, sin llamar al callback ni mandar QXI', async () => {
    const { fetch, session } = await open(one(emptyQueueWalk, 'queue.access'));
    const callback = () => ({ action: 'ignore' }) as const;
    expect(await session.queue.process({ queue: 2 }, callback)).toEqual({ visited: 0, ended: 'empty' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('QXI fuera de una cola en producción: CANNOT DO THIS IF OFF QUEUE', () => {
  it('con unknown, exit lo tolera y deja la sesión afuera', async () => {
    const item = queueRS(success, '<Line Number="1"><UniqueID ID="AAAAAA"/></Line><Paragraph><Text>011  SEE REMARKS</Text></Paragraph>');
    const { session, calls } = await open(xml(200, soap(item)), new TypeError('fetch failed'), one(emptyQueueWalk, 'probe.QXI'));
    await session.queue.access({ queue: 100 });
    await rejection(session.queue.ignore());
    expect(session.queue.state).toBe('unknown');

    await session.queue.exit();
    expect(session.queue.state).toBe('outside');
    expect(calls.find(([, message]) => message === 'sabre.queue.exitTolerated')?.[2]).toMatchObject({
      code: 'ERR.SWS.HOST.ERROR_IN_RESPONSE',
    });
  });
});

describe('stl:Error con la forma real', () => {
  it('code sale del ShortText, porque Message no trae @code', async () => {
    // El `I` crudo que el script mandó fuera de una cola (`IGD`), servido como respuesta de access.
    const { session } = await open(one(emptyQueueWalk, 'probe.I'));
    const error = await rejection(session.queue.access({ queue: 100 }));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ code: 'ERR.SWS.HOST.ERROR_IN_RESPONSE', message: 'queueAccess: IGD (ERR.SWS.HOST.ERROR_IN_RESPONSE)' });
    expect(session.queue.state).toBe('outside');
  });
});
