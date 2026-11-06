// Colas contra las respuestas grabadas en producción (#96, 2026-11-01), con `fetch` mockeado. Ver
// scripts/validate-queue.mjs. Las fixtures vienen anonimizadas: PCC y firmas como `XXXX`/`AAA`,
// localizadores como alias y el párrafo enmascarado.
import { describe, expect, it } from 'vitest';
import { parseQueueParagraph, SabreBusinessError } from '../src/index.js';
import countAfterWalk from './fixtures/queue.production-count.json';
import walk from './fixtures/queue.production-walk.json';
import emptyQueueWalk from './fixtures/queue.production-walk-empty-queue.json';
import place from './fixtures/queue.production-place.json';
import placeWithoutPic from './fixtures/queue.production-place-sin-pic.json';
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
    expect(count.queues.map((queue) => queue.queue)).toEqual(['S', 100, 200, 300]);
    expect(count.totals).toEqual({ messages: 6, specials: 0, pnrs: 4 });
    expect(count.countedAt).toBe('11-01T20:48');
  });

  it('list devuelve una lista vacía', async () => {
    const { session } = await open(one(emptyQueueWalk, 'queue.list'));
    expect(await session.queue.list({ queue: 2 })).toEqual({ locators: [], entries: [], paragraph: [], warnings: [] , respondedAt: '2026-11-02T02:48:28Z' });
  });

  it('access devuelve el fin de cola con reason empty y deja la sesión afuera', async () => {
    const { session } = await open(one(emptyQueueWalk, 'queue.access'));
    expect(await session.queue.access({ queue: 2 })).toEqual({
      respondedAt: '2026-11-02T02:48:28Z',
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

/** La cuenta de la cola 2 en un `count`. */
const queue2 = (count: { queues: Array<{ queue: unknown; count: number }> }) => count.queues.find((q) => q.queue === 2)?.count;

describe('recorrido de solo lectura en producción (cola 2, 4 PNR)', () => {
  /** Las respuestas del recorrido en el orden de la API pública, sin las pruebas crudas del script. */
  async function replayWalk() {
    const operations = walk.responses.filter((response) => !response.operation.startsWith('probe.'));
    const fetch = mockFetch(...operations.map((response) => xml(response.status, response.body)));
    const { client } = legacyClient(fetch);
    const session = await client.openSession();
    const before = await session.queue.count();
    const list = await session.queue.list({ queue: 2 });
    const visited = [];
    let step = await session.queue.access({ queue: 2 });
    const inside = await session.queue.count();
    while (!step.done) {
      visited.push(step.item);
      step = await session.queue.ignore();
    }
    await session.close();
    return { before, list, visited, inside, step, session };
  }

  it('recorre los PNR en el orden de list y termina en END OF DISPLAY', async () => {
    const { list, visited, step, session } = await replayWalk();
    expect(list.locators).toEqual(['AAAAAA', 'AAAAAB', 'AAAAAC', 'AAAAAD']);
    expect(visited.map((item) => item.locator)).toEqual(list.locators);
    expect(step).toMatchObject({ done: true, reason: 'end-of-display', message: 'END OF DISPLAY FOR REQUESTED DATA' });
    expect(session.queue.state).toBe('outside');
  });

  it('count dentro de la cola no mueve el cursor, y no cuenta el PNR abierto', async () => {
    const { before, inside, visited } = await replayWalk();
    expect(queue2(before)).toBe(4);
    expect(queue2(inside)).toBe(3);
    // Después del count, ignore devolvió el segundo PNR de la lista.
    expect(visited[1]?.locator).toBe('AAAAAB');
  });

  it('después del recorrido la cola sigue con sus 4 PNR', async () => {
    const fetch = mockFetch(...countAfterWalk.responses.map((response) => xml(response.status, response.body)));
    const session = await legacyClient(fetch).client.openSession();
    expect(queue2(await session.queue.count())).toBe(4);
  });

  it('el Line de access no trae Number, y su DateTime no es el de list', async () => {
    const { list, visited } = await replayWalk();
    for (const [index, item] of visited.entries()) {
      expect(item.placedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(item.placedAt).not.toBe(list.entries[index]?.placedAt);
      expect(list.entries[index]?.position).toBe(index + 1);
    }
  });

  it('parseQueueParagraph lee el párrafo real enmascarado sin lanzar', async () => {
    const { visited } = await replayWalk();
    for (const item of visited) {
      const parsed = parseQueueParagraph(item.paragraph, { referenceDate: '2026-11-01' });
      expect(parsed.messages).toEqual([{ instructionCode: 84, text: 'RATE/CONFIRMATION NUMBER RTND' }]);
      expect(parsed.unparsed.length).toBeGreaterThan(0);
    }
  });
});

describe('place sin PIC en producción: INSTRUCTION NUMBER NOT IN RANGE', () => {
  it('Sabre lo rechaza como SabreBusinessError, y el SDK ya no lo deja salir sin instructionCode', async () => {
    const { fetch, session } = await open(one(placeWithoutPic as Fixture, 'queue.place'));
    expect(await rejection(session.queue.place({ to: [{ queue: 51 }], locators: ['AAAAAA'] } as never))).toBeInstanceOf(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);

    // La respuesta grabada, servida a un place con PIC, es el rechazo tal cual.
    const error = await rejection(session.queue.place({ to: [{ queue: 51, instructionCode: 11 }], locators: ['AAAAAA'] }));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({
      code: 'ERR.SWS.HOST.ERROR_IN_RESPONSE',
      message: 'queuePlace: INSTRUCTION NUMBER NOT IN RANGE (ERR.SWS.HOST.ERROR_IN_RESPONSE)',
    });
  });
});

describe('place y remove con colas de prueba en producción (51 y 52, 2 PNR)', () => {
  /** La corrida de scripts/validate-place.mjs, en el orden de la API pública. */
  async function replayPlace() {
    const fetch = mockFetch(...place.responses.map((response) => xml(response.status, response.body)));
    const session = await legacyClient(fetch).client.openSession();
    const count = async () => {
      const queues = (await session.queue.count()).queues;
      return { 51: queues.find((q) => q.queue === 51)?.count ?? 0, 52: queues.find((q) => q.queue === 52)?.count ?? 0 };
    };
    const initial = await count();
    const placed = await session.queue.place({ to: [{ queue: 51, instructionCode: 11 }], locators: ['AAAAAA', 'AAAAAB'] });
    const afterPlace = await count();
    const first = await session.queue.access({ queue: 51 });
    const next = await session.queue.place({ to: [{ queue: 52, instructionCode: 11 }] });
    const removed = await session.queue.remove();
    const afterPlaceInside = await count();
    const empty51 = await session.queue.access({ queue: 51 });
    const in52 = await session.queue.access({ queue: 52 });
    const cleared52 = await session.queue.remove();
    const final = await count();
    await session.close();
    return { initial, placed, afterPlace, first, next, removed, afterPlaceInside, empty51, in52, cleared52, final, session };
  }

  it('place fuera de una cola coloca los dos PNR, y QueueInfo trae la cola con ceros (0051)', async () => {
    const { initial, placed, afterPlace } = await replayPlace();
    expect(initial).toEqual({ 51: 0, 52: 0 });
    expect(placed.placements.map((p) => [p.queue, p.locator])).toEqual([
      [51, 'AAAAAA'],
      [51, 'AAAAAB'],
    ]);
    expect(afterPlace).toEqual({ 51: 2, 52: 0 });
  });

  it('place dentro de la cola devuelve el siguiente PNR y saca el actual de la cola de origen', async () => {
    const { first, next, removed, afterPlaceInside } = await replayPlace();
    expect(first).toMatchObject({ done: false, item: { locator: 'AAAAAA' } });
    expect(next).toMatchObject({ done: false, item: { locator: 'AAAAAB' } });
    expect(removed).toMatchObject({ done: true, reason: 'end-of-display' });
    // El primero ya no está en la 51: quedó solo en la 52.
    expect(afterPlaceInside).toEqual({ 51: 0, 52: 1 });
  });

  it('el PNR colocado con el PIC 11 muestra el aviso 011  SEE REMARKS', async () => {
    const { next } = await replayPlace();
    if (!('done' in next) || next.done) throw new Error('place dentro de la cola no devolvió un PNR');
    expect(parseQueueParagraph(next.item.paragraph, { referenceDate: '2026-11-01' }).messages).toEqual([
      { instructionCode: 11, text: 'SEE REMARKS' },
    ]);
  });

  it('remove vacía las colas de prueba', async () => {
    const { empty51, in52, cleared52, final, session } = await replayPlace();
    expect(empty51).toMatchObject({ done: true, reason: 'empty' });
    expect(in52).toMatchObject({ done: false, item: { locator: 'AAAAAA' } });
    expect(cleared52).toMatchObject({ done: true, reason: 'end-of-display' });
    expect(final).toEqual({ 51: 0, 52: 0 });
    expect(session.queue.state).toBe('outside');
  });
});

describe('cola S de producción: count → access (ADR-028)', () => {
  it('el QueueRef que devuelve count para la S viaja en Number="S"', async () => {
    const { fetch, session } = await open(one(walk, 'queue.count'), xml(200, soap(queueRS(success))));
    const { queues } = await session.queue.count();
    const messages = queues.find((queue) => queue.queue === 'S');
    expect(messages).toEqual({ queue: 'S', count: 385 });
    await rejection(session.queue.access({ queue: messages!.queue }));
    expect(String(fetch.mock.calls[2]?.[1]?.body)).toContain('<QueueIdentifier Number="S" PseudoCityCode=');
  });
});
