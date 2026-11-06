// `sabre-client/testing`: el fake de colas contra el SDK real, sin red (#98).
import { describe, expect, it } from 'vitest';
import { SabreBusinessError, SabreLegacy, SabreSessionError } from '../src/index.js';
import { createQueueFake, queueFixtures, type QueueFakeOptions } from '../src/testing/index.js';
import { mockFetch } from './helpers.js';
import { rejection, xml } from './soap-helpers.js';

const NOW = new Date('2026-11-02T15:30:00Z');

/** Un PNR sintético con su línea de firma. */
const pnr = (locator: string, ...lines: string[]) => [...lines, ' 1.1PEREZ/JUAN', `ABCD.ABCD*AAA 1200/01NOV26 ${locator} H`];

function client(options: QueueFakeOptions) {
  const fake = createQueueFake({ now: () => NOW, ...options });
  const legacy = new SabreLegacy({
    environment: 'production',
    authVersion: 'v2',
    credentials: { username: 'V1:7971:ABCD:AA', password: 'epr-pass' },
    fetch: fake.fetch,
    retry: { maxRetries: 0 },
  });
  return { fake, legacy };
}

/** Un request SOAP crudo, para probar respuestas que el SDK no deja mandar. */
function envelope(action: string, token: string, body: string): string {
  return `<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eb="http://www.ebxml.org/namespaces/messageHeader"><soap-env:Header><eb:MessageHeader><eb:ConversationId>c</eb:ConversationId><eb:Action>${action}</eb:Action></eb:MessageHeader><wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext"><wsse:BinarySecurityToken>${token}</wsse:BinarySecurityToken></wsse:Security></soap-env:Header><soap-env:Body>${body}</soap-env:Body></soap-env:Envelope>`;
}

async function rawSession(fake: ReturnType<typeof createQueueFake>) {
  const opened = await (await fake.fetch('https://fake', { method: 'POST', body: envelope('SessionCreateRQ', '', '<SessionCreateRQ Version="2.0.0"/>') })).text();
  const token = /<wsse:BinarySecurityToken[^>]*>([^<]+)</.exec(opened)![1]!;
  const send = async (action: string, body: string) =>
    (await fake.fetch('https://fake', { method: 'POST', body: envelope(action, token, body) })).text();
  return { send };
}

describe('process contra el fake', () => {
  it('recorre la cola, ejecuta cada acción y cierra la sesión', async () => {
    const { fake, legacy } = client({ queues: { '12': [pnr('AAAAAA'), pnr('BBBBBB'), pnr('CCCCCC')] } });
    const seen: string[] = [];
    const result = await legacy.withSession((session) =>
      session.queue.process({ queue: 12 }, (item) => {
        seen.push(item.locator);
        if (item.locator === 'AAAAAA') return { action: 'remove' };
        if (item.locator === 'BBBBBB') return { action: 'place', to: [{ queue: 50, instructionCode: 11 }] };
        return { action: 'ignore' };
      }),
    );

    expect(result).toEqual({ visited: 3, ended: 'end-of-display' });
    expect(seen).toEqual(['AAAAAA', 'BBBBBB', 'CCCCCC']);
    expect(fake.locators(12)).toEqual(['CCCCCC']);
    expect(fake.locators(50)).toEqual(['BBBBBB']);
    expect(fake.openSessions).toBe(0);
    expect(fake.calls.map((call) => call.command)).toEqual(['open', 'access', 'remove', 'place', 'ignore', 'close']);
  });

  it('entrega el párrafo tal cual, con su sangría, y los campos de Line', async () => {
    const { legacy } = client({
      queues: {
        '12': [{ locator: 'AAAAAA', paragraph: ['011  SEE REMARKS', ' 1.1PEREZ/JUAN'], placedAt: '2026-10-01T09:15', placedBy: { agentSine: 'AAA', pseudoCityCode: 'ABCD' } }],
      },
    });
    const step = await legacy.withSession(async (session) => {
      const first = await session.queue.access({ queue: 12 });
      await session.queue.exit();
      return first;
    });

    expect(step).toEqual({
      done: false,
      item: {
        locator: 'AAAAAA',
        placedAt: '2026-10-01T09:15',
        placedBy: { agentSine: 'AAA', pseudoCityCode: 'ABCD' },
        // Sin línea de firma, el fake agrega una.
        paragraph: ['011  SEE REMARKS', ' 1.1PEREZ/JUAN', 'XXXX.XXXX*AAA 1200/01JAN26 AAAAAA H'],
      },
      warnings: [],
    });
  });

  it('una cola vacía termina con ended empty, como QUEUE SELECTED WAS EMPTY', async () => {
    const { legacy } = client({ queues: { '12': [] } });
    const result = await legacy.withSession(async (session) => ({
      process: await session.queue.process({ queue: 12 }, () => ({ action: 'ignore' })),
      list: await session.queue.list({ queue: 12 }),
      access: await session.queue.access({ queue: 99 }),
    }));

    expect(result.process).toEqual({ visited: 0, ended: 'empty' });
    expect(result.list.locators).toEqual([]);
    expect(result.access).toEqual({ done: true, reason: 'empty', message: 'QUEUE SELECTED WAS EMPTY', warnings: [] });
  });

  it('con limit, sale con QXI y deja el resto en la cola', async () => {
    const { fake, legacy } = client({ queues: { '12': [pnr('AAAAAA'), pnr('BBBBBB')] } });
    const result = await legacy.withSession((session) => session.queue.process({ queue: 12, limit: 1 }, () => ({ action: 'remove' })));

    expect(result).toEqual({ visited: 1, ended: 'limit' });
    expect(fake.locators(12)).toEqual(['BBBBBB']);
    expect(fake.calls.at(-2)).toEqual({ command: 'exit' });
  });
});

