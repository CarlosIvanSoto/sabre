// El AAA de la sesión de scripts/validate-update-reservation.mjs (#272, Q-143), con una conexión
// falsa que registra el orden de las llamadas: sin Sabre.
import { describe, expect, it } from 'vitest';
import { createAnonymizer } from '../src/testing/anonymize.js';
import { createSessionContext } from '../scripts/lib/session-context.mjs';
import { createScrubber } from '../scripts/lib/update-reservation.mjs';

const PCC = 'P8AB';
const SEND = Symbol('sessionSend');
const OK_SCREEN = `${PCC}.H8GI*AWS.A\nNO MESSAGE..12NOV`;

interface FakeOptions {
  screen?: string;
  commandError?: Error;
}

/** Una sesión que anota cada llamada, con la forma que usa el script (`command`, `close`, `queue`, `reservation` y `sessionSend`). */
function fakeConn(order: string[], { screen = OK_SCREEN, commandError }: FakeOptions = {}) {
  const session = {
    command: async (command: string) => {
      order.push(`command ${command}`);
      if (commandError !== undefined) throw commandError;
      return { text: screen };
    },
    close: async () => {
      order.push('close');
    },
    queue: {
      list: async () => {
        order.push('queue.list');
        return { locators: [] };
      },
    },
    getReservation: async () => {
      order.push('getReservation');
      return {};
    },
    reservation: {
      confirmAirSegments: async () => {
        order.push('confirmAirSegments');
        return {};
      },
      removeAirSegments: async () => {
        order.push('removeAirSegments');
        return {};
      },
    },
    [SEND]: async () => {
      order.push('rawGet');
      return { raw: '' };
    },
  };
  return { session, send: SEND };
}
type Conn = ReturnType<typeof fakeConn>;

const step = async (_name: string, run: () => Promise<unknown>) => {
  try {
    return { value: await run() };
  } catch (error) {
    return { error };
  }
};

function setup(plan: { sessionPcc?: string }, extra: { watch?: (values: string[]) => void } = {}) {
  const logged: string[] = [];
  const errors: string[] = [];
  let failed = 0;
  const context = createSessionContext({
    plan: { ...plan, sessionPccLabel: 'SABRE_TARGET_PCC' },
    step,
    secrets: [PCC],
    fail: () => {
      failed += 1;
    },
    log: { log: (m: string) => logged.push(m), error: (m: string) => errors.push(m) },
    ...extra,
  });
  return { context, logged, errors, failed: () => failed };
}

/** Lo que hace cada paso del script con la sesión: sus lecturas y escrituras. */
const BODIES: Record<string, (conn: Conn) => Promise<void>> = {
  scan: async ({ session }) => {
    await session.queue.list();
    await session[SEND]();
  },
  read: async ({ session }) => {
    await session.queue.list();
    await session[SEND]();
    await session.getReservation();
  },
  confirm: async ({ session }) => {
    await session.reservation.confirmAirSegments();
  },
  remove: async ({ session }) => {
    await session.reservation.removeAirSegments();
  },
};
const READS_AND_WRITES = ['queue.list', 'rawGet', 'getReservation', 'confirmAirSegments', 'removeAirSegments'];

