import { describe, expect, it, vi } from 'vitest';
import { SabreBusinessError, SabreGatewayError, SabreWarning } from '../src/index.js';
import { parseHostCount, queueCountPayload } from '../src/queue/queue-count.js';
import { queueRefAttribute, toQueueRef, validateQueueRef } from '../src/queue/queue-ref.js';
import { mockFetch } from './helpers.js';
import { entry, legacyClient, rejection, SESSION_TOKEN, sentBody, sentTag, sessionOpened, soap, success, xml } from './soap-helpers.js';

const STL = 'xmlns:stl="http://services.sabre.com/STL/v01"';
const NS = 'xmlns="http://webservices.sabre.com/sabreXML/2011/10"';

/** El sample oficial de Get Queue Count 2.2.1 (wiki/raw/sources/get-queue-count.md), tal cual. */
const DOC_SAMPLE = `<QueueCountRS ${NS} Version="2.2.1" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${STL}>
    <stl:ApplicationResults status="Complete">
        <stl:Success timeStamp="2015-11-16T09:46:40-05:00"/>
    </stl:ApplicationResults>
    <QueueInfo DateTime="06-25T09:46" PseudoCityCode="7TZA">
        <QueueIdentifier Count="....261" Number="S"/>
        <QueueIdentifier Count="......3" Number="9"/>
        <QueueIdentifier Count=".....29" Number="20"/>
        <QueueIdentifier Count="......2" Number="100"/>
        <QueueIdentifier Count="......1" Number="200"/>
        <QueueIdentifier Count="......1" Number="300"/>
        <QueueIdentifier Count="......1" Number="400"/>
        <QueueIdentifier Count="......7" Number="501"/>
    </QueueInfo>
    <Totals Count="......261" Type="MESSAGES"/>
    <Totals Count="........0" Type="SPECIALS"/>
    <Totals Count=".......44" Type="PNRS"/>
</QueueCountRS>`;

/**
 * La forma de la respuesta real de producción de `1.0.8` (febrero de 2025), según
 * wiki/sources/sabre-legacy-client-1-0-8.md: `Count` sin relleno de puntos y `DateTime` sin año.
 * El PCC y los números de cola se anonimizaron; los totales son coherentes con las colas.
 */
const REAL_SHAPE = `<QueueCountRS ${NS} ${STL} Version="2.2.1"><stl:ApplicationResults status="Complete"><stl:Success timeStamp="2025-02-17T13:54:12-06:00"/></stl:ApplicationResults><QueueInfo DateTime="02-17T13:54" PseudoCityCode="H8GI"><QueueIdentifier Count="6" Number="S"/><QueueIdentifier Count="1" Number="305"/></QueueInfo><Totals Count="6" Type="MESSAGES"/><Totals Count="0" Type="SPECIALS"/><Totals Count="1" Type="PNRS"/></QueueCountRS>`;

const countRS = (inner: string) => `<QueueCountRS ${NS} ${STL} Version="2.2.1">${inner}</QueueCountRS>`;
const counted = (payload = REAL_SHAPE) => xml(200, soap(payload));

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const session = await legacyClient(fetch).client.openSession();
  return { fetch, session };
}

