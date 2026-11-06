// examples/queue-health.mjs contra el fake de `sabre-client/testing`: activity e history sin red
// (#167).
import { SabreLegacy } from 'sabre-client';
import { createQueueFake } from 'sabre-client/testing';
import { describe, expect, it } from 'vitest';
import { queueHealth } from '../examples/queue-health.mjs';

const pnr = (locator: string) => [' 1.1PEREZ/JUAN', `ABCD.ABCD*AAA 1200/01NOV26 ${locator} H`];

function setup(activity: Record<string, Record<string, number>>) {
  const fake = createQueueFake({
    now: () => new Date('2026-11-06T17:34:00Z'),
    queues: { '9': [pnr('AAAAAA'), pnr('BBBBBB')] },
    activity,
    histories: {
      AAAAAA: [
        { rph: 1, createdAt: '2026-11-04T16:26', agent: 'AJ', receivedFrom: 'JUAN' },
        { rph: 2, createdAt: '2026-11-05T09:10', agent: 'BK', receivedFrom: 'AGENCIA' },
      ],
    },
  });
  const legacy = new SabreLegacy({
    environment: 'production',
    authVersion: 'v2',
    credentials: { username: 'V1:7971:ABCD:AA', password: 'epr-pass' },
    fetch: fake.fetch,
  });
  return { fake, legacy };
}

describe('examples/queue-health.mjs contra sabre-client/testing', () => {
  it('lee los contadores de la cola y la última transacción de cada PNR', async () => {
    const { fake, legacy } = setup({ '9': { ignored: 27 } });
    const result = await queueHealth(legacy, { queue: 9 });

    expect(result).toEqual({
      queue: 9,
      analyzedAt: '11-06T17:34',
      counters: expect.objectContaining({ queue: 9, numMessages: 2, ignored: 27, removed: 0 }),
      unattended: true,
      pnrs: [
        { locator: 'AAAAAA', transactions: 2, lastChangeAt: '2026-11-05T09:10', lastAgent: 'BK' },
        // Sin historial sembrado, el fake da la transacción sintética de creación.
        { locator: 'BBBBBB', transactions: 1, lastChangeAt: '2026-11-06T17:34', lastAgent: 'AAA' },
      ],
    });
    expect(fake.calls.map((call) => call.command)).toEqual(['open', 'activity', 'list', 'history', 'history', 'close']);
    expect(fake.openSessions).toBe(0);
  });

  it('una cola en la que se sacan PNR no está sin atender', async () => {
    const { legacy } = setup({ '9': { removed: 3 } });
    expect((await queueHealth(legacy, { queue: 9 })).unattended).toBe(false);
  });
});
