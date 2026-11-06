import { describe, expect, it, vi } from 'vitest';
import { SabreBusinessError, SabreGatewayError, type SabreSession, SabreSessionError, SabreWarning } from '../src/index.js';
import { isEndOfDisplayResult, paragraphLines, queueAccessPayload } from '../src/queue/queue-access.js';
import { mockFetch } from './helpers.js';
import {
  entry,
  fault,
  hostError,
  legacyClient,
  queueRS,
  rejection,
  sentBody,
  sentTag,
  sessionOpened,
  soap,
  success,
  xml,
} from './soap-helpers.js';

const END = 'END OF DISPLAY FOR REQUESTED DATA';

/** Un PNR como el del design 2.1.1: `Line` completo y párrafo con sangría y líneas vacías. */
const DESIGN_ITEM = queueRS(
  success,
  `<Line Number="1"><DateTime>12-21T07:00</DateTime><Group>1</Group><PassengerName>CLARK/JAMIE</PassengerName><POS><Source AgentSine="AWS" PseudoCityCode="IPCC1"/></POS><UniqueID ID="ABC123"/></Line><Paragraph><Text>035  NO PIC CODE</Text><Text>011  SEE REMARKS</Text><Text/><Text>1.1TEST/SWS*FSG</Text><Text> 2.TK 0010914379913 TEST/B     SYSSYS</Text><Text>  1.DFW817-555-1212-B</Text><Text>A &amp; B</Text></Paragraph>`,
);

/**
 * La forma de la respuesta real de `1.0.8` al entrar a una cola (wiki/sources/sabre-legacy-client-1-0-8.md):
 * `Version="2.1.0"`, `DateTime` con año, `POS/Source` y `UniqueID`, sin `Group` ni `PassengerName`.
 * Valores anonimizados.
 */
const REAL_ITEM = (locator = 'QWERTY') =>
  `<QueueAccessRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" xmlns:stl="http://services.sabre.com/STL/v01" Version="2.1.0"><stl:ApplicationResults status="Complete">${success}</stl:ApplicationResults><Line Number="1"><DateTime>2024-05-15T13:24</DateTime><POS><Source AgentSine="AB1" PseudoCityCode="H8GI"/></POS><UniqueID ID="${locator}"/></Line><Paragraph><Text>011  SEE REMARKS</Text><Text>1.1PEREZ/JUAN</Text><Text>H8GI.H8GI*AB1 1230/15MAY24 ${locator} H</Text></Paragraph></QueueAccessRS>`;

const END_IN_PARAGRAPH = queueRS(success, `<Paragraph><Text>${END}</Text></Paragraph>`);
const END_IN_WARNING = queueRS(`${success}${entry('Warning', 'WARN.SWS.HOST.WARNING_RETURNED', END)}`);
const END_IN_ERROR = queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', END));
const NOT_VALID = queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'QUEUE SELECTED NOT VALID OR CLOSED', undefined, 'Application'));
const EXIT_OK = queueRS(success);

const ok = (payload: string) => xml(200, soap(payload));
const networkFailure = () => new TypeError('fetch failed');

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const { client, calls } = legacyClient(fetch);
  const session = await client.openSession();
  return { fetch, session, calls };
}

/** Una sesión que ya entró a una cola con un PNR. */
async function inside(...responses: Array<Response | Error>) {
  const opened = await openWith(ok(REAL_ITEM('FIRST1')), ...responses);
  await opened.session.queue.access({ queue: 12 });
  expect(opened.session.queue.state).toBe('inside');
  return opened;
}

/** Una sesión en `'unknown'`: entró a una cola y un `ignore` falló por la red. */
async function unknown(...responses: Array<Response | Error>) {
  const opened = await inside(networkFailure(), ...responses);
  await rejection(opened.session.queue.ignore());
  expect(opened.session.queue.state).toBe('unknown');
  return opened;
}

const body = (fetch: ReturnType<typeof mockFetch>, call: number) =>
  /<soap-env:Body>(.*)<\/soap-env:Body>/.exec(sentBody(fetch, call))?.[1];