describe('primitivas', () => {
  it('count no cuenta las colas vacías ni el PNR en pantalla', async () => {
    const { legacy } = client({ queues: { '12': [pnr('AAAAAA'), pnr('BBBBBB')], '13': [], S: [pnr('CCCCCC')] } });
    const [outside, inside] = await legacy.withSession(async (session) => {
      const before = await session.queue.count();
      await session.queue.access({ queue: 12 });
      const during = await session.queue.count();
      await session.queue.exit();
      return [before, during];
    });

    expect(outside).toEqual({
      queues: [
        { queue: 12, count: 2 },
        { queue: 'S', count: 1 },
      ],
      totals: { messages: 1, specials: 0, pnrs: 2 },
      countedAt: '11-02T15:30',
      warnings: [],
    });
    expect(inside.queues).toContainEqual({ queue: 12, count: 1 });
  });

  it('list devuelve la posición y el pasajero solo si se pide, sin entrar a la cola', async () => {
    const { legacy } = client({ queues: { '12': [{ locator: 'AAAAAA', primaryPassenger: 'PEREZ/JUAN' }, pnr('BBBBBB')] } });
    const [plain, withPassenger, state] = await legacy.withSession(async (session) => [
      await session.queue.list({ queue: 12 }),
      await session.queue.list({ queue: 12, primaryPassenger: true }),
      session.queue.state,
    ]);

    expect(plain).toMatchObject({ locators: ['AAAAAA', 'BBBBBB'], entries: [{ locator: 'AAAAAA', position: 1 }, { locator: 'BBBBBB', position: 2 }] });
    expect(plain.entries[0]).not.toHaveProperty('primaryPassenger');
    expect(withPassenger.entries[0]).toMatchObject({ primaryPassenger: 'PEREZ/JUAN' });
    expect(state).toBe('outside');
  });

  it('place dentro de una cola mueve el PNR y devuelve el siguiente', async () => {
    const { fake, legacy } = client({ queues: { '12': [pnr('AAAAAA'), pnr('BBBBBB')] } });
    const [moved, last] = await legacy.withSession(async (session) => {
      await session.queue.access({ queue: 12 });
      const next = await session.queue.place({ to: [{ queue: 50, instructionCode: 11 }, { queue: 51, instructionCode: 11 }] });
      const end = await session.queue.place({ to: [{ queue: 50, instructionCode: 11 }] });
      return [next, end];
    });

    expect(moved).toMatchObject({ done: false, item: { locator: 'BBBBBB' } });
    expect(last).toMatchObject({ done: true, reason: 'end-of-display' });
    expect(fake.locators(12)).toEqual([]);
    expect(fake.locators(50)).toEqual(['AAAAAA', 'BBBBBB']);
    expect(fake.locators(51)).toEqual(['AAAAAA']);
  });

  it('place por localizador coloca PNR de fuera de las colas y confirma cada uno', async () => {
    const { fake, legacy } = client({ pnrs: [pnr('AAAAAA'), pnr('BBBBBB')] });
    const result = await legacy.withSession((session) =>
      session.queue.place({ to: [{ queue: 51, instructionCode: 11 }], locators: ['AAAAAA', 'BBBBBB'] }),
    );

    expect(result.placements).toEqual([
      { queue: 51, pcc: 'ABCD', locator: 'AAAAAA', placedAt: '11-02T15:30' },
      { queue: 51, pcc: 'ABCD', locator: 'BBBBBB', placedAt: '11-02T15:30' },
    ]);
    expect(fake.locators(51)).toEqual(['AAAAAA', 'BBBBBB']);

    // El PNR colocado entra con la fecha y el PCC de la colocación.
    const step = await legacy.withSession(async (session) => {
      const first = await session.queue.access({ queue: 51 });
      await session.queue.exit();
      return first;
    });
    expect(step).toMatchObject({ item: { locator: 'AAAAAA', placedAt: '2026-11-02T15:30', placedBy: { pseudoCityCode: 'ABCD' } } });
  });

  it('place con un localizador que el fake no conoce da BAD PNR LOCATOR y no coloca nada', async () => {
    const { fake, legacy } = client({ pnrs: [pnr('AAAAAA')] });
    const error = await legacy.withSession((session) =>
      rejection(session.queue.place({ to: [{ queue: 51, instructionCode: 11 }], locators: ['AAAAAA', 'ZZZZZZ'] })),
    );

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect((error as SabreBusinessError).message).toContain('BAD PNR LOCATOR');
    expect(fake.locators(51)).toEqual([]);
  });

  it('remove({ from }) saca el PNR de esas colas a la vez', async () => {
    const { fake, legacy } = client({ queues: { '12': [pnr('AAAAAA'), pnr('BBBBBB')], '13': [pnr('AAAAAA')] } });
    const step = await legacy.withSession(async (session) => {
      await session.queue.access({ queue: 12 });
      const next = await session.queue.remove({ from: [{ queue: 12 }, { queue: 13 }] });
      await session.queue.exit();
      return next;
    });

    expect(step).toMatchObject({ done: false, item: { locator: 'BBBBBB' } });
    expect(fake.locators(12)).toEqual(['BBBBBB']);
    expect(fake.locators(13)).toEqual([]);
  });

  it('selection no está simulado: lanza en vez de abrir la cola entera', async () => {
    const { legacy } = client({ queues: { '12': [pnr('AAAAAA')] } });
    const error = await legacy.withSession((session) => rejection(session.queue.access({ queue: 12, selection: [{ function: 'AL', criteria: 'DL' }] })));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect((error as Error).message).toContain('selection no está simulado');
  });

  it('ping responde Success', async () => {
    const { fake, legacy } = client({});
    await legacy.withSession((session) => session.ping());
    expect(fake.calls.map((call) => call.command)).toEqual(['open', 'ping', 'close']);
  });
});