describe('createSessionContext: el AAA va antes de cualquier lectura o escritura', () => {
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: command('AAA…') primero, después el cuerpo, y close al final`, async () => {
      const order: string[] = [];
      const conn = fakeConn(order);
      const { context, failed } = setup({ sessionPcc: PCC });
      const result = await context.runInContext(conn, () => body(conn));
      expect(result.entered).toBe(true);
      expect(order[0]).toBe(`command AAA${PCC}`);
      expect(order.at(-1)).toBe('close');
      expect(order.filter((call) => call.startsWith('command'))).toEqual([`command AAA${PCC}`]);
      expect(order.length).toBeGreaterThan(2);
      expect(failed()).toBe(0);
      expect(context.aaa).toMatchObject({ sent: true, ok: true });
    });
  }
});

describe('createSessionContext: si el AAA no se confirma, no se lee ni se escribe', () => {
  const failures: Array<[string, FakeOptions, RegExp]> = [
    ['el comando falla', { commandError: new Error('timeout') }, /el AAA falló/],
    ['la pantalla es un error', { screen: 'NOT AUTHORIZED FOR PCC' }, /error: NOT AUTHORIZED/],
    ['el host quedó en otro PCC', { screen: 'H8GI.H8GI*AWS.A' }, /quedó en H8GI, no en P8AB/],
    ['la pantalla vino vacía', { screen: '' }, /vacía/],
    ['la pantalla no se reconoce', { screen: 'CHANGED TO P8AB' }, /primera línea/],
  ];
  for (const [why, options, message] of failures) {
    for (const [name, body] of Object.entries(BODIES)) {
      it(`${name}: ${why}`, async () => {
        const order: string[] = [];
        const conn = fakeConn(order, options);
        const { context, errors, failed } = setup({ sessionPcc: PCC });
        let ran = false;
        const result = await context.runInContext(conn, async () => {
          ran = true;
          await body(conn);
        });
        expect(result.entered).toBe(false);
        expect(ran).toBe(false);
        expect(order).toEqual([`command AAA${PCC}`, 'close']);
        expect(order.filter((call) => READS_AND_WRITES.includes(call))).toEqual([]);
        expect(failed()).toBe(1);
        expect(context.aaa.ok).toBe(false);
        expect(errors.join('\n')).toMatch(message);
        expect(errors.join('\n')).toMatch(/No se leyó ni se escribió nada/);
      });
    }
  }

  it('cierra la sesión también si el cuerpo lanza', async () => {
    const order: string[] = [];
    const conn = fakeConn(order);
    const { context } = setup({ sessionPcc: PCC });
    await expect(context.runInContext(conn, async () => Promise.reject(new Error('falló la lectura')))).rejects.toThrow('falló la lectura');
    expect(order).toEqual([`command AAA${PCC}`, 'close']);
  });
});

describe('createSessionContext: sin SABRE_SESSION_PCC', () => {
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: no se manda ningún command`, async () => {
      const order: string[] = [];
      const conn = fakeConn(order);
      const { context, failed } = setup({});
      const result = await context.runInContext(conn, () => body(conn));
      expect(result.entered).toBe(true);
      expect(order.some((call) => call.startsWith('command'))).toBe(false);
      expect(order.at(-1)).toBe('close');
      expect(failed()).toBe(0);
      expect(context.aaa).toEqual({ sent: false, ok: null, screen: undefined });
    });
  }
});

describe('createSessionContext: la pantalla del AAA no filtra el home ni la sine (M-1)', () => {
  const SCREEN = `${PCC}.H8GI*AWS.A\nNO MESSAGE..12NOV\nANTES H7QZ.K2LM*JDOE.B`;
  const LOOSE = `${SCREEN}\nCON HOME H8GI Y SINE AWS`;

  it('la fixture anonimizada pasa por los dos chequeos de fugas', async () => {
    const anonymizer = createAnonymizer({ secrets: [PCC] });
    const scrub = createScrubber({ aliasOf: anonymizer.aliasOf, secrets: [PCC] });
    const order: string[] = [];
    const conn = fakeConn(order, { screen: SCREEN });
    const { context } = setup({ sessionPcc: PCC }, { watch: (values) => scrub.addNames(values, 'AAA') });
    await context.runInContext(conn, async () => undefined);

    // El home y la sine reales de la pantalla sí quedan vigilados...
    expect(scrub.leakDetails(SCREEN).map((leak) => leak.value).sort()).toEqual(['AWS', 'H8GI', 'H7QZ', 'JDOE', 'K2LM', PCC].sort());
    // ...y lo que se graba no trae ninguno.
    const text = JSON.stringify({ findings: { q143: { screen: context.aaa.screen } } });
    expect(context.aaa.screen).toContain('XXXX.XXXX*AAA.A');
    expect(context.aaa.screen).toContain('XXXX.XXXX*AAA.B');
    expect(scrub.leakDetails(text)).toEqual([]);
    expect(anonymizer.leaks(text)).toEqual([]);
  });

  it('una línea de la pantalla que no tiene la forma y trae el home sí se detecta como fuga', async () => {
    const scrub = createScrubber({ aliasOf: (value: string) => value, secrets: [PCC] });
    const conn = fakeConn([], { screen: LOOSE });
    const { context } = setup({ sessionPcc: PCC }, { watch: (values) => scrub.addNames(values, 'AAA') });
    await context.runInContext(conn, async () => undefined);
    // «CON HOME H8GI Y SINE AWS» no tiene la forma: la máscara por forma no la toca, el chequeo de fugas sí.
    expect(scrub.leakDetails(JSON.stringify({ screen: context.aaa.screen })).map((leak) => leak.value).sort()).toEqual(['AWS', 'H8GI']);
  });

  it('una sine AAA (ya anonimizada) no se vigila', async () => {
    const seen: string[][] = [];
    const conn = fakeConn([], { screen: `${PCC}.H8GI*AAA.A` });
    const { context } = setup({ sessionPcc: PCC }, { watch: (values) => seen.push(values) });
    await context.runInContext(conn, async () => undefined);
    expect(seen).toEqual([[PCC, 'H8GI']]);
  });
});