describe('queue.access: request', () => {
  it('manda QueueAccessRQ 2.1.1 con la cola y el PCC de la sesión', async () => {
    const { fetch, session } = await openWith(ok(DESIGN_ITEM));
    await session.queue.access({ queue: 12 });
    expect(sentTag(sentBody(fetch, 1), 'eb:Action')).toBe('QueueAccessLLSRQ');
    expect(body(fetch, 1)).toBe(
      '<QueueAccessRQ Version="2.1.1" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><QueueIdentifier Number="12" PseudoCityCode="H8GI"/></QueueAccessRQ>',
    );
  });

  it('con { name } y pcc manda Name y ese PCC', async () => {
    const { fetch, session } = await openWith(ok(DESIGN_ITEM));
    await session.queue.access({ queue: { name: 'S' }, pcc: 'ABC1' });
    expect(body(fetch, 1)).toContain('<QueueIdentifier Name="S" PseudoCityCode="ABC1"/>');
  });

  it('manda los filtros de selection en orden, después de QueueIdentifier', async () => {
    const { fetch, session } = await openWith(ok(DESIGN_ITEM));
    await session.queue.access({
      queue: 0,
      selection: [
        { function: 'AL', criteria: 'DL' },
        { function: 'AC', criteria: 'HL' },
      ],
    });
    expect(body(fetch, 1)).toContain(
      '<QueueIdentifier Number="0" PseudoCityCode="H8GI"/><Selection Function="AL" Criteria="DL"/><Selection Function="AC" Criteria="HL"/></QueueAccessRQ>',
    );
  });

  it('escapa los filtros y el nombre de la cola', () => {
    expect(queueAccessPayload({ name: 'A"B' }, 'ABCD', [{ function: 'X&', criteria: '<1>' }])).toContain(
      '<QueueIdentifier Name="A&quot;B" PseudoCityCode="ABCD"/><Selection Function="X&amp;" Criteria="&lt;1&gt;"/>',
    );
  });

  it.each([
    ['una cola fuera de rango', { queue: 512 }, 'sabre-client: queue debe ser un número de cola entero de 0 a 511, o { name }'],
    ['una cola sin nombre', { queue: { name: '' } }, 'sabre-client: queue.name debe ser un string no vacío'],
    ['un pcc inválido', { queue: 1, pcc: 'X' }, 'sabre-client: pcc debe tener 3 o 4 caracteres alfanuméricos'],
    [
      'más de 8 filtros',
      { queue: 1, selection: Array.from({ length: 9 }, () => ({ function: 'AL', criteria: 'DL' })) },
      'sabre-client: selection admite hasta 8 filtros',
    ],
    ['selection que no es una lista', { queue: 1, selection: { function: 'AL' } }, 'sabre-client: selection debe ser una lista de { function, criteria }'],
    ['un filtro sin function', { queue: 1, selection: [{ criteria: 'DL' }] }, 'sabre-client: selection[0].function debe ser un string no vacío'],
    ['un filtro sin criteria', { queue: 1, selection: [{ function: 'AL', criteria: ' ' }] }, 'sabre-client: selection[0].criteria debe ser un string no vacío'],
  ])('%s lanza TypeError sin red', async (_name, request, message) => {
    const { fetch, session } = await openWith();
    const error = await rejection(session.queue.access(request as never));
    expect(error).toEqual(new TypeError(message));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.queue.state).toBe('outside');
  });

  it('acepta 8 filtros', async () => {
    const { session } = await openWith(ok(DESIGN_ITEM));
    const selection = Array.from({ length: 8 }, () => ({ function: 'AL', criteria: 'DL' }));
    await expect(session.queue.access({ queue: 1, selection })).resolves.toMatchObject({ done: false });
  });

  it('entrega la respuesta cruda como queue.access', async () => {
    const onRawResponse = vi.fn();
    const { session } = await openWith(ok(DESIGN_ITEM));
    await session.queue.access({ queue: 12 }, { onRawResponse });
    expect(onRawResponse.mock.calls[0]?.[0]).toMatchObject({ operation: 'queue.access', protocol: 'soap' });
  });
});

