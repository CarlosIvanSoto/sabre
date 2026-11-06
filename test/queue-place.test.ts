import { describe, expect, it, vi } from 'vitest';
import { SabreBusinessError, SabreGatewayError, SabreWarning } from '../src/index.js';
import { isInstructionCode, queuePlacePayload, signatureLocator } from '../src/queue/queue-place.js';
import { mockFetch } from './helpers.js';
import { entry, legacyClient, queueRS, rejection, sentBody, sentTag, sessionOpened, soap, success, xml } from './soap-helpers.js';

const END = 'END OF DISPLAY FOR REQUESTED DATA';
const STL = 'xmlns:stl="http://services.sabre.com/STL/v01"';
const NS = 'xmlns="http://webservices.sabre.com/sabreXML/2011/10"';

const placeRS = (results: string, extra = '') =>
  `<QueuePlaceRS ${NS} ${STL} Version="2.0.4"><stl:ApplicationResults status="Complete">${results}</stl:ApplicationResults>${extra}</QueuePlaceRS>`;

/**
 * La forma de la respuesta real de `1.0.8` a `QP/H8GI100/11` dentro de una cola
 * (wiki/sources/sabre-legacy-client-1-0-8.md): `stl:Success` con `HostCommand`, sin `QueueInfo`, y
 * en `Text` el PNR siguiente en formato de host, con la línea de firma al final. Datos inventados.
 */
const REAL_INSIDE = (locator = 'ZXCVBN') =>
  placeRS(
    `<stl:Success timeStamp="2025-02-18T10:11:12-06:00"><stl:SystemSpecificResults><stl:HostCommand LNIATA="1A2B3C">QP/H8GI100/11</stl:HostCommand></stl:SystemSpecificResults></stl:Success>`,
    [
      '011  SEE REMARKS',
      '',
      '1.1PEREZ/JUAN 2.1GOMEZ/ANA',
      ' 1 AM 400Y 20MAR Q MEXCUN HK2  0800  1015  /E',
      'TKT/TIME LIMIT',
      '  1.TAW/15MAR',
      'INVOICED',
      'GENERAL FACTS',
      '  1.SSR OTHS 1S PLS ADTK BY 15MAR',
      'REMARKS',
      '  1.H-CLIENTE PRUEBA',
      'RECEIVED FROM - AGENTE',
      `H8GI.H8GI*AB1 1230/18FEB25 ${locator} H`,
    ]
      .map((line) => (line === '' ? '<Text/>' : `<Text>${line}</Text>`))
      .join(''),
  );

/** El sample de response del paquete 2.0.4: solo `Text`. */
const DOC_SAMPLE = placeRS('<stl:Success timeStamp="2025-12-11T09:30:23-06:00"/>', '<Text>OK 1030 NMIUTF</Text>');

/** Con `QueueInfo`, como el design 2.0.4. */
const DESIGN_OUTSIDE = placeRS(
  success,
  '<QueueInfo DateTime="12-21T12:00"><QueueIdentifier Number="400" PseudoCityCode="IPCC1"/><UniqueID ID="ABC123"/></QueueInfo><QueueInfo DateTime="12-21T12:01"><QueueIdentifier Name="TEST" PseudoCityCode="IPCC1"/><UniqueID ID="DEF456"/></QueueInfo><Text>OK 1030 NMIUTF</Text>',
);

const END_IN_WARNING = placeRS(`${success}${entry('Warning', 'WARN.SWS.HOST.WARNING_RETURNED', END)}`);

const ACCESS_ITEM = queueRS(success, '<Line><UniqueID ID="FIRST1"/></Line><Paragraph><Text>011  SEE REMARKS</Text></Paragraph>');

const ok = (payload: string) => xml(200, soap(payload));

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const { client } = legacyClient(fetch);
  const session = await client.openSession();
  return { fetch, session };
}

async function inside(...responses: Array<Response | Error>) {
  const opened = await openWith(ok(ACCESS_ITEM), ...responses);
  await opened.session.queue.access({ queue: 12 });
  return opened;
}

