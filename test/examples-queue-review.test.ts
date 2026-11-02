// La revisión de cola de examples/ contra el fake de `sabre-client/testing`: así prueba un
// consumidor su lógica de colas, sin red (#98).
import { SabreLegacy } from 'sabre-client';
import { createQueueFake } from 'sabre-client/testing';
import { describe, expect, it } from 'vitest';
import { reviewQueue } from '../examples/queue-review.mjs';

const signature = (locator: string) => `ABCD.ABCD*AAA 1200/01NOV26 ${locator} H`;

const issued = (locator: string) => [
  ' 1.1PEREZ/JUAN',
  ' 1 XX 123Y 15DEC 2 MEXCUN HK1  0700  0915  /DCXX*ABCDEF /E',
  'TKT/TIME LIMIT',
  '  1.TE 9990000000001-AT PEREZ/J ABCD*AAA 1015/20OCT*',
  signature(locator),
];
const cancelled = (locator: string) => [' 1.1LOPEZ/ANA', ' 1 XX 124Y 03JAN 6 CUNMEX HX1  1120A  140P /E', signature(locator)];
const pending = (locator: string) => [' 1.1RUIZ/LUIS', ' 1 XX 125Y 10JAN 6 MEXMTY HK1  0800  0930 /E', 'TKT/TIME LIMIT', '  1.T-28DEC-ABCD*AAA', signature(locator)];

function setup() {
  const fake = createQueueFake({ queues: { '12': [issued('AAAAAA'), cancelled('BBBBBB'), pending('CCCCCC'), issued('DDDDDD')] } });
  const legacy = new SabreLegacy({
    environment: 'production',
    authVersion: 'v2',
    credentials: { username: 'V1:7971:ABCD:AA', password: 'epr-pass' },
    fetch: fake.fetch,
  });
  return { fake, legacy };
}

const options = { queue: 12, reviewQueue: 50, instructionCode: 11, referenceDate: '2026-11-02' };

describe('examples/queue-review.mjs contra sabre-client/testing', () => {
  it('saca los emitidos, manda a revisión los cancelados y deja el resto', async () => {
    const { fake, legacy } = setup();
    const result = await reviewQueue(legacy, options);

    expect(result).toEqual({
      visited: 4,
      ended: 'end-of-display',
      decisions: [
        { locator: 'AAAAAA', action: 'remove' },
        { locator: 'BBBBBB', action: 'place' },
        { locator: 'CCCCCC', action: 'ignore' },
        { locator: 'DDDDDD', action: 'remove' },
      ],
    });
    expect(fake.locators(12)).toEqual(['CCCCCC']);
    expect(fake.locators(50)).toEqual(['BBBBBB']);
    expect(fake.openSessions).toBe(0);
  });

  it('una segunda pasada solo ve lo que quedó', async () => {
    const { legacy } = setup();
    await reviewQueue(legacy, options);
    expect((await reviewQueue(legacy, options)).decisions).toEqual([{ locator: 'CCCCCC', action: 'ignore' }]);
  });

  it('con limit, para a mitad de la cola y sale de ella', async () => {
    const { fake, legacy } = setup();
    const result = await reviewQueue(legacy, { ...options, limit: 2 });

    expect(result).toMatchObject({ visited: 2, ended: 'limit' });
    expect(fake.locators(12)).toEqual(['CCCCCC', 'DDDDDD']);
    expect(fake.calls.map((call) => call.command)).toEqual(['open', 'access', 'remove', 'place', 'exit', 'close']);
  });

  it('con la cola vacía, termina sin visitar nada', async () => {
    const fake = createQueueFake({ queues: { '12': [] } });
    const legacy = new SabreLegacy({
      environment: 'production',
      authVersion: 'v2',
      credentials: { username: 'V1:7971:ABCD:AA', password: 'epr-pass' },
      fetch: fake.fetch,
    });
    expect(await reviewQueue(legacy, options)).toEqual({ visited: 0, ended: 'empty', decisions: [] });
  });
});