describe('queue.access: respuesta', () => {
  it('lee el ítem del design: Line completo y el párrafo tal cual, con sangría y líneas vacías', async () => {
    const { session } = await openWith(ok(DESIGN_ITEM));
    expect(await session.queue.access({ queue: 12 })).toEqual({
      respondedAt: '2026-10-31T12:00:00Z',
      done: false,
      item: {
        locator: 'ABC123',
        placedAt: '12-21T07:00',
        placedBy: { agentSine: 'AWS', pseudoCityCode: 'IPCC1' },
        primaryPassenger: 'CLARK/JAMIE',
        group: '1',
        paragraph: [
          '035  NO PIC CODE',
          '011  SEE REMARKS',
          '',
          '1.1TEST/SWS*FSG',
          ' 2.TK 0010914379913 TEST/B     SYSSYS',
          '  1.DFW817-555-1212-B',
          'A & B',
        ],
      },
      warnings: [],
    });
    expect(session.queue.state).toBe('inside');
  });

  it('lee la forma de la respuesta real: DateTime con año, sin Group ni PassengerName', async () => {
    const { session } = await openWith(ok(REAL_ITEM()));
    const step = await session.queue.access({ queue: 12 });
    expect(step).toEqual({
      respondedAt: '2026-10-31T12:00:00Z',
      done: false,
      item: {
        locator: 'QWERTY',
        placedAt: '2024-05-15T13:24',
        placedBy: { agentSine: 'AB1', pseudoCityCode: 'H8GI' },
        paragraph: ['011  SEE REMARKS', '1.1PEREZ/JUAN', 'H8GI.H8GI*AB1 1230/15MAY24 QWERTY H'],
      },
      warnings: [],
    });
  });

  it('el sample de response del paquete 2.1.1 (solo UniqueID) da un ítem sin campos opcionales', async () => {
    const payload = queueRS(success, '<Line><UniqueID ID="NGDEZP"/></Line><Paragraph><Text>011  SEE REMARKS</Text></Paragraph>');
    const { session } = await openWith(ok(payload));
    expect(await session.queue.access({ queue: 200 })).toMatchObject({
      done: false,
      item: { locator: 'NGDEZP', paragraph: ['011  SEE REMARKS'] },
    });
  });

  it('una cola vacía al entrar devuelve { done: true } y la sesión sigue afuera', async () => {
    const { session } = await openWith(ok(END_IN_PARAGRAPH));
    expect(await session.queue.access({ queue: 12 })).toEqual({
      respondedAt: '2026-10-31T12:00:00Z',
      done: true,
      reason: 'end-of-display',
      message: END,
      warnings: [],
    });
    expect(session.queue.state).toBe('outside');
  });

  it('un stl:Warning que no es el fin de cola va en warnings y no lanza', async () => {
    const payload = queueRS(`${success}${entry('Warning', 'WARN.SWS.HOST.WARNING_RETURNED', 'ALGUN AVISO')}`).replace(
      '</QueueAccessRS>',
      '<Line><UniqueID ID="ABC123"/></Line></QueueAccessRS>',
    );
    const { session } = await openWith(ok(payload));
    const step = await session.queue.access({ queue: 12 });
    expect(step.done).toBe(false);
    expect(step.warnings).toHaveLength(1);
    expect(step.warnings[0]).toBeInstanceOf(SabreWarning);
  });

  it('QUEUE SELECTED NOT VALID OR CLOSED es un SabreBusinessError y la sesión sigue afuera', async () => {
    const { session } = await openWith(ok(NOT_VALID));
    const error = await rejection(session.queue.access({ queue: 12 }));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'queueAccess', message: 'queueAccess: QUEUE SELECTED NOT VALID OR CLOSED' });
    expect(session.queue.state).toBe('outside');
  });

  it('una respuesta sin Line ni fin de cola es un SabreGatewayError y deja unknown', async () => {
    const { session } = await openWith(ok(queueRS(success)));
    const error = await rejection(session.queue.access({ queue: 12 }));
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as Error).message).toMatch(/^queueAccess: respuesta no reconocida/);
    expect(session.queue.state).toBe('unknown');
  });
});