describe('queue.count: request', () => {
  it('manda QueueCountRQ 2.2.1 con el PCC de la sesión y su token', async () => {
    const { fetch, session } = await openWith(counted());
    await session.queue.count();

    const envelope = sentBody(fetch, 1);
    expect(sentTag(envelope, 'eb:Action')).toBe('QueueCountLLSRQ');
    expect(sentTag(envelope, 'eb:Service')).toBe('QueueCountLLSRQ');
    expect(envelope).toContain(
      '<soap-env:Body><QueueCountRQ Version="2.2.1" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><QueueInfo><QueueIdentifier PseudoCityCode="H8GI"/></QueueInfo></QueueCountRQ></soap-env:Body>',
    );
    expect(envelope).toContain(`>${SESSION_TOKEN}</wsse:BinarySecurityToken>`);
  });

  it('con pcc cuenta las colas de ese PCC', async () => {
    const { fetch, session } = await openWith(counted());
    await session.queue.count({ pcc: 'ABC1' });
    expect(sentBody(fetch, 1)).toContain('<QueueIdentifier PseudoCityCode="ABC1"/>');
  });

  it.each([['AB'], ['ABCDE'], ['AB-C'], [''], [123]])('un pcc inválido (%j) lanza TypeError sin red', async (pcc) => {
    const { fetch, session } = await openWith();
    const error = await rejection(session.queue.count({ pcc: pcc as string }));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('sabre-client: pcc debe tener 3 o 4 caracteres alfanuméricos');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('escapa el PCC en el cuerpo', () => {
    expect(queueCountPayload('A&B"')).toContain('PseudoCityCode="A&amp;B&quot;"');
  });

  it('es idempotente: se reintenta ante un fallo de red', async () => {
    const { fetch, session } = await openWith(new TypeError('fetch failed'), counted());
    const result = await session.queue.count({}, { retry: { maxRetries: 1, baseDelayMs: 0 } });
    expect(result.queues).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('entrega la respuesta cruda como queue.count, con el token redactado', async () => {
    const onRawResponse = vi.fn();
    const { session } = await openWith(counted());
    await session.queue.count({}, { onRawResponse });
    expect(onRawResponse).toHaveBeenCalledOnce();
    expect(onRawResponse.mock.calls[0]?.[0]).toMatchObject({ operation: 'queue.count', protocol: 'soap', status: 200 });
    expect(onRawResponse.mock.calls[0]?.[0].body).not.toContain(SESSION_TOKEN);
  });

  it('respeta el uso exclusivo de la sesión', async () => {
    const { fetch, session } = await openWith(counted(), counted());
    const first = session.queue.count();
    const error = await rejection(session.queue.count());
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('sabre-client: session busy');
    await first;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('queue.count: respuesta', () => {
  it('lee el sample de la documentación, con Count rellenado con puntos', async () => {
    const { session } = await openWith(counted(DOC_SAMPLE));
    expect(await session.queue.count()).toEqual({
      respondedAt: '2026-10-31T12:00:00Z',
      queues: [
        { queue: 'S', count: 261 },
        { queue: 9, count: 3 },
        { queue: 20, count: 29 },
        { queue: 100, count: 2 },
        { queue: 200, count: 1 },
        { queue: 300, count: 1 },
        { queue: 400, count: 1 },
        { queue: 501, count: 7 },
      ],
      totals: { messages: 261, specials: 0, pnrs: 44 },
      countedAt: '06-25T09:46',
      warnings: [],
    });
  });

  it('lee la forma de la respuesta real, con Count sin relleno', async () => {
    const { session } = await openWith(counted());
    expect(await session.queue.count()).toEqual({
      respondedAt: '2026-10-31T12:00:00Z',
      queues: [
        { queue: 'S', count: 6 },
        { queue: 305, count: 1 },
      ],
      totals: { messages: 6, specials: 0, pnrs: 1 },
      countedAt: '02-17T13:54',
      warnings: [],
    });
  });

  it('lo que devuelve count pasa la validación de QueueRef de las demás operaciones', async () => {
    const { session } = await openWith(counted(DOC_SAMPLE));
    const { queues } = await session.queue.count();
    for (const { queue } of queues) expect(() => validateQueueRef(queue, 'queue')).not.toThrow();
  });

  it('sin QueueInfo ni Totals devuelve listas vacías y totales en undefined', async () => {
    const { session } = await openWith(counted(countRS(`<stl:ApplicationResults status="Complete">${success}</stl:ApplicationResults>`)));
    expect(await session.queue.count()).toEqual({ queues: [], totals: {}, warnings: [] , respondedAt: '2026-10-31T12:00:00Z' });
  });

  it('los stl:Warning no lanzan: van en warnings', async () => {
    const payload = countRS(
      `<stl:ApplicationResults status="Complete">${success}${entry('Warning', 'WARN.SWS.HOST.WARNING_RETURNED', 'ALGUN AVISO')}</stl:ApplicationResults><QueueInfo DateTime="02-17T13:54" PseudoCityCode="H8GI"><QueueIdentifier Count="2" Number="12"/></QueueInfo>`,
    );
    const { session } = await openWith(counted(payload));
    const result = await session.queue.count();
    expect(result.queues).toEqual([{ queue: 12, count: 2 }]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toBeInstanceOf(SabreWarning);
    expect(result.warnings[0]).toMatchObject({ service: 'queueCount', code: 'WARN.SWS.HOST.WARNING_RETURNED' });
  });

  it('un stl:Error es un SabreBusinessError de queueCount', async () => {
    const payload = countRS(
      `<stl:ApplicationResults status="NotProcessed">${entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'INVALID PSEUDO CITY')}</stl:ApplicationResults>`,
    );
    const { session } = await openWith(counted(payload));
    const error = await rejection(session.queue.count());
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'queueCount', code: 'ERR.SWS.HOST.ERROR_IN_RESPONSE', retryable: false });
  });

  it.each([
    ['un Count que no es un número', '<QueueIdentifier Count="..x" Number="12"/>'],
    ['un QueueIdentifier sin Count', '<QueueIdentifier Number="12"/>'],
    ['un QueueIdentifier sin Number', '<QueueIdentifier Count="3"/>'],
  ])('%s es un SabreGatewayError con el sobre redactado en raw', async (_name, identifier) => {
    const payload = countRS(`<stl:ApplicationResults status="Complete">${success}</stl:ApplicationResults><QueueInfo>${identifier}</QueueInfo>`);
    const { session } = await openWith(counted(payload));
    const error = await rejection(session.queue.count());
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error).toMatchObject({ protocol: 'soap', status: 200, retryable: false });
    expect((error as Error).message).toMatch(/^queueCount: respuesta no reconocida/);
    expect((error as SabreGatewayError).raw).toContain('<QueueCountRS');
  });

  it('un Totals con Count ilegible es un SabreGatewayError', async () => {
    const payload = countRS(`<Totals Count="mucho" Type="PNRS"/>`);
    const { session } = await openWith(counted(payload));
    expect(await rejection(session.queue.count())).toBeInstanceOf(SabreGatewayError);
  });

  it('ignora los Totals de un Type desconocido', async () => {
    const payload = countRS(`<Totals Count="3" Type="PNRS"/><Totals Count="9" Type="OTRO"/>`);
    const { session } = await openWith(counted(payload));
    expect((await session.queue.count()).totals).toEqual({ pnrs: 3 });
  });
});

describe('parseHostCount', () => {
  it.each([
    ['....261', 261],
    ['......3', 3],
    ['........0', 0],
    ['6', 6],
    [' 12 ', 12],
    ['007', 7],
  ])('%j da %d', (text, expected) => {
    expect(parseHostCount(text)).toBe(expected);
  });

  it.each([[undefined], [''], ['...'], ['1.5'], ['-1'], ['S']])('%j no es un Count', (text) => {
    expect(parseHostCount(text)).toBeUndefined();
  });
});

describe('QueueRef', () => {
  it('toQueueRef convierte los números en number y lo alfabético en string (ADR-028)', () => {
    expect(toQueueRef('12')).toBe(12);
    expect(toQueueRef('0')).toBe(0);
    expect(toQueueRef('S')).toBe('S');
    expect(toQueueRef('9A')).toBe('9A');
    expect(toQueueRef('')).toBeUndefined();
    expect(toQueueRef(undefined)).toBeUndefined();
  });

  it.each([[0], [49], [511], ['S'], ['A'], ['AB'], [{ name: 'HOTELS' }], [{ name: 'ABC123' }]])('%j es válida', (queue) => {
    expect(() => validateQueueRef(queue, 'queue')).not.toThrow();
  });

  it.each([[-1], [512], [1.5], [Number.NaN]])('el número %j lanza TypeError', (queue) => {
    expect(() => validateQueueRef(queue, 'queue')).toThrow(
      new TypeError("sabre-client: queue debe ser un número de cola entero de 0 a 511, una cola alfabética ('S') o { name }"),
    );
  });

  it.each([[{ name: '' }], [{ name: '  ' }], [{ name: 5 }], [{}]])('el nombre de %j lanza TypeError', (queue) => {
    expect(() => validateQueueRef(queue, 'to[0].queue')).toThrow(
      new TypeError('sabre-client: to[0].queue.name debe ser un string no vacío'),
    );
  });

  it.each([['s'], ['ABC'], ['S1'], [''], [' ']])('el string %j lanza TypeError: no es una cola alfabética', (queue) => {
    expect(() => validateQueueRef(queue, 'queue')).toThrow(
      new TypeError("sabre-client: queue debe ser una cola alfabética de una o dos letras mayúsculas (p. ej. 'S')"),
    );
  });

  it('un string numérico lanza TypeError: cada cola tiene una sola forma', () => {
    expect(() => validateQueueRef('12', 'queue')).toThrow(
      new TypeError('sabre-client: queue: una cola numérica va como número (12), no como string'),
    );
  });

  it.each([['S'], ['AB']])('{ name: %j } lanza TypeError y pide la cola alfabética (sub-decisión ii)', (name) => {
    expect(() => validateQueueRef({ name }, 'queue')).toThrow(
      new TypeError(`sabre-client: queue: '${name}' es una cola alfabética: pasa '${name}', no { name: '${name}' }`),
    );
  });

  it.each([[null], [undefined], [[12]], [true]])('%j lanza TypeError', (queue) => {
    expect(() => validateQueueRef(queue, 'queue')).toThrow(
      new TypeError("sabre-client: queue debe ser un número de cola (0–511), una cola alfabética ('S') o { name }"),
    );
  });

  it('queueRefAttribute arma Number o Name, escapado', () => {
    expect(queueRefAttribute(12)).toBe('Number="12"');
    expect(queueRefAttribute('S')).toBe('Number="S"');
    expect(queueRefAttribute({ name: 'A&B' })).toBe('Name="A&amp;B"');
  });
});