describe('sesiones', () => {
  it('expireSessions: la siguiente llamada es SabreSessionError expired y close resuelve sin red', async () => {
    const { fake, legacy } = client({ queues: { '12': [pnr('AAAAAA')] } });
    const session = await legacy.openSession();
    fake.expireSessions();

    const error = await rejection(session.queue.count());
    expect(error).toBeInstanceOf(SabreSessionError);
    expect(error).toMatchObject({ kind: 'expired', code: 'USG_INVALID_SECURITY_TOKEN', status: 500 });
    await session.close();
    expect(fake.calls.map((call) => call.command)).toEqual(['open']);
  });

  it('openSessions cuenta las sesiones que el consumidor no cerró', async () => {
    const { fake, legacy } = client({});
    const session = await legacy.openSession();
    await legacy.withSession(async () => {});
    expect(fake.openSessions).toBe(1);
    await session.close();
    expect(fake.openSessions).toBe(0);
  });
});

describe('respuestas que el SDK no deja provocar', () => {
  it('fuera de una cola: I da IGD y QXI da CANNOT DO THIS IF OFF QUEUE', async () => {
    const { send } = await rawSession(createQueueFake());
    expect(await send('QueueAccessLLSRQ', '<QueueAccessRQ><Navigation Action="I"/></QueueAccessRQ>')).toContain('<stl:Message>IGD</stl:Message>');
    expect(await send('QueueAccessLLSRQ', '<QueueAccessRQ><Navigation Action="QXI"/></QueueAccessRQ>')).toContain('CANNOT DO THIS IF OFF QUEUE');
  });

  it('place sin PIC: INSTRUCTION NUMBER NOT IN RANGE fuera de una cola y NEED INSTRUCTION NUMBER dentro', async () => {
    const { send } = await rawSession(createQueueFake({ queues: { '12': [pnr('AAAAAA')] } }));
    const placeRQ = (ids: string) => `<QueuePlaceRQ><QueueInfo><QueueIdentifier Number="51" PseudoCityCode="ABCD"/>${ids}</QueueInfo></QueuePlaceRQ>`;
    expect(await send('QueuePlaceLLSRQ', placeRQ('<UniqueID ID="AAAAAA"/>'))).toContain('INSTRUCTION NUMBER NOT IN RANGE');
    await send('QueueAccessLLSRQ', '<QueueAccessRQ><QueueIdentifier Number="12" PseudoCityCode="ABCD"/></QueueAccessRQ>');
    expect(await send('QueuePlaceLLSRQ', placeRQ(''))).toContain('NEED INSTRUCTION NUMBER');
  });

  it('un token que no abrió el fake recibe el fault de sesión vencida', async () => {
    const fake = createQueueFake();
    const response = await fake.fetch('https://fake', { method: 'POST', body: envelope('OTA_PingRQ', 'otro', '<OTA_PingRQ/>') });
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('USG_INVALID_SECURITY_TOKEN');
  });
});