describe('fin de cola en sus tres lugares', () => {
  it.each([
    ['primera línea del Paragraph', END_IN_PARAGRAPH, 0],
    ['stl:Warning', END_IN_WARNING, 1],
    ['stl:Error', END_IN_ERROR, 0],
  ])('como %s, ignore devuelve { done: true } y deja la sesión afuera', async (_place, payload, warnings) => {
    const { session } = await inside(ok(payload));
    const step = await session.queue.ignore();
    expect(step).toMatchObject({ done: true, reason: 'end-of-display', message: END });
    expect(step.warnings).toHaveLength(warnings);
    expect(session.queue.state).toBe('outside');
  });

  it('con líneas vacías antes, el fin de cola sigue siendo la primera línea con texto', async () => {
    const { session } = await inside(ok(queueRS(success, `<Paragraph><Text/><Text>  ${END}</Text></Paragraph>`)));
    expect(await session.queue.ignore()).toMatchObject({ done: true });
  });

  it('el texto tiene que ser exacto: otra línea que lo contiene no es el fin de cola', async () => {
    const payload = queueRS(success, `<Line><UniqueID ID="ABC123"/></Line><Paragraph><Text>RMK ${END}</Text></Paragraph>`);
    const { session } = await inside(ok(payload));
    expect(await session.queue.ignore()).toMatchObject({ done: false, item: { locator: 'ABC123' } });
  });

  it('isEndOfDisplayResult reconoce el texto entre los Message y el ShortText', () => {
    const service = 'queueAccess';
    expect(isEndOfDisplayResult({ service, message: `queueAccess: ${END}` })).toBe(true);
    expect(isEndOfDisplayResult({ service, message: `queueAccess: OTRO / ${END}` })).toBe(true);
    expect(isEndOfDisplayResult({ service, message: `queueAccess: OTRO (${END})` })).toBe(true);
    expect(isEndOfDisplayResult({ service, message: `queueAccess: ${END} PARA ESTA COLA` })).toBe(false);
  });
});

