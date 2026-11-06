// El fake de sabre-client/testing con queue.activity y reservation.history (#167, ADR-027 D3).
import { describe, expect, it } from 'vitest';
import { SabreBusinessError, SabreLegacy } from '../src/index.js';
import { createQueueFake, type QueueFakeHistoryTransaction, type QueueFakeOptions } from '../src/testing/index.js';
import { rejection } from './soap-helpers.js';

const NOW = new Date('2026-11-06T17:34:00Z');
const pnr = (locator: string) => [' 1.1PEREZ/JUAN', `ABCD.ABCD*AAA 1200/01NOV26 ${locator} H`];

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

const zero = { ended: 0, ignored: 0, moved: 0, removed: 0, transferred: 0, leftMessageToContact: 0, unableToReach: 0 };

describe('queue.activity contra el fake', () => {
  it('numMessages sale de las colas; los demás contadores, de lo sembrado o 0', async () => {
    const { fake, legacy } = client({
      queues: { '9': [pnr('AAAAAA'), pnr('BBBBBB')], S: [['MENSAJE UNO']], '50': [] },
      activity: { '9': { ignored: 27, transferred: 7 }, '300': { ended: 1 } },
    });

    const result = await legacy.withSession((session) => session.queue.activity());

    expect(result).toEqual({
      queues: [
        { queue: 9, ...zero, numMessages: 2, ignored: 27, transferred: 7 },
        { queue: 'S', ...zero, numMessages: 1 },
        { queue: 300, ...zero, numMessages: 0, ended: 1 },
      ],
      totals: { ...zero, numMessages: 3, ignored: 27, transferred: 7, ended: 1 },
      analyzedAt: '11-06T17:34',
      warnings: [],
    });
    expect(fake.calls.map((call) => call.command)).toEqual(['open', 'activity', 'close']);
  });

  it('sigue el estado del fake: remove baja numMessages, pero no sube removed (Q-097)', async () => {
    const { legacy } = client({ queues: { '9': [pnr('AAAAAA'), pnr('BBBBBB')] } });
    const result = await legacy.withSession(async (session) => {
      await session.queue.access({ queue: 9 });
      await session.queue.remove();
      await session.queue.exit();
      return session.queue.activity();
    });
    expect(result.queues).toEqual([{ queue: 9, ...zero, numMessages: 1 }]);
  });

  it('dentro de una cola no cuenta el PNR en pantalla, como count', async () => {
    const { legacy } = client({ queues: { '9': [pnr('AAAAAA'), pnr('BBBBBB')] } });
    const [counted, analyzed] = await legacy.withSession(async (session) => {
      await session.queue.access({ queue: 9 });
      const both = [await session.queue.count(), await session.queue.activity()] as const;
      await session.queue.exit();
      return both;
    });
    expect(counted.queues).toEqual([{ queue: 9, count: 1 }]);
    expect(analyzed.queues[0]?.numMessages).toBe(1);
  });

  it.each([
    [{ '9': { numMessages: 3 } }, "activity['9'].numMessages sale de la cola del fake: no se siembra"],
    [{ '9': { removido: 1 } }, "activity['9'].removido no es un contador de queue.activity"],
    [{ '9': { ignored: -1 } }, "activity['9'].ignored debe ser un entero de 0 en adelante"],
    [{ '9': [] }, "activity['9'] debe ser un objeto de contadores"],
    [{ '999': { ignored: 1 } }, 'la cola 999 está fuera de 0–511'],
  ])('activity inválido lanza TypeError: %j', (activity, message) => {
    expect(() => createQueueFake({ activity } as never)).toThrow(new TypeError(`sabre-client/testing: ${message}`));
  });
});

