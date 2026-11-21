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

function setup(plan: { sessionPcc?: string; sessionContext?: string }, extra: { watch?: (values: string[]) => void; watchToken?: (token: string) => void; show?: (text: string) => string } = {}) {
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
      expect(context.aaa).toEqual({ sent: false, ok: null, screen: undefined, context: 'aaa', tokenUpdated: false, cpaIdChanged: false });
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

// ---------- ContextChangeLLSRQ (context-change y context-change-cpaid) ----------

const SECURITY = Symbol('sessionSecurity');
const TOKEN_1 = 'Shared/IDL:IceSess\\/SessMgr:1\\.0.IDL/Common/!ICESMS\\/STSB!1769772916289!4392!517!1';
const TOKEN_2 = 'Shared/IDL:IceSess\\/SessMgr:1\\.0.IDL/Common/!ICESMS\\/STSB!1769772916289!4392!517!2';
const CHANGED = { ApplicationResults: { '@status': 'Complete' }, SecurityToken: { '@Updated': 'true', '#text': TOKEN_2 }, Text: [`${PCC}.H8GI*AWS.A`, 'NO MESSAGE..30JAN'] };

interface ChangeOptions {
  payload?: Record<string, unknown>;
  sendError?: Error;
}

/** Una sesión que anota cada llamada con el token y el CPAId que lleva en ese momento, como los usa `#send`. */
function changeConn(order: string[], { payload = CHANGED, sendError }: ChangeOptions = {}) {
  const state = { token: TOKEN_1, cpaId: 'BX3' };
  const at = (call: string) => order.push(`${call} token=${state.token === TOKEN_1 ? 'viejo' : 'nuevo'} cpa=${state.cpaId}`);
  const requests: Array<Record<string, unknown>> = [];
  const session = {
    command: async (command: string) => {
      order.push(`command ${command}`);
      return { text: '' };
    },
    close: async () => at('close'),
    queue: { list: async () => (at('queue.list'), { locators: [] }) },
    getReservation: async () => (at('getReservation'), {}),
    reservation: {
      confirmAirSegments: async () => (at('confirmAirSegments'), {}),
      removeAirSegments: async () => (at('removeAirSegments'), {}),
    },
    [SEND]: async (request: Record<string, unknown>) => {
      requests.push(request);
      if (request.action === 'ContextChangeLLSRQ') {
        at('contextChange');
        if (sendError !== undefined) throw sendError;
        return { payload, raw: '' };
      }
      at('rawGet');
      return { raw: '' };
    },
    [SECURITY]: (change: { token?: string; cpaId?: string }) => {
      order.push(`security ${Object.keys(change).join(',')}`);
      if (change.token !== undefined) state.token = change.token;
      if (change.cpaId !== undefined) state.cpaId = change.cpaId;
    },
  };
  return { session, send: SEND, security: SECURITY, requests, state };
}
type ChangeConn = ReturnType<typeof changeConn>;

const CHANGE_BODIES: Record<string, (conn: ChangeConn) => Promise<void>> = {
  scan: async ({ session }) => {
    await session.queue.list();
    await session[SEND]({ action: 'GetReservationRQ' });
  },
  read: async ({ session }) => {
    await session.queue.list();
    await session[SEND]({ action: 'GetReservationRQ' });
    await session.getReservation();
  },
  confirm: async ({ session }) => {
    await session.reservation.confirmAirSegments();
  },
  remove: async ({ session }) => {
    await session.reservation.removeAirSegments();
  },
};
const VARIANTS = ['context-change', 'context-change-cpaid'] as const;
const planOf = (sessionContext: string) => ({ sessionPcc: PCC, sessionContext });

describe('createSessionContext: ContextChangeLLSRQ va antes de cualquier lectura o escritura', () => {
  for (const variant of VARIANTS) {
    for (const [name, body] of Object.entries(CHANGE_BODIES)) {
      it(`${variant} · ${name}: cambio de contexto primero, el token nuevo en lo siguiente y en close`, async () => {
        const order: string[] = [];
        const conn = changeConn(order);
        const { context, failed } = setup(planOf(variant));
        const result = await context.runInContext(conn, () => body(conn));
        expect(result.entered).toBe(true);
        expect(order[0]).toMatch(/^contextChange token=viejo cpa=BX3$/);
        expect(order.some((call) => call.startsWith('command'))).toBe(false);
        // Después del cambio, ningún request con el token viejo: ni lo que lee ni close.
        const after = order.slice(order.findIndex((call) => call.startsWith('security')) + 1);
        expect(after.length).toBeGreaterThan(1);
        expect(after.filter((call) => call.includes('token=viejo'))).toEqual([]);
        expect(order.at(-1)).toMatch(/^close token=nuevo/);
        expect(failed()).toBe(0);
        expect(context.aaa).toMatchObject({ sent: true, ok: true, tokenUpdated: true, context: variant });
      });
    }

    it(`${variant}: el request es ContextChangeLLSRQ 2.0.3 hacia el PCC destino, sin reintento`, async () => {
      const conn = changeConn([]);
      const { context } = setup(planOf(variant));
      await context.runInContext(conn, async () => undefined);
      expect(conn.requests).toHaveLength(1);
      expect(conn.requests[0]).toMatchObject({ action: 'ContextChangeLLSRQ', idempotent: false });
      expect(conn.requests[0]?.payload).toBe(`<ContextChangeRQ ReturnHostCommand="true" Version="2.0.3" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><ChangeAAA PseudoCityCode="${PCC}"/></ContextChangeRQ>`);
      // Sin hooks de grabación: la respuesta trae el token nuevo.
      expect(Object.keys(conn.requests[0] ?? {}).filter((key) => key.startsWith('on'))).toEqual([]);
    });
  }

  it('el CPAId cambia al PCC destino solo en context-change-cpaid', async () => {
    const plain = changeConn([]);
    await setup(planOf('context-change')).context.runInContext(plain, async () => undefined);
    expect(plain.state.cpaId).toBe('BX3');

    const order: string[] = [];
    const withCpa = changeConn(order);
    const { context } = setup(planOf('context-change-cpaid'));
    await context.runInContext(withCpa, () => CHANGE_BODIES.read!(withCpa));
    expect(withCpa.state.cpaId).toBe(PCC);
    expect(order.find((call) => call.startsWith('queue.list'))).toBe(`queue.list token=nuevo cpa=${PCC}`);
    expect(order.at(-1)).toBe(`close token=nuevo cpa=${PCC}`);
    expect(context.aaa).toMatchObject({ tokenUpdated: true, cpaIdChanged: true });
    expect(plain.state.token).toBe(TOKEN_2);
  });

  it('sin SecurityToken Updated no se cambia el token', async () => {
    const order: string[] = [];
    const conn = changeConn(order, { payload: { ...CHANGED, SecurityToken: undefined } });
    const { context } = setup(planOf('context-change'));
    await context.runInContext(conn, () => CHANGE_BODIES.scan!(conn));
    expect(order.some((call) => call.startsWith('security'))).toBe(false);
    expect(conn.state.token).toBe(TOKEN_1);
    expect(context.aaa).toMatchObject({ ok: true, tokenUpdated: false });
  });
});

describe('createSessionContext: si el cambio de contexto no se confirma, no se lee ni se escribe', () => {
  const failures: Array<[string, ChangeOptions, RegExp]> = [
    ['ApplicationResults no Complete', { payload: { ...CHANGED, ApplicationResults: { '@status': 'NotProcessed' } } }, /no está Complete \(NotProcessed\)/],
    ['sin ApplicationResults', { payload: { ...CHANGED, ApplicationResults: undefined } }, /sin status/],
    ['el Text empieza con otro PCC', { payload: { ...CHANGED, Text: ['H8GI.H8GI*AWS.A'] } }, /el Text no empieza con P8AB/],
    ['sin Text', { payload: { ...CHANGED, Text: undefined } }, /no trae Text/],
    ['la llamada falla', { sendError: new Error('timeout') }, /el cambio de contexto falló/],
  ];
  for (const variant of VARIANTS) {
    for (const [why, options, message] of failures) {
      for (const [name, body] of Object.entries(CHANGE_BODIES)) {
        it(`${variant} · ${name}: ${why}`, async () => {
          const order: string[] = [];
          const conn = changeConn(order, options);
          const { context, errors, failed } = setup(planOf(variant));
          let ran = false;
          const result = await context.runInContext(conn, async () => {
            ran = true;
            await body(conn);
          });
          expect(result.entered).toBe(false);
          expect(ran).toBe(false);
          expect(order.filter((call) => /^(queue\.list|rawGet|getReservation|confirmAirSegments|removeAirSegments)/.test(call))).toEqual([]);
          expect(order[0]).toMatch(/^contextChange/);
          expect(order.at(-1)).toMatch(/^close/);
          expect(failed()).toBe(1);
          expect(context.aaa.ok).toBe(false);
          expect(conn.state.cpaId).toBe('BX3');
          expect(errors.join('\n')).toMatch(message);
          expect(errors.join('\n')).toMatch(/No se leyó ni se escribió nada/);
        });
      }
    }
  }

  it('con token nuevo pero sin confirmar, el close igual usa el token nuevo y el CPAId no cambia', async () => {
    const order: string[] = [];
    const conn = changeConn(order, { payload: { ...CHANGED, Text: ['H8GI.H8GI*AWS.A'] } });
    const { context } = setup(planOf('context-change-cpaid'));
    await context.runInContext(conn, async () => undefined);
    expect(order).toEqual(['contextChange token=viejo cpa=BX3', 'security token', 'close token=nuevo cpa=BX3']);
    expect(context.aaa).toMatchObject({ ok: false, tokenUpdated: true, cpaIdChanged: false });
  });

  it('sin el setter interno de la sesión no manda nada y aborta', async () => {
    const order: string[] = [];
    const conn = { ...changeConn(order), security: undefined };
    const { context, errors, failed } = setup(planOf('context-change'));
    const result = await context.runInContext(conn, async () => undefined);
    expect(result.entered).toBe(false);
    expect(order.some((call) => call.startsWith('contextChange'))).toBe(false);
    expect(failed()).toBe(1);
    expect(errors.join('\n')).toMatch(/sessionSecurity/);
  });
});

describe('createSessionContext: el token nuevo es un secreto y la evidencia de q143 no lo trae', () => {
  it('no se imprime, no sale en aaa ni en evidence, y watchToken lo recibe', async () => {
    const watched: string[] = [];
    const conn = changeConn([]);
    const { context, logged, errors } = setup(planOf('context-change-cpaid'), { watchToken: (token) => watched.push(token) });
    await context.runInContext(conn, async () => undefined);
    expect(watched).toEqual([TOKEN_2]);
    const everything = JSON.stringify({ logged, errors, aaa: context.aaa, evidence: context.evidence('ok') });
    expect(everything).not.toContain('IceSess');
    expect(everything).not.toContain('STSB');
    expect(logged.join('\n')).toMatch(/token nuevo: sí/);
  });

  it('evidence graba la variante, el token nuevo (sí/no), el CPAId y el resultado', async () => {
    const { context } = setup(planOf('context-change-cpaid'));
    await context.runInContext(changeConn([]), async () => undefined);
    expect(context.evidence('700102')).toEqual({
      context: 'context-change-cpaid',
      aaaSent: true,
      aaaOk: true,
      screen: 'XXXX.XXXX*AAA.A\nNO MESSAGE..30JAN',
      newToken: true,
      cpaIdChanged: true,
      readAfterAaa: '700102',
    });
    const aaaOnly = setup({ sessionPcc: PCC });
    await aaaOnly.context.runInContext(fakeConn([]), async () => undefined);
    expect(aaaOnly.context.evidence('ok')).toMatchObject({ context: 'aaa', newToken: false, cpaIdChanged: false, readAfterAaa: 'ok' });
  });

  it('la pantalla del cambio pasa por los chequeos de fugas igual que la del AAA', async () => {
    const anonymizer = createAnonymizer({ secrets: [PCC] });
    const scrub = createScrubber({ aliasOf: anonymizer.aliasOf, secrets: [PCC] });
    const { context } = setup(planOf('context-change'), { watch: (values) => scrub.addNames(values, 'AAA') });
    await context.runInContext(changeConn([]), async () => undefined);
    expect(scrub.leakDetails(`${PCC}.H8GI*AWS.A`).map((leak) => leak.value).sort()).toEqual(['AWS', 'H8GI', PCC].sort());
    const text = JSON.stringify({ findings: { q143: context.evidence('ok') } });
    expect(scrub.leakDetails(text)).toEqual([]);
    expect(anonymizer.leaks(text)).toEqual([]);
  });
});

// Revisión del PR #282, hallazgo 2: el mensaje de un error de Sabre puede traer el PCC real.
describe('createSessionContext: los mensajes de error pasan por show', () => {
  const show = (text: string) => text.replaceAll(PCC, 'P8');
  const leaky = new Error(`Viewership is restricted (PNR not created by ${PCC})`);

  it('el AAA que falla', async () => {
    const order: string[] = [];
    const conn = fakeConn(order, { commandError: leaky });
    const { context, errors } = setup({ sessionPcc: PCC }, { show });
    await context.runInContext(conn, async () => {});
    expect(errors.join('\n')).toMatch(/el AAA falló: .*not created by P8\)/);
    expect(errors.join('\n')).not.toContain(PCC);
  });

  it('el cambio de contexto que falla', async () => {
    for (const variant of VARIANTS) {
      const order: string[] = [];
      const conn = changeConn(order, { sendError: leaky });
      const { context, errors } = setup(planOf(variant), { show });
      await context.runInContext(conn, async () => {});
      expect(errors.join('\n'), variant).toMatch(/el cambio de contexto falló: .*not created by P8\)/);
      expect(errors.join('\n'), variant).not.toContain(PCC);
    }
  });
});
