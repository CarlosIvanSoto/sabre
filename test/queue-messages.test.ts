// La cola S, la de mensajes del PCC, contra las respuestas grabadas en CERT (#169 punto 3,
// 2026-11-06, scripts/validate-queue.mjs messages). Ver ADR-028: un paso de la S es un
// `Paragraph/Text` sin `Line`, y su fin de cola llega como texto con status Complete.
import { describe, expect, it } from 'vitest';
import { SabreGatewayError, SabreLegacy } from '../src/index.js';
import { createQueueFake } from '../src/testing/index.js';
import messages from './fixtures/queue.sandbox-messages.json';
import countAfter from './fixtures/queue.sandbox-count.json';
import production from './fixtures/queue.production-messages.json';
import { mockFetch } from './helpers.js';
import { legacyClient, queueRS, rejection, soap, success, xml } from './soap-helpers.js';

interface Fixture {
  responses: Array<{ operation: string; status: number; body: string }>;
}

const one = (fixture: Fixture, operation: string) => {
  const response = fixture.responses.find((r) => r.operation === operation);
  if (response === undefined) throw new Error(`la fixture no tiene ${operation}`);
  return xml(response.status, response.body);
};

async function open(...responses: Array<Response | Error>) {
  const fetch = mockFetch(one(messages, 'openSession'), ...responses);
  const { client } = legacyClient(fetch);
  return { fetch, session: await client.openSession() };
}

describe('cola S en CERT: access, ignore y el fin de cola', () => {
  it('access devuelve el mensaje: kind message, el texto tal cual y sin localizador', async () => {
    const { session } = await open(one(messages, 'probe.access S'));
    const step = await session.queue.access({ queue: 'S' });

    expect(step).toMatchObject({ done: false, kind: 'message', warnings: [] });
    if (step.done || step.kind !== 'message') throw new Error('se esperaba un mensaje');
    expect(step.message.text).toHaveLength(4);
    expect(step.message.text[3]).toMatch(/^»/);
    expect(step).not.toHaveProperty('item');
    expect(step.respondedAt).toBe('2026-11-06T18:33:48Z');
    expect(session.queue.state).toBe('inside');
  });

  it('ignore después del último mensaje: el fin de cola en Paragraph/Text, con Complete', async () => {
    const { session } = await open(one(messages, 'probe.access S'), one(messages, 'probe.I'));
    await session.queue.access({ queue: 'S' });

    expect(await session.queue.ignore()).toMatchObject({ done: true, reason: 'end-of-display' });
    expect(session.queue.state).toBe('outside');
  });

  it('el count de después sigue contando el mensaje: mostrarlo no lo borra (Q-100)', async () => {
    const { session } = await open(one(countAfter, 'queue.count'));
    const { queues, totals } = await session.queue.count();

    expect(queues).toContainEqual({ queue: 'S', count: 1 });
    expect(totals.messages).toBe(1);
  });

  it('access de la S sin Paragraph ni Line sigue siendo una respuesta no reconocida', async () => {
    const { session } = await open(xml(200, soap(queueRS(success))));
    const error = await rejection(session.queue.access({ queue: 'S' }));

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as Error).message).toContain('sin Paragraph de mensaje ni fin de cola en la cola S');
    expect(session.queue.state).toBe('unknown');
  });

  it('fuera de la S, un Paragraph sin Line no se lee como mensaje', async () => {
    const { session } = await open(one(messages, 'probe.access S'));
    expect(await rejection(session.queue.access({ queue: 12 }))).toBeInstanceOf(SabreGatewayError);
  });
});

describe('cola S en producción (2026-11-06): varios mensajes', () => {
  async function openProduction(...responses: Response[]) {
    const fetch = mockFetch(one(production, 'openSession'), ...responses);
    const { client } = legacyClient(fetch);
    return client.openSession();
  }

  it('access, ignore y exit: dos mensajes de 11 líneas y QXI con Paragraph y Complete', async () => {
    const session = await openProduction(one(production, 'probe.access S'), one(production, 'probe.I'), one(production, 'probe.QXI'));
    const first = await session.queue.access({ queue: 'S' });
    const second = await session.queue.ignore();

    for (const step of [first, second]) {
      if (step.done || step.kind !== 'message') throw new Error('se esperaba un mensaje');
      expect(step.message.text).toHaveLength(11);
    }
    await session.queue.exit();
    expect(session.queue.state).toBe('outside');
  });

  it('count: la S cuenta los mismos 6 que Totals MESSAGES', async () => {
    const session = await openProduction(one(production, 'queue.count'));
    const { queues, totals } = await session.queue.count();
    expect(queues).toEqual([{ queue: 'S', count: 6 }]);
    expect(totals).toEqual({ messages: 6, specials: 0, pnrs: 0 });
  });
});