const SEEDED: QueueFakeHistoryTransaction[] = [
  {
    rph: 1,
    createdAt: '2026-11-04T16:26',
    agent: 'AJ',
    agentDutyCode: '*',
    agentFunctionCode: 'A',
    pcc: 'ABCD',
    aaaPcc: 'ABCD',
    receivedFrom: 'JUAN PEREZ',
    flightSegments: [
      {
        action: 'AS',
        status: 'HK',
        marketingAirline: 'AM',
        flightNumber: '0400',
        bookingClass: 'Y',
        origin: 'MEX',
        destination: 'CUN',
        departureDateTime: '12-19T13:10',
        arrivalDateTime: '12-19T14:34',
        numberInParty: 1,
        supplierRef: 'DCAM*ABC123',
      },
    ],
    generalInfo: [
      { action: 'AN', text: '1PEREZ/JUAN' },
      { action: 'A4S', text: 'SSR DOCS AM HK1\nSEGUNDA LINEA' },
    ],
    remarks: [{ action: 'A5', text: 'CLIENTE & CIA <VIP>' }],
    accounting: [{ action: 'HK', type: 'R', linkCode: '1' }],
  },
  { rph: 2, createdAt: '2026-11-05T09:00', agent: 'AJ', receivedFrom: 'AGENCIA' },
];

describe('reservation.history contra el fake', () => {
  it('devuelve lo sembrado, tal cual lo lee el SDK', async () => {
    const { fake, legacy } = client({ pnrs: [pnr('AAAAAA')], histories: { AAAAAA: SEEDED } });
    const result = await legacy.withSession((session) => session.reservation.history('AAAAAA'));
    expect(result).toEqual({
      transactions: [
        { ...SEEDED[0] },
        { ...SEEDED[1], flightSegments: [], generalInfo: [], remarks: [], accounting: [] },
      ],
      warnings: [],
    });
    expect(fake.calls).toContainEqual({ command: 'history', locator: 'AAAAAA' });
  });

  it('un PNR del fake sin historial sembrado da la transacción sintética de creación', async () => {
    const { legacy } = client({ queues: { '9': [pnr('BBBBBB')] } });
    const result = await legacy.withSession((session) => session.reservation.history('BBBBBB'));
    expect(result.transactions).toEqual([
      {
        rph: 1,
        createdAt: '2026-11-06T17:34',
        agent: 'AAA',
        pcc: 'XXXX',
        receivedFrom: 'SABRE-CLIENT/TESTING',
        flightSegments: [],
        generalInfo: [],
        remarks: [],
        accounting: [],
      },
    ]);
  });

  it('un localizador que el fake no conoce es un SabreBusinessError marcado como no simulado', async () => {
    const { legacy } = client({});
    const error = await rejection(legacy.withSession((session) => session.reservation.history('ZZZZZZ')));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect((error as Error).message).toContain('no está en el fake');
  });

  it('dentro de una cola, el historial de otro PNR da NAK6 y el recorrido sigue (CERT, Q-102)', async () => {
    const { legacy } = client({ queues: { '9': [pnr('AAAAAA'), pnr('BBBBBB')] }, pnrs: [pnr('CCCCCC')] });
    const outcome = await legacy.withSession(async (session) => {
      await session.queue.access({ queue: 9 });
      const error = await rejection(session.reservation.history('CCCCCC'));
      const own = await session.reservation.history('AAAAAA');
      const next = await session.queue.ignore();
      await session.queue.exit();
      return { error, own, next, state: session.queue.state };
    });
    expect(outcome.error).toBeInstanceOf(SabreBusinessError);
    expect((outcome.error as Error).message).toBe('itineraryHistory: NAK6 -NOT ALLOWED- FINISH OR IGNORE OTHER ACTIVITY (ERR.SWS.HOST.ERROR_IN_RESPONSE)');
    expect(outcome.own.transactions).toHaveLength(1);
    expect(outcome.next).toMatchObject({ done: false, item: { locator: 'BBBBBB' } });
    expect(outcome.state).toBe('outside');
  });

  it.each([
    [{ abc: [] }, "histories['abc']: la clave debe ser un localizador de 6 caracteres alfanuméricos en mayúscula"],
    [{ AAAAAA: {} }, "histories['AAAAAA'] debe ser una lista de transacciones"],
    [{ AAAAAA: [{ generalInfo: [{ text: 'x' }] }] }, "histories['AAAAAA'][0].generalInfo[0].action debe ser un string no vacío"],
    [{ AAAAAA: [{ flightSegments: {} }] }, "histories['AAAAAA'][0].flightSegments debe ser una lista"],
  ])('histories inválido lanza TypeError: %j', (histories, message) => {
    expect(() => createQueueFake({ histories } as never)).toThrow(new TypeError(`sabre-client/testing: ${message}`));
  });
});
