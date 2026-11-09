// queueFakePnrs (#166, ADR-027 D2): de una corrida grabada a los PNR de createQueueFake, y las
// fixtures de queueFixtures con alias propios y firmas con su forma.
import { describe, expect, it } from 'vitest';
import { SabreLegacy } from '../src/index.js';
import { createQueueFake, queueFakePnrs, queueFixtures } from '../src/testing/index.js';

const legacy = (fetch: typeof globalThis.fetch) =>
  new SabreLegacy({ environment: 'production', authVersion: 'v2', credentials: { username: 'V1:7971:ABCD:AA', password: 'x' }, fetch });

/** La línea de firma anonimizada con su forma: `… 9999/99XXX99 <alias> H`. */
const SIGNATURE = /\s9999\/99XXX99\s+([A-Z]{6})\s+H\s*$/;

describe('queueFakePnrs', () => {
  it('walk: los 4 PNR de list, en orden, con su Line y el párrafo de access e ignore', () => {
    const pnrs = queueFakePnrs(queueFixtures.walk);
    expect(pnrs.map((pnr) => pnr.locator)).toEqual(['AAAAAA', 'AAAAAB', 'AAAAAC', 'AAAAAD']);
    for (const pnr of pnrs) {
      expect(pnr.placedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(pnr.placedBy).toEqual({ agentSine: 'AAA', pseudoCityCode: 'XXXX' });
      expect(SIGNATURE.exec(pnr.paragraph!.at(-1)!)?.[1]).toBe(pnr.locator);
    }
  });

  it('el placedAt es el de list (la colocación), no el de access', () => {
    const list = queueFixtures.walk.responses.find((response) => response.operation === 'queue.list')!.body;
    const [first] = queueFakePnrs(queueFixtures.walk);
    expect(list).toContain(`<DateTime>${first!.placedAt}</DateTime>`);
  });

  it('place: el PNR de access y el que solo se ve por la firma del place dentro de la cola', () => {
    const pnrs = queueFakePnrs(queueFixtures.place);
    expect(pnrs.map((pnr) => pnr.locator)).toEqual(['AAAAAE', 'AAAAAF']);
    expect(SIGNATURE.exec(pnrs[0]!.paragraph!.at(-1)!)?.[1]).toBe('AAAAAE');
    expect(SIGNATURE.exec(pnrs[1]!.paragraph!.at(-1)!)?.[1]).toBe('AAAAAF');
  });

  it('una cola vacía no da PNR', () => {
    expect(queueFakePnrs(queueFixtures.emptyQueue)).toEqual([]);
  });

  it('un PNR que solo se colocó va sin párrafo', () => {
    const placed = queueFixtures.place.responses.filter((response) => response.operation === 'queue.place').slice(0, 1);
    expect(queueFakePnrs({ recordedAt: '2026-11-01', responses: placed })).toEqual([{ locator: 'AAAAAE' }, { locator: 'AAAAAF' }]);
  });

  // #193: el list de las fixtures se grabó sin `primaryPassenger: true` (sin `/LN`), y Sabre no
  // manda `PassengerName` en esa lista ni en el `Line` de access. No es un error del helper.
  it('walk y place no traen primaryPassenger: la grabación no lo tiene', () => {
    for (const fixture of [queueFixtures.walk, queueFixtures.place]) {
      expect(fixture.responses.some((response) => response.body.includes('PassengerName'))).toBe(false);
      for (const pnr of queueFakePnrs(fixture)) expect(pnr).not.toHaveProperty('primaryPassenger');
    }
  });

  it('con PassengerName en el Line de list, lo copia a primaryPassenger', () => {
    const responses = queueFixtures.walk.responses.map((response) =>
      response.operation === 'queue.list'
        ? { ...response, body: response.body.replace('<UniqueID ID="AAAAAB"/>', '<PassengerName>PASAJERO/DOS</PassengerName><UniqueID ID="AAAAAB"/>') }
        : response,
    );
    const pnrs = queueFakePnrs({ recordedAt: queueFixtures.walk.recordedAt, responses });
    expect(pnrs.map((pnr) => pnr.primaryPassenger)).toEqual([undefined, 'PASAJERO/DOS', undefined, undefined]);
  });
});

describe('queueFixtures: alias propios y firmas con su forma', () => {
  it('ninguna fixture repite un alias de otra', () => {
    const aliases = Object.entries(queueFixtures).map(
      ([name, fixture]) => [name, new Set(fixture.responses.flatMap((response) => response.body.match(/\bAA[A-Z]{4}\b/g) ?? []))] as const,
    );
    for (const [name, mine] of aliases) {
      for (const [other, theirs] of aliases) {
        if (other !== name) expect([...mine].filter((alias) => theirs.has(alias)), `${name} y ${other}`).toEqual([]);
      }
    }
  });

  it('no queda ninguna firma enmascarada entera (… XXXXXX X)', () => {
    for (const fixture of Object.values(queueFixtures)) {
      for (const response of fixture.responses) expect(response.body).not.toMatch(/9999\/99XXX99\s+XXXXXX\s+X\s*</);
    }
  });
});

describe('createQueueFake sembrado desde fixtures (criterio de #166)', () => {
  it('junta walk y place en un fake y se recorre como en producción', async () => {
    const fake = createQueueFake({
      queues: { '9': queueFakePnrs(queueFixtures.walk), '50': [] },
      pnrs: queueFakePnrs(queueFixtures.place),
    });
    const client = legacy(fake.fetch);

    const listed = await client.withSession((session) => session.queue.list({ queue: 9 }));
    expect(listed.locators).toEqual(['AAAAAA', 'AAAAAB', 'AAAAAC', 'AAAAAD']);
    expect(listed.entries[0]?.placedAt).toBe(queueFakePnrs(queueFixtures.walk)[0]?.placedAt);

    // place dentro de la cola: el fake saca el localizador del siguiente de su firma, que ahora es la de la fixture.
    const step = await client.withSession(async (session) => {
      await session.queue.access({ queue: 9 });
      return session.queue.place({ to: [{ queue: 50, instructionCode: 11 }] });
    });
    expect(step).toMatchObject({ done: false, kind: 'pnr', item: { locator: 'AAAAAB' } });
    expect(fake.locators(50)).toEqual(['AAAAAA']);

    await client.withSession((session) => session.queue.place({ to: [{ queue: 50, instructionCode: 11 }], locators: ['AAAAAE'] }));
    expect(fake.locators(50)).toEqual(['AAAAAA', 'AAAAAE']);
  });
});
