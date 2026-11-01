import { describe, expect, it, vi } from 'vitest';
import { SabreBusinessError, SabreGatewayError } from '../src/index.js';
import { queueListPayload } from '../src/queue/queue-list.js';
import { mockFetch } from './helpers.js';
import { entry, legacyClient, queueRS, rejection, sentBody, sessionOpened, soap, success, xml } from './soap-helpers.js';

const END = 'END OF DISPLAY FOR REQUESTED DATA';

/** `Line` como el del design 2.1.1 (`Number`, `DateTime`, `Group`, `PassengerName`, `POS`, `UniqueID`). */
const DESIGN_LIST = queueRS(
  success,
  '<Line Number="1"><DateTime>12-21T07:00</DateTime><Group>1</Group><PassengerName>CLARK/JAMIE</PassengerName><POS><Source AgentSine="AWS" PseudoCityCode="IPCC1"/></POS><UniqueID ID="ABC123"/></Line><Line Number="2"><DateTime>12-22T08:30</DateTime><PassengerName>SMITH/ANN</PassengerName><POS><Source AgentSine="SABRE" PseudoCityCode="IPCC1"/></POS><UniqueID ID="DEF456"/></Line><Paragraph><Text>QUEUE LIST FOR IPCC1  QUEUE 200</Text></Paragraph>',
);

/**
 * La forma de la respuesta real de `1.0.8` con `List` (wiki/sources/sabre-legacy-client-1-0-8.md):
 * un `Line` por PNR con `Number`, `DateTime` con año, `PassengerName`, `POS/Source` y `UniqueID`, y
 * la cabecera en el `Paragraph`. Datos inventados.
 */
const REAL_LIST = queueRS(
  success,
  '<Line Number="1"><DateTime>2025-02-28T16:48</DateTime><PassengerName>PEREZ/JUAN</PassengerName><POS><Source AgentSine="AB1" PseudoCityCode="H8GI"/></POS><UniqueID ID="QWERTY"/></Line><Paragraph><Text>QUEUE LIST FOR H8GI  QUEUE 12</Text></Paragraph>',
);

const ok = (payload: string) => xml(200, soap(payload));

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const session = await legacyClient(fetch).client.openSession();
  return { fetch, session };
}

const body = (fetch: ReturnType<typeof mockFetch>, call: number) =>
  /<soap-env:Body>(.*)<\/soap-env:Body>/.exec(sentBody(fetch, call))?.[1];