const body = (fetch: ReturnType<typeof mockFetch>, call: number) =>
  /<soap-env:Body>(.*)<\/soap-env:Body>/.exec(sentBody(fetch, call))?.[1];

describe('queue.place: request', () => {
  it('manda QueuePlaceRQ 2.0.4 con la cola, el PIC y el PCC de la sesión', async () => {
    const { fetch, session } = await inside(ok(REAL_INSIDE()));
    await session.queue.place({ to: [{ queue: 100, instructionCode: 11 }] });
    expect(sentTag(sentBody(fetch, 2), 'eb:Action')).toBe('QueuePlaceLLSRQ');
    expect(body(fetch, 2)).toBe(
      '<QueuePlaceRQ Version="2.0.4" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><QueueInfo><QueueIdentifier Number="100" PrefatoryInstructionCode="11" PseudoCityCode="H8GI"/></QueueInfo></QueuePlaceRQ>',
    );
  });

  it('dentro de una cola, sin instructionCode lanza TypeError sin red', async () => {
    const { fetch, session } = await inside();
    expect(await rejection(session.queue.place({ to: [{ queue: 100 }] } as never))).toEqual(
      new TypeError('sabre-client: queue.place necesita instructionCode en cada destino: Sabre lo exige, dentro y fuera de una cola'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(session.queue.state).toBe('inside');
  });

  it('con locators, fuera de una cola, manda los UniqueID después de las colas', async () => {
    const { fetch, session } = await openWith(ok(DOC_SAMPLE));
    await session.queue.place({
      to: [{ queue: 400, pcc: 'IPC1', instructionCode: 11 }, { queue: { name: 'S' }, instructionCode: 7 }],
      locators: ['ABC123', 'DEF456'],
    });
    expect(body(fetch, 1)).toContain(
      '<QueueInfo><QueueIdentifier Number="400" PrefatoryInstructionCode="11" PseudoCityCode="IPC1"/><QueueIdentifier Name="S" PrefatoryInstructionCode="7" PseudoCityCode="H8GI"/><UniqueID ID="ABC123"/><UniqueID ID="DEF456"/></QueueInfo>',
    );
  });

  it.each([
    ['con locators', { to: [{ queue: 400 }], locators: ['ABC123'] }],
    ['sin locators (el PNR del AAA)', { to: [{ queue: 400 }] }],
    ['si falta en uno de los destinos', { to: [{ queue: 400, instructionCode: 11 }, { queue: 401 }], locators: ['ABC123'] }],
  ])('fuera de una cola, sin instructionCode lanza TypeError sin red (%s)', async (_name, request) => {
    const { fetch, session } = await openWith();
    expect(await rejection(session.queue.place(request as never))).toEqual(
      new TypeError('sabre-client: queue.place necesita instructionCode en cada destino: Sabre lo exige, dentro y fuera de una cola'),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('escapa los localizadores', () => {
    expect(queuePlacePayload([{ queue: 1, pcc: 'ABCD' }], ['A"B'])).toContain('<UniqueID ID="A&quot;B"/>');
  });

  it.each([
    ['sin to', {}, 'sabre-client: to debe ser una lista de 1 a 10 colas'],
    ['to vacío', { to: [] }, 'sabre-client: to debe ser una lista de 1 a 10 colas'],
    ['11 destinos', { to: Array.from({ length: 11 }, () => ({ queue: 1 })) }, 'sabre-client: to debe ser una lista de 1 a 10 colas'],
    ['un destino que no es objeto', { to: [5] }, 'sabre-client: to[0] debe ser { queue, pcc?, instructionCode }'],
    ['una cola inválida', { to: [{ queue: 600 }] }, 'sabre-client: to[0].queue debe ser un número de cola entero de 0 a 511, o { name }'],
    ['un pcc inválido', { to: [{ queue: 1, pcc: 'A' }] }, 'sabre-client: to[0].pcc debe tener 3 o 4 caracteres alfanuméricos'],
    ['un PIC de 192', { to: [{ queue: 1, instructionCode: 192 }] }, 'sabre-client: to[0].instructionCode debe ser un entero de 0 a 191 o de 200 a 254'],
    ['un PIC de 255', { to: [{ queue: 1, instructionCode: 255 }] }, 'sabre-client: to[0].instructionCode debe ser un entero de 0 a 191 o de 200 a 254'],
    ['un PIC no entero', { to: [{ queue: 1, instructionCode: 11.5 }] }, 'sabre-client: to[0].instructionCode debe ser un entero de 0 a 191 o de 200 a 254'],
    ['un PIC como string', { to: [{ queue: 1, instructionCode: '11' }] }, 'sabre-client: to[0].instructionCode debe ser un entero de 0 a 191 o de 200 a 254'],
    ['locators vacío', { to: [{ queue: 1 }], locators: [] }, 'sabre-client: locators debe ser una lista de 1 a 6 localizadores'],
    ['7 localizadores', { to: [{ queue: 1 }], locators: Array.from({ length: 7 }, () => 'ABC123') }, 'sabre-client: locators debe ser una lista de 1 a 6 localizadores'],
    ['un localizador vacío', { to: [{ queue: 1 }], locators: [' '] }, 'sabre-client: locators[0] debe ser un string no vacío'],
  ])('%s lanza TypeError sin red', async (_name, request, message) => {
    const { fetch, session } = await openWith();
    expect(await rejection(session.queue.place(request as never))).toEqual(new TypeError(message));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('acepta 10 destinos y 6 localizadores', async () => {
    const { session } = await openWith(ok(DOC_SAMPLE));
    const to = Array.from({ length: 10 }, (_, queue) => ({ queue, instructionCode: 11 }));
    const locators = Array.from({ length: 6 }, () => 'ABC123');
    await expect(session.queue.place({ to, locators })).resolves.toMatchObject({ text: ['OK 1030 NMIUTF'] });
  });

  it.each([[0], [191], [200], [254]])('el PIC %d es válido', (code) => {
    expect(isInstructionCode(code)).toBe(true);
  });

  it('con locators dentro de una cola lanza TypeError sin red', async () => {
    const { fetch, session } = await inside();
    expect(await rejection(session.queue.place({ to: [{ queue: 1, instructionCode: 11 }], locators: ['ABC123'] }))).toEqual(
      new TypeError('sabre-client: queue.place con locators no se puede dentro de una cola, donde coloca el PNR actual: sal con queue.exit() antes'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(session.queue.state).toBe('inside');
  });

  it('nunca se reintenta ante un fallo de red', async () => {
    const { fetch, session } = await openWith(new TypeError('fetch failed'), ok(DOC_SAMPLE));
    await rejection(session.queue.place({ to: [{ queue: 1, instructionCode: 11 }], locators: ['ABC123'] }, { retry: { maxRetries: 3, baseDelayMs: 0 } }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('entrega la respuesta cruda como queue.place', async () => {
    const onRawResponse = vi.fn();
    const { session } = await openWith(ok(DOC_SAMPLE));
    await session.queue.place({ to: [{ queue: 1, instructionCode: 11 }] }, { onRawResponse });
    expect(onRawResponse.mock.calls[0]?.[0]).toMatchObject({ operation: 'queue.place', protocol: 'soap' });
  });
});

describe('queue.place dentro de una cola', () => {
  it('con la respuesta real devuelve el PNR siguiente: localizador de la firma y Text tal cual', async () => {
    const { session } = await inside(ok(REAL_INSIDE('ZXCVBN')));
    const step = await session.queue.place({ to: [{ queue: 100, instructionCode: 11 }] });
    expect(step).toEqual({
      respondedAt: '2026-10-31T12:00:00Z',
      done: false,
      item: {
        locator: 'ZXCVBN',
        paragraph: [
          '011  SEE REMARKS',
          '',
          '1.1PEREZ/JUAN 2.1GOMEZ/ANA',
          ' 1 AM 400Y 20MAR Q MEXCUN HK2  0800  1015  /E',
          'TKT/TIME LIMIT',
          '  1.TAW/15MAR',
          'INVOICED',
          'GENERAL FACTS',
          '  1.SSR OTHS 1S PLS ADTK BY 15MAR',
          'REMARKS',
          '  1.H-CLIENTE PRUEBA',
          'RECEIVED FROM - AGENTE',
          'H8GI.H8GI*AB1 1230/18FEB25 ZXCVBN H',
        ],
      },
      warnings: [],
    });
    // Fuera de `{ locators }` el tipo es la unión: se distingue con `'done' in step`.
    if (!('done' in step) || step.done) throw new Error('se esperaba un PNR');
    expect(step.item).not.toHaveProperty('placedAt');
    expect(step.item).not.toHaveProperty('placedBy');
    expect(session.queue.state).toBe('inside');
  });

  it('el fin de cola como stl:Warning devuelve { done: true } y deja la sesión afuera', async () => {
    const { session } = await inside(ok(END_IN_WARNING));
    const step = await session.queue.place({ to: [{ queue: 100, instructionCode: 11 }] });
    expect(step).toMatchObject({ done: true, reason: 'end-of-display', message: END });
    expect(step.warnings[0]).toBeInstanceOf(SabreWarning);
    expect(session.queue.state).toBe('outside');
  });

  it('el fin de cola como stl:Error también es { done: true }', async () => {
    const { session } = await inside(ok(placeRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', END))));
    expect(await session.queue.place({ to: [{ queue: 100, instructionCode: 11 }] })).toMatchObject({ done: true });
    expect(session.queue.state).toBe('outside');
  });

  it('el fin de cola como primera línea de Text también es { done: true }', async () => {
    const { session } = await inside(ok(placeRS(success, `<Text>${END}</Text>`)));
    expect(await session.queue.place({ to: [{ queue: 100, instructionCode: 11 }] })).toMatchObject({ done: true });
  });

  it('un Text sin línea de firma es un SabreGatewayError y deja unknown', async () => {
    const { session } = await inside(ok(DOC_SAMPLE));
    const error = await rejection(session.queue.place({ to: [{ queue: 100, instructionCode: 11 }] }));
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as Error).message).toMatch(/^queuePlace: respuesta no reconocida/);
    expect(session.queue.state).toBe('unknown');
  });

  it('NEED RECEIVED FROM FIELD es un SabreBusinessError de queuePlace y deja unknown', async () => {
    const payload = placeRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'NEED RECEIVED FROM FIELD - USE 6'));
    const { session } = await inside(ok(payload));
    const error = await rejection(session.queue.place({ to: [{ queue: 100, instructionCode: 11 }] }));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'queuePlace', message: 'queuePlace: NEED RECEIVED FROM FIELD - USE 6' });
    expect(session.queue.state).toBe('unknown');
  });
});

describe('queue.place fuera de una cola', () => {
  it('con el sample de la documentación devuelve el texto, sin placements', async () => {
    const { session } = await openWith(ok(DOC_SAMPLE));
    expect(await session.queue.place({ to: [{ queue: 400, instructionCode: 11 }], locators: ['ABC123'] })).toEqual({
      respondedAt: '2026-10-31T12:00:00Z',
      placements: [],
      text: ['OK 1030 NMIUTF'],
      warnings: [],
    });
    expect(session.queue.state).toBe('outside');
  });

  it('lee los QueueInfo del design en placements', async () => {
    const { session } = await openWith(ok(DESIGN_OUTSIDE));
    const result = await session.queue.place({ to: [{ queue: 400, instructionCode: 11 }], locators: ['ABC123', 'DEF456'] });
    expect(result.placements).toEqual([
      { queue: 400, pcc: 'IPCC1', locator: 'ABC123', placedAt: '12-21T12:00' },
      { queue: { name: 'TEST' }, pcc: 'IPCC1', locator: 'DEF456', placedAt: '12-21T12:01' },
    ]);
  });

  it('sin locators coloca el PNR del AAA y devuelve un QueuePlaceResult', async () => {
    const { fetch, session } = await openWith(ok(DOC_SAMPLE));
    expect(await session.queue.place({ to: [{ queue: 400, instructionCode: 11 }] })).toMatchObject({ text: ['OK 1030 NMIUTF'] });
    expect(body(fetch, 1)).not.toContain('UniqueID');
  });

  it('BAD PNR LOCATOR es un SabreBusinessError y la sesión sigue afuera', async () => {
    const { session } = await openWith(ok(placeRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'BAD PNR LOCATOR'))));
    const error = await rejection(session.queue.place({ to: [{ queue: 400, instructionCode: 11 }], locators: ['ZZZZZZ'] }));
    expect(error).toMatchObject({ service: 'queuePlace', message: 'queuePlace: BAD PNR LOCATOR' });
    expect(session.queue.state).toBe('outside');
  });

  it('un fallo de red no cambia el estado: colocar fuera de una cola no toca el cursor', async () => {
    const { session } = await openWith(new TypeError('fetch failed'));
    await rejection(session.queue.place({ to: [{ queue: 400, instructionCode: 11 }], locators: ['ABC123'] }));
    expect(session.queue.state).toBe('outside');
  });

  it.each([['FF MILEAGE AGREEMENT EXISTS'], ['CITY MEX NOT AUTHORIZED']])('el warning %s va en warnings', async (text) => {
    const { session } = await openWith(ok(placeRS(`${success}${entry('Warning', 'WARN.SWS.HOST.WARNING_RETURNED', text)}`, '<Text>OK</Text>')));
    const result = await session.queue.place({ to: [{ queue: 400, instructionCode: 11 }], locators: ['ABC123'] });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toBe(`queuePlace: ${text}`);
  });
});

describe('queue.place con unknown', () => {
  async function unknown(...responses: Array<Response | Error>) {
    const opened = await inside(new TypeError('fetch failed'), ...responses);
    await rejection(opened.session.queue.ignore());
    expect(opened.session.queue.state).toBe('unknown');
    return opened;
  }

  it('con locators lanza TypeError sin red', async () => {
    const { session } = await unknown();
    expect(await rejection(session.queue.place({ to: [{ queue: 1, instructionCode: 11 }], locators: ['ABC123'] }))).toBeInstanceOf(TypeError);
  });

  it('si llega un PNR con firma, devuelve el paso y deja inside', async () => {
    const { session } = await unknown(ok(REAL_INSIDE('NEXT01')));
    expect(await session.queue.place({ to: [{ queue: 1, instructionCode: 11 }] })).toMatchObject({ done: false, item: { locator: 'NEXT01' } });
    expect(session.queue.state).toBe('inside');
  });

  it('si llega el fin de cola, deja outside', async () => {
    const { session } = await unknown(ok(END_IN_WARNING));
    expect(await session.queue.place({ to: [{ queue: 1, instructionCode: 11 }] })).toMatchObject({ done: true });
    expect(session.queue.state).toBe('outside');
  });

  it('si llega otra cosa, devuelve un QueuePlaceResult y sigue en unknown', async () => {
    const { session } = await unknown(ok(DOC_SAMPLE));
    expect(await session.queue.place({ to: [{ queue: 1, instructionCode: 11 }] })).toMatchObject({ text: ['OK 1030 NMIUTF'] });
    expect(session.queue.state).toBe('unknown');
  });
});

describe('signatureLocator', () => {
  it('lee el localizador de la última línea de firma', () => {
    expect(signatureLocator(['7TZA.7TZA*AW5 0319/06SEP24 NGDEZP H'])).toBe('NGDEZP');
    expect(signatureLocator(['FSG.FSG8NXX2 1119/18JUL24 IBWRMX H', ''])).toBe('IBWRMX');
    expect(signatureLocator(['1.1PEREZ/JUAN', 'RECEIVED FROM - X'])).toBeUndefined();
  });
});