describe('validación de las opciones, sin red', () => {
  it.each([
    ['un párrafo sin línea de firma', { queues: { '12': [[' 1.1PEREZ/JUAN']] } }, /línea de firma/],
    ['un localizador inválido', { queues: { '12': [{ locator: 'abc' }] } }, /6 caracteres/],
    ['una firma de otro PNR', { queues: { '12': [{ locator: 'AAAAAA', paragraph: pnr('BBBBBB') }] } }, /es de BBBBBB/],
    ['el mismo PNR con dos párrafos', { queues: { '12': [pnr('AAAAAA')], '13': [pnr('AAAAAA', 'OTRO')] } }, /dos párrafos/],
    ['una cola fuera de rango', { queues: { '512': [] } }, /fuera de 0–511/],
  ])('rechaza %s', (_name, options, message) => {
    expect(() => createQueueFake(options as QueueFakeOptions)).toThrow(message);
  });

  it('el mismo PNR con el mismo párrafo puede estar en dos colas', () => {
    const fake = createQueueFake({ queues: { '12': [pnr('AAAAAA')], '13': [pnr('AAAAAA')] } });
    expect(fake.locators(13)).toEqual(['AAAAAA']);
  });
});

describe('queueFixtures', () => {
  it('trae las respuestas grabadas, sin los metadatos de la corrida', () => {
    expect(Object.keys(queueFixtures)).toEqual(['walk', 'emptyQueue', 'place', 'placeWithoutInstructionCode', 'placeWithoutInstructionCodeInside']);
    expect(Object.keys(queueFixtures.walk)).toEqual(['recordedAt', 'responses']);
    expect(Object.isFrozen(queueFixtures.walk.responses)).toBe(true);
    for (const fixture of Object.values(queueFixtures)) {
      for (const { body } of fixture.responses) expect(body).not.toMatch(/<wsse:BinarySecurityToken[^>]*>(?!\[REDACTED\]<)/);
    }
  });

  it('se pueden servir con un fetch mockeado', async () => {
    const responses = queueFixtures.walk.responses.filter((response) => ['openSession', 'queue.access'].includes(response.operation));
    const fetch = mockFetch(...responses.map((response) => xml(response.status, response.body)));
    const legacy = new SabreLegacy({ environment: 'production', authVersion: 'v2', credentials: { username: 'V1:7971:XXXX:AA', password: 'x' }, fetch });
    const session = await legacy.openSession();
    expect(await session.queue.access({ queue: 2 })).toMatchObject({ done: false, item: { locator: 'AAAAAA' } });
  });
});

describe('colas alfabéticas y con nombre en el fake (ADR-028)', () => {
  it("'S' y una cola con nombre usan claves y atributos distintos", async () => {
    const { fake, legacy } = client({
      queues: { S: [pnr('AAAAAA')], 'name:HOTELS': [pnr('BBBBBB')], CARS: [pnr('CCCCCC')] },
    });
    const { count, hotels } = await legacy.withSession(async (session) => {
      const count = await session.queue.count();
      const hotels = await session.queue.list({ queue: { name: 'HOTELS' } });
      return { count, hotels };
    });

    expect(count.queues).toEqual([
      { queue: 'S', count: 1 },
      { queue: { name: 'HOTELS' }, count: 1 },
      { queue: { name: 'CARS' }, count: 1 },
    ]);
    expect(count.totals).toEqual({ messages: 1, specials: 0, pnrs: 2 });
    expect(hotels.locators).toEqual(['BBBBBB']);
    expect(fake.locators('S')).toEqual(['AAAAAA']);
    expect(fake.locators({ name: 'HOTELS' })).toEqual(['BBBBBB']);
    expect(fake.calls).toContainEqual({ command: 'list', queue: { name: 'HOTELS' } });
  });

  it('place a una cola alfabética responde con Number y a una con nombre, con Name', async () => {
    const { fake, legacy } = client({ pnrs: [pnr('DDDDDD')] });
    const result = await legacy.withSession((session) =>
      session.queue.place({ to: [{ queue: 'S', instructionCode: 11 }, { queue: { name: 'HOTELS' }, instructionCode: 11 }], locators: ['DDDDDD'] }),
    );
    expect(result.placements.map((placement) => placement.queue)).toEqual(['S', { name: 'HOTELS' }]);
    expect(fake.locators('S')).toEqual(['DDDDDD']);
    expect(fake.locators({ name: 'HOTELS' })).toEqual(['DDDDDD']);
  });
});