describe('navegación', () => {
  it('ignore manda Navigation I y devuelve el PNR siguiente', async () => {
    const { fetch, session } = await inside(ok(REAL_ITEM('NEXT01')));
    expect(await session.queue.ignore()).toMatchObject({ done: false, item: { locator: 'NEXT01' } });
    expect(body(fetch, 2)).toBe(
      '<QueueAccessRQ Version="2.1.1" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><Navigation Action="I"/></QueueAccessRQ>',
    );
    expect(session.queue.state).toBe('inside');
  });

  it('remove manda Navigation QR y devuelve el PNR siguiente', async () => {
    const { fetch, session } = await inside(ok(REAL_ITEM('NEXT01')));
    expect(await session.queue.remove()).toMatchObject({ done: false, item: { locator: 'NEXT01' } });
    expect(body(fetch, 2)).toContain('<Navigation Action="QR"/></QueueAccessRQ>');
  });

  it('remove({ from }) manda QR con hasta 3 QueueIdentifier, con el PCC de la sesión por defecto', async () => {
    const { fetch, session } = await inside(ok(REAL_ITEM('NEXT01')));
    await session.queue.remove({ from: [{ queue: 2, pcc: '7TZA' }, { queue: 3 }, { queue: { name: 'S' }, pcc: 'G7HE' }] });
    expect(body(fetch, 2)).toContain(
      '<Navigation Action="QR"/><QueueIdentifier Number="2" PseudoCityCode="7TZA"/><QueueIdentifier Number="3" PseudoCityCode="H8GI"/><QueueIdentifier Name="S" PseudoCityCode="G7HE"/></QueueAccessRQ>',
    );
  });

  it.each([
    ['una lista vacía', [], 'sabre-client: from debe ser una lista de 1 a 3 colas'],
    ['4 colas', [{ queue: 1 }, { queue: 2 }, { queue: 3 }, { queue: 4 }], 'sabre-client: from debe ser una lista de 1 a 3 colas'],
    ['una cola inválida', [{ queue: -1 }], 'sabre-client: from[0].queue debe ser un número de cola entero de 0 a 511, o { name }'],
    ['un pcc inválido', [{ queue: 1, pcc: 'TOOLONG' }], 'sabre-client: from[0].pcc debe tener 3 o 4 caracteres alfanuméricos'],
    ['un destino que no es objeto', [3], 'sabre-client: from[0] debe ser { queue, pcc? }'],
  ])('remove({ from }) con %s lanza TypeError sin red', async (_name, from, message) => {
    const { fetch, session } = await inside();
    expect(await rejection(session.queue.remove({ from: from as never }))).toEqual(new TypeError(message));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(session.queue.state).toBe('inside');
  });

  it('exit manda Navigation QXI y deja la sesión afuera', async () => {
    const { fetch, session } = await inside(ok(EXIT_OK));
    await expect(session.queue.exit()).resolves.toBeUndefined();
    expect(body(fetch, 2)).toContain('<Navigation Action="QXI"/></QueueAccessRQ>');
    expect(session.queue.state).toBe('outside');
  });

  it('después de exit se puede entrar a otra cola', async () => {
    const { fetch, session } = await inside(ok(EXIT_OK), ok(REAL_ITEM()));
    await session.queue.exit();
    await session.queue.access({ queue: 13 });
    expect(body(fetch, 3)).toContain('<QueueIdentifier Number="13" PseudoCityCode="H8GI"/>');
  });

  it.each([
    ['ignore', (s: SabreSession) => s.queue.ignore()],
    ['remove', (s: SabreSession) => s.queue.remove()],
    ['exit', (s: SabreSession) => s.queue.exit()],
  ])('%s fuera de una cola lanza TypeError sin red', async (name, call) => {
    const { fetch, session } = await openWith();
    expect(await rejection(call(session))).toEqual(
      new TypeError(`sabre-client: queue.${name} necesita estar dentro de una cola: entra con queue.access()`),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('access dentro de una cola lanza TypeError sin red', async () => {
    const { fetch, session } = await inside();
    expect(await rejection(session.queue.access({ queue: 13 }))).toEqual(
      new TypeError('sabre-client: la sesión ya está dentro de una cola: sal con queue.exit() antes de entrar a otra'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('el operation de onRawResponse nombra cada acción', async () => {
    const onRawResponse = vi.fn();
    const { session } = await inside(ok(REAL_ITEM()), ok(REAL_ITEM()), ok(EXIT_OK));
    await session.queue.ignore({ onRawResponse });
    await session.queue.remove({}, { onRawResponse });
    await session.queue.exit({ onRawResponse });
    expect(onRawResponse.mock.calls.map(([raw]) => raw.operation)).toEqual(['queue.ignore', 'queue.remove', 'queue.exit']);
  });

  it('count dentro de una cola no cambia el estado', async () => {
    const countRS =
      '<QueueCountRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" Version="2.2.1"><QueueInfo><QueueIdentifier Count="1" Number="12"/></QueueInfo></QueueCountRS>';
    const { session } = await inside(ok(countRS));
    await session.queue.count();
    expect(session.queue.state).toBe('inside');
  });
});

describe('estado unknown', () => {
  it('un fallo de red dentro de una cola no se reintenta y deja unknown', async () => {
    const { fetch, session } = await inside(networkFailure(), ok(REAL_ITEM()));
    const error = await rejection(session.queue.ignore({ retry: { maxRetries: 3, baseDelayMs: 0 } }));
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(session.queue.state).toBe('unknown');
  });

  it('un error de negocio dentro de una cola deja unknown', async () => {
    const { session } = await inside(ok(queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'RESTRICTED PNR'))));
    expect(await rejection(session.queue.remove())).toBeInstanceOf(SabreBusinessError);
    expect(session.queue.state).toBe('unknown');
  });

  it('un fallo de red en access, fuera de una cola, deja unknown', async () => {
    const { fetch, session } = await openWith(networkFailure());
    await rejection(session.queue.access({ queue: 12 }, { retry: { maxRetries: 3, baseDelayMs: 0 } }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(session.queue.state).toBe('unknown');
  });

  it('un SOAP fault con código en access, fuera de una cola, la deja afuera', async () => {
    const { session } = await openWith(xml(500, soap(fault('soap-env:Client.InvalidAction', 'USG_INVALID_ACTION'))));
    await rejection(session.queue.access({ queue: 12 }));
    expect(session.queue.state).toBe('outside');
  });

  it('con unknown, access lanza TypeError sin red hasta que se llame a exit()', async () => {
    const { fetch, session } = await unknown();
    expect(await rejection(session.queue.access({ queue: 12 }))).toEqual(
      new TypeError('sabre-client: no se sabe si la sesión sigue dentro de una cola: llama a queue.exit() antes de entrar'),
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('con unknown, las demás operaciones se mandan igual y el resultado fija el estado', async () => {
    const { session } = await unknown(ok(REAL_ITEM('NEXT01')));
    expect(await session.queue.ignore()).toMatchObject({ done: false, item: { locator: 'NEXT01' } });
    expect(session.queue.state).toBe('inside');
  });

  it('con unknown, un fin de cola deja la sesión afuera', async () => {
    const { session } = await unknown(ok(END_IN_PARAGRAPH));
    await session.queue.remove();
    expect(session.queue.state).toBe('outside');
  });

  it('con unknown, exit manda QXI y deja la sesión afuera', async () => {
    const { fetch, session } = await unknown(ok(EXIT_OK));
    await session.queue.exit();
    expect(body(fetch, 3)).toContain('<Navigation Action="QXI"/>');
    expect(session.queue.state).toBe('outside');
  });

  it('con unknown, exit tolera CANNOT DO THIS IF OFF QUEUE y lo registra', async () => {
    const notOnQueue = queueRS(hostError('CANNOT DO THIS IF OFF QUEUE'));
    const { session, calls } = await unknown(ok(notOnQueue));
    await expect(session.queue.exit()).resolves.toBeUndefined();
    expect(session.queue.state).toBe('outside');
    const event = calls.find(([, message]) => message === 'sabre.queue.exitTolerated');
    expect(event?.[0]).toBe('info');
    expect(event?.[2]).toMatchObject({ code: 'ERR.SWS.HOST.ERROR_IN_RESPONSE' });
  });

  it('con unknown, otro error de negocio en exit lanza y sigue en unknown', async () => {
    const { session, calls } = await unknown(ok(queueRS(hostError('RESTRICTED PNR'))));
    const error = await rejection(session.queue.exit());
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect((error as Error).message).toBe('queueAccess: RESTRICTED PNR (ERR.SWS.HOST.ERROR_IN_RESPONSE)');
    expect(session.queue.state).toBe('unknown');
    expect(calls.some(([, message]) => message === 'sabre.queue.exitTolerated')).toBe(false);
  });

  it('con unknown, un fallo de red en exit lanza y sigue en unknown', async () => {
    const { session } = await unknown(networkFailure());
    expect(await rejection(session.queue.exit())).toBeInstanceOf(SabreGatewayError);
    expect(session.queue.state).toBe('unknown');
  });

  it('dentro de una cola, un error de negocio en exit lanza y deja unknown', async () => {
    const { session } = await inside(ok(queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'NO SE PUDO'))));
    expect(await rejection(session.queue.exit())).toBeInstanceOf(SabreBusinessError);
    expect(session.queue.state).toBe('unknown');
  });

  it('un SabreSessionError no cambia el estado: la sesión queda inutilizable', async () => {
    const { session } = await inside(xml(500, soap(fault('soap-env:Client.InvalidSecurityToken', 'USG_INVALID_SESSION'))));
    expect(await rejection(session.queue.ignore())).toBeInstanceOf(SabreSessionError);
    expect(session.queue.state).toBe('inside');
    expect(await rejection(session.queue.ignore())).toBeInstanceOf(TypeError);
  });

  it('un session busy no cambia el estado', async () => {
    const { session } = await inside(ok(REAL_ITEM('NEXT01')));
    const first = session.queue.ignore();
    expect(await rejection(session.queue.remove())).toEqual(new TypeError('sabre-client: session busy'));
    await first;
    expect(session.queue.state).toBe('inside');
  });
});

describe('paragraphLines', () => {
  it('devuelve las líneas tal cual, sin recortar, y vacío si no hay Paragraph', () => {
    expect(paragraphLines(soap(DESIGN_ITEM))).toContain(' 2.TK 0010914379913 TEST/B     SYSSYS');
    expect(paragraphLines(soap(queueRS(success)))).toEqual([]);
    expect(paragraphLines('no es xml <')).toEqual([]);
  });
});
