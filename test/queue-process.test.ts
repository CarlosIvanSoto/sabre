import { describe, expect, it, vi } from 'vitest';
import { SabreBusinessError, SabreGatewayError, type SabreSession, SabreSessionError } from '../src/index.js';
import type { QueueProcessAction } from '../src/queue/queue-management.js';
import { mockFetch } from './helpers.js';
import { entry, fault, legacyClient, queueRS, rejection, sentBody, sentTag, sessionOpened, soap, success, xml } from './soap-helpers.js';

const END = 'END OF DISPLAY FOR REQUESTED DATA';

const item = (locator: string) =>
  queueRS(success, `<Line><UniqueID ID="${locator}"/></Line><Paragraph><Text>011  SEE REMARKS</Text></Paragraph>`);
const placed = (locator: string) =>
  `<QueuePlaceRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" xmlns:stl="http://services.sabre.com/STL/v01" Version="2.0.4"><stl:ApplicationResults status="Complete">${success}</stl:ApplicationResults><Text>1.1PEREZ/JUAN</Text><Text>H8GI.H8GI*AB1 1230/18FEB25 ${locator} H</Text></QueuePlaceRS>`;
const end = queueRS(success, `<Paragraph><Text>${END}</Text></Paragraph>`);
const exited = queueRS(success);

const ok = (payload: string) => xml(200, soap(payload));

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const { client, calls } = legacyClient(fetch);
  const session = await client.openSession();
  return { fetch, session, calls };
}

/** La acción de navegación de cada llamada después de abrir la sesión. */
function sent(fetch: ReturnType<typeof mockFetch>): string[] {
  return fetch.mock.calls.slice(1).map((_call, index) => {
    const envelope = sentBody(fetch, index + 1);
    const action = /<Navigation Action="(\w+)"/.exec(envelope)?.[1];
    if (action !== undefined) return action;
    return sentTag(envelope, 'eb:Action') === 'QueuePlaceLLSRQ' ? 'QP' : 'Q';
  });
}