describe('cola S: lo que se rechaza sin red', () => {
  it('process de la S lanza TypeError sin mandar nada', async () => {
    const { fetch, session } = await open();
    expect(await rejection(session.queue.process({ queue: 'S' }, () => ({ action: 'ignore' })))).toEqual(
      new TypeError("sabre-client: queue.process no recorre la cola 'S', la de mensajes: usa queue.access() e queue.ignore()"),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('place dentro de la S lanza TypeError sin mandar nada', async () => {
    const { fetch, session } = await open(one(messages, 'probe.access S'));
    await session.queue.access({ queue: 'S' });
    expect(await rejection(session.queue.place({ to: [{ queue: 12, instructionCode: 11 }] }))).toEqual(
      new TypeError("sabre-client: queue.place no se puede dentro de la cola 'S': lo que hay en pantalla es un mensaje, no un PNR"),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('cola S en el fake', () => {
  const legacyOf = (fake: ReturnType<typeof createQueueFake>) =>
    new SabreLegacy({
      environment: 'production',
      authVersion: 'v2',
      credentials: { username: 'V1:7971:ABCD:AA', password: 'epr-pass' },
      fetch: fake.fetch,
      retry: { maxRetries: 0 },
    });

  it('access e ignore recorren los mensajes sin Line, y los dejan en la cola', async () => {
    const fake = createQueueFake({ queues: { S: [['MENSAJE UNO'], ['MENSAJE DOS', '  SEGUNDA LINEA']] } });
    const steps = await legacyOf(fake).withSession(async (session) => [
      await session.queue.access({ queue: 'S' }),
      await session.queue.ignore(),
      await session.queue.ignore(),
    ]);

    expect(steps.map((step) => (step.done ? 'fin' : step.kind === 'message' ? step.message.text : step.item.locator))).toEqual([
      ['MENSAJE UNO'],
      ['MENSAJE DOS', '  SEGUNDA LINEA'],
      'fin',
    ]);
    expect(fake.messages()).toEqual([['MENSAJE UNO'], ['MENSAJE DOS', '  SEGUNDA LINEA']]);
    expect(fake.locators('S')).toEqual([]);
  });

  it('remove saca el mensaje (supuesto del fake, sin evidencia de Sabre)', async () => {
    const fake = createQueueFake({ queues: { S: [['MENSAJE UNO'], ['MENSAJE DOS']] } });
    await legacyOf(fake).withSession(async (session) => {
      await session.queue.access({ queue: 'S' });
      await session.queue.remove();
      await session.queue.exit();
    });
    expect(fake.messages()).toEqual([['MENSAJE DOS']]);
  });

  it('place a la S responde con un error de host: el fake no lo simula', async () => {
    const fake = createQueueFake({ pnrs: [{ locator: 'DDDDDD' }] });
    const error = await rejection(
      legacyOf(fake).withSession((session) => session.queue.place({ to: [{ queue: 'S', instructionCode: 11 }], locators: ['DDDDDD'] })),
    );
    expect((error as Error).message).toContain('place a la cola S no está simulado');
    expect(fake.messages()).toEqual([]);
  });

  it('un PNR en la S, o un mensaje vacío, lanza TypeError al crear el fake', () => {
    expect(() => createQueueFake({ queues: { S: [{ locator: 'AAAAAA' }] } })).toThrow(
      "sabre-client/testing: queues['S'][0]: la S es la cola de mensajes; cada elemento es el texto de un mensaje (string[])",
    );
    expect(() => createQueueFake({ queues: { S: [['', ' ']] } })).toThrow("sabre-client/testing: queues['S'][0]: el mensaje no puede estar vacío");
  });
});