describe('queue.list: request', () => {
  it('manda QueueIdentifier con List Ind, como el sample Q/IPCC1200/L', async () => {
    const { fetch, session } = await openWith(ok(DESIGN_LIST));
    await session.queue.list({ queue: 200 });
    expect(body(fetch, 1)).toBe(
      '<QueueAccessRQ Version="2.1.1" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><QueueIdentifier Number="200" PseudoCityCode="H8GI"><List Ind="true"/></QueueIdentifier></QueueAccessRQ>',
    );
  });

  it('con primaryPassenger manda PrimaryPassenger, como el sample Q/IPCC1200/LN', async () => {
    const { fetch, session } = await openWith(ok(DESIGN_LIST));
    await session.queue.list({ queue: 200, pcc: 'IPC1', primaryPassenger: true });
    expect(body(fetch, 1)).toContain('<QueueIdentifier Number="200" PseudoCityCode="IPC1"><List Ind="true" PrimaryPassenger="true"/></QueueIdentifier>');
  });

  it('con { name } manda Name', () => {
    expect(queueListPayload({ name: 'S' }, 'ABCD', false)).toContain('<QueueIdentifier Name="S" PseudoCityCode="ABCD">');
  });

  it.each([
    ['una cola inválida', { queue: 999 }, 'sabre-client: queue debe ser un número de cola entero de 0 a 511, o { name }'],
    ['un pcc inválido', { queue: 1, pcc: '!!' }, 'sabre-client: pcc debe tener 3 o 4 caracteres alfanuméricos'],
    ['primaryPassenger que no es boolean', { queue: 1, primaryPassenger: 'yes' }, 'sabre-client: primaryPassenger debe ser un boolean'],
  ])('%s lanza TypeError sin red', async (_name, request, message) => {
    const { fetch, session } = await openWith();
    expect(await rejection(session.queue.list(request as never))).toEqual(new TypeError(message));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('es idempotente: se reintenta ante un fallo de red', async () => {
    const { fetch, session } = await openWith(new TypeError('fetch failed'), ok(REAL_LIST));
    const result = await session.queue.list({ queue: 12 }, { retry: { maxRetries: 1, baseDelayMs: 0 } });
    expect(result.locators).toEqual(['QWERTY']);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('entrega la respuesta cruda como queue.list', async () => {
    const onRawResponse = vi.fn();
    const { session } = await openWith(ok(REAL_LIST));
    await session.queue.list({ queue: 12 }, { onRawResponse });
    expect(onRawResponse.mock.calls[0]?.[0]).toMatchObject({ operation: 'queue.list' });
  });
});

describe('queue.list: respuesta', () => {
  it('lee los Line del design en locators y entries', async () => {
    const { session } = await openWith(ok(DESIGN_LIST));
    expect(await session.queue.list({ queue: 200 })).toEqual({
      locators: ['ABC123', 'DEF456'],
      entries: [
        {
          position: 1,
          locator: 'ABC123',
          placedAt: '12-21T07:00',
          placedBy: { agentSine: 'AWS', pseudoCityCode: 'IPCC1' },
          primaryPassenger: 'CLARK/JAMIE',
          group: '1',
        },
        {
          position: 2,
          locator: 'DEF456',
          placedAt: '12-22T08:30',
          placedBy: { agentSine: 'SABRE', pseudoCityCode: 'IPCC1' },
          primaryPassenger: 'SMITH/ANN',
        },
      ],
      paragraph: ['QUEUE LIST FOR IPCC1  QUEUE 200'],
      warnings: [],
    });
  });

  it('lee la forma de la respuesta real, con DateTime con año', async () => {
    const { session } = await openWith(ok(REAL_LIST));
    const result = await session.queue.list({ queue: 12 });
    expect(result.entries).toEqual([
      {
        position: 1,
        locator: 'QWERTY',
        placedAt: '2025-02-28T16:48',
        placedBy: { agentSine: 'AB1', pseudoCityCode: 'H8GI' },
        primaryPassenger: 'PEREZ/JUAN',
      },
    ]);
    expect(result.paragraph).toEqual(['QUEUE LIST FOR H8GI  QUEUE 12']);
  });

  it.each([
    ['primera línea del Paragraph', queueRS(success, `<Paragraph><Text>${END}</Text></Paragraph>`)],
    ['stl:Warning', queueRS(`${success}${entry('Warning', 'WARN.SWS.HOST.WARNING_RETURNED', END)}`)],
    ['stl:Error', queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', END))],
  ])('una cola vacía (fin de cola como %s) da una lista vacía', async (_place, payload) => {
    const { session } = await openWith(ok(payload));
    expect(await session.queue.list({ queue: 12 })).toMatchObject({ locators: [], entries: [] });
  });

  it('un Line sin UniqueID es un SabreGatewayError', async () => {
    const { session } = await openWith(ok(queueRS(success, '<Line Number="1"><DateTime>2025-02-28T16:48</DateTime></Line>')));
    expect(await rejection(session.queue.list({ queue: 12 }))).toBeInstanceOf(SabreGatewayError);
  });

  it('QUEUE SELECTED NOT VALID OR CLOSED es un SabreBusinessError', async () => {
    const { session } = await openWith(ok(queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'QUEUE SELECTED NOT VALID OR CLOSED'))));
    expect(await rejection(session.queue.list({ queue: 12 }))).toBeInstanceOf(SabreBusinessError);
  });

  it('no cambia el estado de la sesión, ni con un error', async () => {
    const { session } = await openWith(ok(REAL_LIST), new TypeError('fetch failed'));
    await session.queue.list({ queue: 12 });
    expect(session.queue.state).toBe('outside');
    await rejection(session.queue.list({ queue: 12 }));
    expect(session.queue.state).toBe('outside');
  });
});