describe('queue.process', () => {
  it('recorre la cola hasta el fin, con cada acción del callback', async () => {
    const { fetch, session } = await openWith(ok(item('AAA111')), ok(item('BBB222')), ok(placed('CCC333')), ok(end));
    const actions: QueueProcessAction[] = [
      { action: 'remove' },
      { action: 'place', to: [{ queue: 50, instructionCode: 11 }] },
      { action: 'ignore' },
    ];
    const seen: string[] = [];
    const result = await session.queue.process({ queue: 12 }, async (current) => {
      seen.push(current.locator);
      return actions[seen.length - 1]!;
    });

    expect(result).toEqual({ visited: 3, ended: 'end-of-display' });
    expect(seen).toEqual(['AAA111', 'BBB222', 'CCC333']);
    expect(sent(fetch)).toEqual(['Q', 'QR', 'QP', 'I']);
    expect(sentBody(fetch, 3)).toContain('<QueueIdentifier Number="50" PrefatoryInstructionCode="11" PseudoCityCode="H8GI"/>');
    expect(session.queue.state).toBe('outside');
  });

  it('con la cola vacía no llama al callback', async () => {
    const callback = vi.fn();
    const { session } = await openWith(ok(end));
    expect(await session.queue.process({ queue: 12 }, callback)).toEqual({ visited: 0, ended: 'end-of-display' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('pasa queue, pcc y selection a access', async () => {
    const { fetch, session } = await openWith(ok(end));
    await session.queue.process({ queue: 12, pcc: 'ABCD', selection: [{ function: 'AL', criteria: 'DL' }] }, () => ({ action: 'ignore' }));
    expect(sentBody(fetch, 1)).toContain('<QueueIdentifier Number="12" PseudoCityCode="ABCD"/><Selection Function="AL" Criteria="DL"/>');
  });

  it('al llegar a limit sale con QXI', async () => {
    const { fetch, session } = await openWith(ok(item('AAA111')), ok(item('BBB222')), ok(item('CCC333')), ok(exited));
    const result = await session.queue.process({ queue: 12, limit: 2 }, () => ({ action: 'ignore' }));
    expect(result).toEqual({ visited: 2, ended: 'limit' });
    expect(sent(fetch)).toEqual(['Q', 'I', 'I', 'QXI']);
    expect(session.queue.state).toBe('outside');
  });

  it('si el fin de cola llega justo en limit, termina por el fin de cola, sin QXI', async () => {
    const { fetch, session } = await openWith(ok(item('AAA111')), ok(end));
    expect(await session.queue.process({ queue: 12, limit: 1 }, () => ({ action: 'remove' }))).toEqual({
      visited: 1,
      ended: 'end-of-display',
    });
    expect(sent(fetch)).toEqual(['Q', 'QR']);
  });

  it('si el callback lanza, sale con QXI y propaga el error', async () => {
    const { fetch, session } = await openWith(ok(item('AAA111')), ok(exited));
    const boom = new Error('regla del consumidor');
    expect(
      await rejection(
        session.queue.process({ queue: 12 }, () => {
          throw boom;
        }),
      ),
    ).toBe(boom);
    expect(sent(fetch)).toEqual(['Q', 'QXI']);
    expect(session.queue.state).toBe('outside');
  });

  it('si el callback devuelve una acción inválida, sale con QXI y lanza TypeError', async () => {
    const { fetch, session } = await openWith(ok(item('AAA111')), ok(exited));
    const error = await rejection(session.queue.process({ queue: 12 }, () => 'ignore' as never));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/debe devolver \{ action: 'remove' \}/);
    expect(sent(fetch)).toEqual(['Q', 'QXI']);
  });

  it('si el callback lanza y el QXI falla, propaga el error del callback y emite un warn', async () => {
    const { session, calls } = await openWith(ok(item('AAA111')), new TypeError('fetch failed'));
    const boom = new Error('regla del consumidor');
    expect(
      await rejection(
        session.queue.process({ queue: 12 }, () => {
          throw boom;
        }),
      ),
    ).toBe(boom);
    expect(calls.some(([level, message]) => level === 'warn' && message === 'sabre.queue.exitFailed')).toBe(true);
    expect(session.queue.state).toBe('unknown');
  });

  it('un error de Sabre deja unknown; sale con QXI tolerando "no estás en una cola" y propaga el error', async () => {
    const restricted = queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'RESTRICTED PNR'));
    const notOnQueue = queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'NOT ON QUEUE'));
    const { fetch, session } = await openWith(ok(item('AAA111')), ok(restricted), ok(notOnQueue));
    const error = await rejection(session.queue.process({ queue: 12 }, () => ({ action: 'remove' })));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect((error as Error).message).toBe('queueAccess: RESTRICTED PNR');
    expect(sent(fetch)).toEqual(['Q', 'QR', 'QXI']);
    expect(session.queue.state).toBe('outside');
  });

  it('un fallo de red en access deja unknown, sale con QXI y propaga el error', async () => {
    const { fetch, session } = await openWith(new TypeError('fetch failed'), ok(exited));
    expect(await rejection(session.queue.process({ queue: 12 }, () => ({ action: 'ignore' })))).toBeInstanceOf(SabreGatewayError);
    expect(sent(fetch)).toEqual(['Q', 'QXI']);
    expect(session.queue.state).toBe('outside');
  });

  it('un error de negocio en access, afuera, no manda QXI', async () => {
    const notValid = queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'QUEUE SELECTED NOT VALID OR CLOSED'));
    const { fetch, session } = await openWith(ok(notValid));
    expect(await rejection(session.queue.process({ queue: 12 }, () => ({ action: 'ignore' })))).toBeInstanceOf(SabreBusinessError);
    expect(sent(fetch)).toEqual(['Q']);
  });

  it('con un SabreSessionError no intenta salir', async () => {
    const { fetch, session } = await openWith(
      ok(item('AAA111')),
      xml(500, soap(fault('soap-env:Client.InvalidSecurityToken', 'USG_INVALID_SESSION'))),
    );
    expect(await rejection(session.queue.process({ queue: 12 }, () => ({ action: 'ignore' })))).toBeInstanceOf(SabreSessionError);
    expect(sent(fetch)).toEqual(['Q', 'I']);
  });

  it('dentro de una cola del consumidor lanza TypeError sin red y no la saca de ella', async () => {
    const { fetch, session } = await openWith(ok(item('AAA111')));
    await session.queue.access({ queue: 12 });
    expect(await rejection(session.queue.process({ queue: 13 }, () => ({ action: 'ignore' })))).toBeInstanceOf(TypeError);
    expect(sent(fetch)).toEqual(['Q']);
    expect(session.queue.state).toBe('inside');
  });

  it.each([
    ['limit 0', { queue: 12, limit: 0 }, 'sabre-client: limit debe ser un entero mayor o igual a 1'],
    ['limit no entero', { queue: 12, limit: 1.5 }, 'sabre-client: limit debe ser un entero mayor o igual a 1'],
    ['una cola inválida', { queue: -1 }, 'sabre-client: queue debe ser un número de cola entero de 0 a 511, o { name }'],
  ])('%s lanza TypeError sin red', async (_name, request, message) => {
    const { fetch, session } = await openWith();
    expect(await rejection(session.queue.process(request, () => ({ action: 'ignore' })))).toEqual(new TypeError(message));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sin callback lanza TypeError sin red', async () => {
    const { session } = await openWith();
    expect(await rejection((session as SabreSession).queue.process({ queue: 12 }, undefined as never))).toEqual(
      new TypeError('sabre-client: queue.process necesita un callback'),
    );
  });

  it('aplica options a cada llamada del recorrido', async () => {
    const onRawResponse = vi.fn();
    const { session } = await openWith(ok(item('AAA111')), ok(end));
    await session.queue.process({ queue: 12 }, () => ({ action: 'ignore' }), { onRawResponse });
    expect(onRawResponse.mock.calls.map(([raw]) => raw.operation)).toEqual(['queue.access', 'queue.ignore']);
  });
});
