// session.reservation.removeAirSegments (#269, ADR-034) contra las fixtures sintéticas de #267:
// GetReservationRS y UpdateReservationRS armados desde los ejemplos oficiales de Update Itinerary.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMOVABLE_STATUSES,
  type RemoveAirSegmentsRequest,
  SabreBusinessError,
  SabreGatewayError,
  type SabreRawRequest,
  SabreReservationUpdateError,
  SabreSessionError,
  SabreUncertainOutcomeError,
} from '../src/index.js';
import { checkRemovableSegments, validateRemoveAirSegmentsRequest } from '../src/reservation/remove-air-segments.js';
import getFixture from './fixtures/get-reservation.synthetic-guide.json';
import updateFixture from './fixtures/update-reservation.synthetic-guide.json';
import { mockFetch } from './helpers.js';
import { entry, fault, legacyClient, rejection, sentBody, sentTag, sessionOpened, soap, xml } from './soap-helpers.js';

type Fixture = { responses: { label: string; status: number; body: string }[] };
const bodyOf = (fixture: Fixture, label: string) => {
  const found = fixture.responses.find((response) => response.label === label);
  if (found === undefined) throw new Error(`la fixture no tiene ${label}`);
  return found.body;
};
const get = (label: string) => xml(200, bodyOf(getFixture, label));
const update = (label: string) => xml(200, bodyOf(updateFixture, label));
const ignored = () =>
  xml(
    200,
    soap(
      '<IgnoreTransactionRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" xmlns:stl="http://services.sabre.com/STL/v01" Version="2.0.0"><stl:ApplicationResults status="Complete"><stl:Success timeStamp="2026-11-16T21:42:38Z"/></stl:ApplicationResults></IgnoreTransactionRS>',
    ),
  );
const applicationError = (root: 'GetReservationRS' | 'UpdateReservationRS', code: string, text: string) =>
  xml(
    200,
    soap(
      `<${root} xmlns="http://webservices.sabre.com/pnrbuilder/v1_19" xmlns:stl="http://services.sabre.com/STL/v01" Version="1.19.0"><stl:ApplicationResults status="NotProcessed">${entry('Error', code, text)}</stl:ApplicationResults></${root}>`,
    ),
  );
const withoutSegment = (body: string, id: string) => body.replace(new RegExp(`<stl19:Segment sequence="\\d+" id="${id}">[\\s\\S]*?</stl19:Segment>`), '');
const reservationOf = (body: string) => /<stl19:Reservation\b[\s\S]*<\/stl19:Reservation>/.exec(body)?.[0] ?? '';
/** `delete-un` sin el segmento `id`: además del 8, falta otro segmento. */
const deleteUnWithout = (id: string) => xml(200, withoutSegment(bodyOf(updateFixture, 'delete-un'), id));
/**
 * Un `UpdateReservationRS` de `delete-un` (`Success`, `UpdateId="1"` `SUCCESS`) cuyo `Reservation`
 * es el de `get <label>` sin el segmento `id`: una baja limpia que las fixtures no traen (un `HK`).
 */
const deletedFrom = (label: string, id: string) =>
  xml(200, bodyOf(updateFixture, 'delete-un').replace(reservationOf(bodyOf(updateFixture, 'delete-un')), withoutSegment(reservationOf(bodyOf(getFixture, label)), id)));
/** `error-orchestration-cancel` (700432) con `extra` después de `Errors`: `Results` o `Reservation`. */
const rejectedWith = (extra: string) => xml(200, bodyOf(updateFixture, 'error-orchestration-cancel').replace('</stl19:Errors>', `</stl19:Errors>${extra}`));
/** `get <label>` con el `Product` del segmento `id` cambiado por `product` (`undefined` lo quita). */
const getWithProduct = (label: string, id: string, product: string | undefined) =>
  xml(
    200,
    bodyOf(getFixture, label).replace(
      new RegExp(`<stl19:Product id="${id}">[\\s\\S]*?</stl19:Product>`),
      (found) => (product === undefined ? '' : found.replace(`<stl19:Product id="${id}">`, `<stl19:Product id="${product}">`)),
    ),
  );

// get tk-un: 8 UN, 10 TK, 9 HK. get tk-hx: 8 HX, 10 TK, 9 HK. get tk-un-hx: 8 UN, 10 HX, 12 TK, 9 HK.
const REQUEST: RemoveAirSegmentsRequest = { locator: 'AAAAAA', receivedFrom: 'SCHEDULE CHANGE', segmentIds: ['8'] };

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const { client, calls } = legacyClient(fetch);
  const session = await client.openSession();
  return { fetch, session, calls };
}

/** El elemento `root` completo: hasta su cierre, o hasta `/>` si es vacío. */
const payloadOf = (envelope: string, root: string) => new RegExp(`<${root}\\b[^>]*?(/>|>[\\s\\S]*?</${root}>)`).exec(envelope)?.[0];
const actions = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.slice(1).map((_call, index) => sentTag(sentBody(fetch, index + 1), 'eb:Action'));
const states = (segments: { id: string; previousStatus?: string; status: string }[]) => segments.map((segment) => [segment.id, segment.previousStatus, segment.status]);

describe('reservation.removeAirSegments: requests', () => {
  it('manda GetReservationRQ Stateful y UpdateReservationRQ con un ProductUpdate op="D" por segmento, en una sola llamada', async () => {
    const { fetch, session } = await openWith(get('tk-un-hx'), update('delete-un-hx'));
    await session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['8', '10'] });

    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ']);
    expect(payloadOf(sentBody(fetch, 1), 'GetReservationRQ')).toBe(
      '<GetReservationRQ Version="1.19.0" xmlns="http://webservices.sabre.com/pnrbuilder/v1_19"><Locator>AAAAAA</Locator>' +
        '<RequestType>Stateful</RequestType><ReturnOptions><SubjectAreas><SubjectArea>FULL</SubjectArea></SubjectAreas></ReturnOptions></GetReservationRQ>',
    );
    expect(payloadOf(sentBody(fetch, 2), 'UpdateReservationRQ')).toBe(
      '<UpdateReservationRQ Version="1.19.0" xmlns="http://webservices.sabre.com/pnrbuilder/v1_19">' +
        '<RequestType commitTransaction="true">Stateful</RequestType>' +
        '<ReturnOptions RetrievePNR="true" IncludeUpdateDetails="true"><ViewName>Full</ViewName></ReturnOptions>' +
        '<ReservationUpdateList>' +
        '<ReservationUpdateItem UpdateId="1"><ProductUpdate id="8" op="D"/></ReservationUpdateItem>' +
        '<ReservationUpdateItem UpdateId="2"><ProductUpdate id="10" op="D"/></ReservationUpdateItem>' +
        '<ReceivedFrom><Name>SCHEDULE CHANGE</Name></ReceivedFrom></ReservationUpdateList></UpdateReservationRQ>',
    );
  });

  it('segmentIds repetidos o con espacios salen una sola vez', async () => {
    const { fetch, session } = await openWith(get('tk-un'), update('delete-un'));
    await session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['8', ' 8 '] });
    expect(sentBody(fetch, 2).match(/<ProductUpdate /g)).toHaveLength(1);
  });

  it('escapa receivedFrom', async () => {
    const { fetch, session } = await openWith(get('tk-un'), update('delete-un'));
    await session.reservation.removeAirSegments({ ...REQUEST, receivedFrom: 'A&B <C>' });
    expect(sentBody(fetch, 2)).toContain('<Name>A&amp;B &lt;C&gt;</Name>');
  });

  it('entrega onRawRequest por cada llamada, con la operación', async () => {
    const requests: SabreRawRequest[] = [];
    const { session } = await openWith(get('tk-un'), update('error-orchestration-cancel'), ignored());
    await rejection(session.reservation.removeAirSegments(REQUEST, { onRawRequest: (raw) => requests.push(raw) }));
    expect(requests.map((raw) => [raw.operation, /<(\w+RQ) /.exec(raw.body ?? '')?.[1]])).toEqual([
      ['reservation.removeAirSegments', 'GetReservationRQ'],
      ['reservation.removeAirSegments', 'UpdateReservationRQ'],
      ['reservation.removeAirSegments', 'IgnoreTransactionRQ'],
    ]);
  });
});

describe('reservation.removeAirSegments: resultado', () => {
  it('baja de un UN', async () => {
    const { session } = await openWith(get('tk-un'), update('delete-un'));
    const result = await session.reservation.removeAirSegments(REQUEST);

    expect(result).toEqual({
      status: 'removed',
      locator: 'AAAAAA',
      segments: [
        expect.objectContaining({ id: '10', sequence: 1, previousStatus: 'TK', status: 'TK' }),
        expect.objectContaining({ id: '9', sequence: 2, previousStatus: 'HK', status: 'HK' }),
      ],
      changed: ['8'],
      warnings: [],
      respondedAt: '2026-11-16T21:42:37Z',
    });
  });

  it('baja de un HX', async () => {
    const { session } = await openWith(get('tk-hx'), update('delete-hx'));
    const result = await session.reservation.removeAirSegments(REQUEST);

    expect(result.status).toBe('removed');
    expect(states(result.segments)).toEqual([
      ['10', 'TK', 'TK'],
      ['9', 'HK', 'HK'],
    ]);
    expect(result.changed).toEqual(['8']);
    expect(result.warnings).toEqual([]);
  });

  it('baja de un UN y un HX juntos', async () => {
    const { session } = await openWith(get('tk-un-hx'), update('delete-un-hx'));
    const result = await session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['10', '8'] });

    expect(states(result.segments)).toEqual([
      ['12', 'TK', 'TK'],
      ['9', 'HK', 'HK'],
    ]);
    expect(result.changed).toEqual(['8', '10']);
    expect(result.warnings).toEqual([]);
  });

  it('allowedStatuses ampliado: borra un HK si se incluye', async () => {
    const { fetch, session } = await openWith(get('tk-un'), deletedFrom('tk-un', '9'));
    const result = await session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['9'], allowedStatuses: ['UN', 'HX', 'hk'] });

    expect(sentBody(fetch, 2)).toContain('<ProductUpdate id="9" op="D"/>');
    expect(states(result.segments)).toEqual([
      ['8', 'UN', 'UN'],
      ['10', 'TK', 'TK'],
    ]);
    expect(result.changed).toEqual(['9']);
    expect(result.warnings).toEqual([]);
  });

  it('UNEXPECTED_CHANGE: desaparece un segmento que no se pidió (un HK casado, por ejemplo)', async () => {
    const { session } = await openWith(get('tk-un'), deleteUnWithout('9'));
    const result = await session.reservation.removeAirSegments(REQUEST);

    expect(result.status).toBe('removed');
    expect(result.changed).toEqual(['8', '9']);
    expect(result.warnings).toEqual([{ code: 'UNEXPECTED_CHANGE', message: expect.stringContaining('9 (ya no está)'), segmentIds: ['9'] }]);
  });

  it('NOT_APPLIED: Success, pero el segmento pedido sigue en el PNR', async () => {
    const { session } = await openWith(get('tk-un'), update('delete-not-applied'));
    const result = await session.reservation.removeAirSegments(REQUEST);

    expect(result.status).toBe('removed');
    expect(result.changed).toEqual([]);
    expect(result.warnings).toEqual([{ code: 'NOT_APPLIED', message: expect.stringContaining('8 (sigue en el PNR en UN)'), segmentIds: ['8'] }]);
  });

  it('NOT_APPLIED: Success, pero el UpdateResult de la baja no es SUCCESS', async () => {
    const { session } = await openWith(get('tk-un-hx'), xml(200, bodyOf(updateFixture, 'delete-un-hx').replace('UpdateId="2" Status="SUCCESS"', 'UpdateId="2" Status="FAILED"')));
    const result = await session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['8', '10'] });

    expect(result.changed).toEqual(['8', '10']);
    expect(result.warnings).toEqual([{ code: 'NOT_APPLIED', message: expect.stringContaining('10 (UpdateResult FAILED)'), segmentIds: ['10'] }]);
  });

  it('el default es UN y HX', () => {
    expect(DEFAULT_REMOVABLE_STATUSES).toEqual(['UN', 'HX']);
    expect(Object.isFrozen(DEFAULT_REMOVABLE_STATUSES)).toBe(true);
  });
});

describe('reservation.removeAirSegments: no escribe', () => {
  it('SEGMENT_NOT_FOUND si un segmento no está en el PNR, sin mandar Update ni borrar los demás', async () => {
    const { fetch, session } = await openWith(get('tk-un'));
    const error = await rejection(session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['8', '99'] }));

    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({
      service: 'updateReservation',
      reason: 'SEGMENT_NOT_FOUND',
      code: 'SEGMENT_NOT_FOUND',
      retryable: false,
      expectedSegments: ['8', '99'],
      actualSegments: ['99'],
    });
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it('SEGMENT_STATUS_NOT_ALLOWED con un HK y el default, sin mandar Update', async () => {
    const { fetch, session } = await openWith(get('tk-un'));
    const error = await rejection(session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['8', '9'] }));

    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toMatchObject({ reason: 'SEGMENT_STATUS_NOT_ALLOWED', code: 'SEGMENT_STATUS_NOT_ALLOWED', expectedSegments: ['8', '9'], actualSegments: ['9'] });
    expect((error as Error).message).toContain('9 (HK)');
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it('SEGMENT_STATUS_NOT_ALLOWED con un TK y el default', async () => {
    const { fetch, session } = await openWith(get('tk-un'));
    const error = await rejection(session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['10'] }));
    expect(error).toMatchObject({ reason: 'SEGMENT_STATUS_NOT_ALLOWED', actualSegments: ['10'] });
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it('allowedStatuses reemplaza el default: un UN fuera de la lista no se borra', async () => {
    const { session } = await openWith(get('tk-un'));
    const error = await rejection(session.reservation.removeAirSegments({ ...REQUEST, allowedStatuses: ['HX'] }));
    expect(error).toMatchObject({ reason: 'SEGMENT_STATUS_NOT_ALLOWED', actualSegments: ['8'] });
  });

  it('SEGMENT_ID_MISMATCH si el Product@id no es el Air@id, sin mandar Update (Q-140)', async () => {
    const { fetch, session } = await openWith(getWithProduct('tk-un', '8', '9'));
    const error = await rejection(session.reservation.removeAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toMatchObject({ reason: 'SEGMENT_ID_MISMATCH', code: 'SEGMENT_ID_MISMATCH', expectedSegments: ['8'], actualSegments: ['8'] });
    expect((error as Error).message).toContain('8 (Product@id 9)');
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it('SEGMENT_ID_MISMATCH si el segmento no trae Product', async () => {
    const { fetch, session } = await openWith(getWithProduct('tk-un', '8', undefined));
    const error = await rejection(session.reservation.removeAirSegments(REQUEST));

    expect(error).toMatchObject({ reason: 'SEGMENT_ID_MISMATCH', actualSegments: ['8'] });
    expect((error as Error).message).toContain('8 (Product@id ausente)');
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it('SEGMENT_ID_MISMATCH va antes que SEGMENT_STATUS_NOT_ALLOWED', async () => {
    const { session } = await openWith(getWithProduct('tk-un', '8', '14'));
    const error = await rejection(session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['8', '9'] }));
    expect(error).toMatchObject({ reason: 'SEGMENT_ID_MISMATCH', actualSegments: ['8'] });
  });

  it('SEGMENT_NOT_FOUND va antes que SEGMENT_STATUS_NOT_ALLOWED', async () => {
    const { session } = await openWith(get('tk-un'));
    const error = await rejection(session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['9', '99'] }));
    expect(error).toMatchObject({ reason: 'SEGMENT_NOT_FOUND', actualSegments: ['99'] });
  });

  it('PNR no encontrado en la lectura: SABRE_ERROR 700226, sin Update ni IgnoreTransaction', async () => {
    const { fetch, session } = await openWith(get('error-pnr-not-found'));
    const error = await rejection(session.reservation.removeAirSegments(REQUEST));

    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code: '700226', service: 'updateReservation', retryable: false });
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it.each([
    ['localizador corto', { ...REQUEST, locator: 'AAAAA' }],
    ['receivedFrom vacío', { ...REQUEST, receivedFrom: ' ' }],
    ['sin segmentIds', { locator: 'AAAAAA', receivedFrom: 'X' }],
    ['segmentIds vacío', { ...REQUEST, segmentIds: [] }],
    ['id vacío', { ...REQUEST, segmentIds: ['8', ''] }],
    ['allowedStatuses vacío', { ...REQUEST, allowedStatuses: [] }],
    ['allowedStatuses con un estado vacío', { ...REQUEST, allowedStatuses: ['UN', ' '] }],
    ['allowedStatuses que no es lista', { ...REQUEST, allowedStatuses: 'UN' }],
  ])('valida sin red: %s', async (_case, request) => {
    const { fetch, session } = await openWith();
    await expect(session.reservation.removeAirSegments(request as RemoveAirSegmentsRequest)).rejects.toThrow(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retry.maxRetries distinto de 0 lanza TypeError sin red', async () => {
    const { fetch, session } = await openWith();
    await expect(session.reservation.removeAirSegments(REQUEST, { retry: { maxRetries: 1 } })).rejects.toThrow(/reservation\.removeAirSegments.*retry\.maxRetries/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('reservation.removeAirSegments: errores de Sabre en el Update', () => {
  it.each([
    ['error-orchestration-cancel', '700432'],
    ['error-aaa-modified', '700411'],
    ['error-no-pnr-in-aaa', '700408'],
    ['error-ignore-or-commit', '500810'],
  ])('%s: IgnoreTransaction y SABRE_ERROR %s', async (label, code) => {
    const { fetch, session } = await openWith(get('tk-un'), update(label), ignored());
    const error = await rejection(session.reservation.removeAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code, service: 'updateReservation', retryable: false });
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ', 'IgnoreTransactionLLSRQ']);
  });

  it.each([
    ['UpdateResult SUCCESS del primero', '<stl19:Results><stl19:UpdateResult UpdateId="1" Status="SUCCESS"><stl19:Item op="D"/></stl19:UpdateResult><stl19:UpdateResult UpdateId="2" Status="FAILED"><stl19:Item op="D"/></stl19:UpdateResult></stl19:Results>', 'UpdateId 1'],
    ['Reservation sin el 8', () => withoutSegment(reservationOf(bodyOf(getFixture, 'tk-un-hx')), '8'), '8 ya no está'],
  ] as const)('baja parcial (%s): Errors con evidencia de una baja aplicada da PARTIALLY_APPLIED, sin IgnoreTransaction', async (_case, extra, detail) => {
    const { fetch, session } = await openWith(get('tk-un-hx'), rejectedWith(typeof extra === 'string' ? extra : extra()), ignored());
    const error = await rejection(session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['8', '10'] }));

    expect(error).toBeInstanceOf(SabreUncertainOutcomeError);
    expect(error).toMatchObject({ reason: 'PARTIALLY_APPLIED', operation: 'reservation.removeAirSegments', confirmationId: 'AAAAAA', retryable: false });
    expect((error as Error).message).toContain(detail);
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ']);
  });

  it.each([
    ['UpdateResult sin ningún SUCCESS', '<stl19:Results><stl19:UpdateResult UpdateId="1" Status="FAILED"><stl19:Item op="D"/></stl19:UpdateResult></stl19:Results>'],
    ['Reservation con los dos segmentos', () => reservationOf(bodyOf(getFixture, 'tk-un-hx'))],
    ['Reservation sin Segments', () => reservationOf(bodyOf(getFixture, 'tk-un-hx')).replace(/<stl19:Segments>[\s\S]*<\/stl19:Segments>/, '')],
  ] as const)('Errors sin evidencia de baja (%s): SABRE_ERROR con IgnoreTransaction', async (_case, extra) => {
    const { fetch, session } = await openWith(get('tk-un-hx'), rejectedWith(typeof extra === 'string' ? extra : extra()), ignored());
    const error = await rejection(session.reservation.removeAirSegments({ ...REQUEST, segmentIds: ['8', '10'] }));

    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code: '700432' });
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ', 'IgnoreTransactionLLSRQ']);
  });

  it('si el IgnoreTransaction falla, avisa al logger con la operación y lanza el error de Sabre', async () => {
    const { session, calls } = await openWith(get('tk-un'), update('error-orchestration-cancel'), xml(500, soap(fault('soap-env:Server', 'boom'))));
    const error = await rejection(session.reservation.removeAirSegments(REQUEST));

    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code: '700432' });
    expect(calls).toContainEqual(['warn', 'sabre.reservation.ignoreFailed', expect.objectContaining({ operation: 'reservation.removeAirSegments' })]);
  });
});

describe('reservation.removeAirSegments: inciertos', () => {
  const deleted = bodyOf(updateFixture, 'delete-un');

  it.each([
    ['TRANSPORT', () => new TypeError('fetch failed')],
    ['GATEWAY_5XX', () => xml(500, soap(fault('soap-env:Server', 'Internal error')))],
    ['UNPARSEABLE', () => new Response('<html>oops</html>', { status: 200 })],
    ['UNPARSEABLE', () => xml(200, deleted.replace('<stl19:Success>OK</stl19:Success>', ''))],
    [
      'END_TRANSACTION_PROBLEM',
      () =>
        xml(
          200,
          deleted.replace(
            '<stl19:Success>OK</stl19:Success>',
            '<stl19:Success>OK</stl19:Success><stl19:Errors><stl19:Error><stl19:Code>700000</stl19:Code><stl19:Message>END TRANSACTION</stl19:Message></stl19:Error></stl19:Errors>',
          ),
        ),
    ],
  ] as const)('%s: incierto con la operación y el localizador, sin IgnoreTransaction', async (reason, response) => {
    const { fetch, session } = await openWith(get('tk-un'), response());
    const error = await rejection(session.reservation.removeAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreUncertainOutcomeError);
    expect(error).toMatchObject({ reason, operation: 'reservation.removeAirSegments', confirmationId: 'AAAAAA', retryable: false });
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ']);
  });

  it.each([
    ['como SOAP fault 500', 'GATEWAY_5XX', () => xml(500, soap(fault('soap-env:Server', 'PREVIOUS ENTRY ACTIVE')))],
    ['como stl:ApplicationResults/Error', 'PREVIOUS_ENTRY_ACTIVE', () => applicationError('UpdateReservationRS', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'PREVIOUS ENTRY ACTIVE')],
    [
      'como Errors/Error de STL 1.19',
      'PREVIOUS_ENTRY_ACTIVE',
      () =>
        xml(
          200,
          bodyOf(updateFixture, 'error-orchestration-cancel')
            .replace('<stl19:Code>700432</stl19:Code>', '<stl19:Code>700000</stl19:Code>')
            .replace(/<stl19:Message>[\s\S]*?<\/stl19:Message>/, '<stl19:Message>PREVIOUS ENTRY ACTIVE</stl19:Message>'),
        ),
    ],
  ] as const)('PREVIOUS ENTRY ACTIVE en el Update (%s): incierto %s, un solo UpdateReservationRQ y sin IgnoreTransaction', async (_case, reason, response) => {
    // Si el transporte lo reintentara, el segundo Update recibiría delete-un y saldría `removed`.
    const { fetch, session, calls } = await openWith(get('tk-un'), response(), update('delete-un'), ignored());
    const error = await rejection(session.reservation.removeAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreUncertainOutcomeError);
    expect(error).toMatchObject({ reason, operation: 'reservation.removeAirSegments', confirmationId: 'AAAAAA' });
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ']);
    expect(fetch.mock.calls.filter((_call, index) => /<UpdateReservationRQ /.test(sentBody(fetch, index)))).toHaveLength(1);
    expect(calls.some(([, event]) => event === 'sabre.request.retry')).toBe(false);
  });

  it('un abort con el Update ya mandado da ABORTED', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const { session } = await openWith(get('tk-un'), abort);
    const error = await rejection(session.reservation.removeAirSegments(REQUEST, { signal: new AbortController().signal }));

    expect(error).toBeInstanceOf(SabreUncertainOutcomeError);
    expect(error).toMatchObject({ reason: 'ABORTED', operation: 'reservation.removeAirSegments' });
    expect((error as Error).cause).toBe(abort);
  });

  it('un abort antes del Update se propaga tal cual y no manda el Update', async () => {
    const controller = new AbortController();
    const { fetch, session } = await openWith(get('tk-un'));
    const error = await rejection(
      session.reservation.removeAirSegments(REQUEST, {
        signal: controller.signal,
        onRawResponse: () => controller.abort(new DOMException('cancelado', 'AbortError')),
      }),
    );

    expect(error).not.toBeInstanceOf(SabreUncertainOutcomeError);
    expect((error as Error).name).toBe('AbortError');
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it('USG_*_BUSY en el Update sale tal cual y no se reintenta', async () => {
    const { fetch, session } = await openWith(get('tk-un'), xml(500, soap(fault('soap-env:Server.USG_SERVICE_IS_BUSY', 'busy'))));
    const error = await rejection(session.reservation.removeAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error).not.toBeInstanceOf(SabreUncertainOutcomeError);
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ']);
  });

  it('una sesión inválida en el Update sale como SabreSessionError', async () => {
    const { session } = await openWith(get('tk-un'), xml(500, soap(fault('soap-env:Client.InvalidSecurityToken', 'USG_INVALID_SESSION'))));
    const error = await rejection(session.reservation.removeAirSegments(REQUEST));
    expect(error).toBeInstanceOf(SabreSessionError);
  });
});

// Lo que usa el fake de #270 para aplicar los mismos chequeos que el SDK (ADR-034 §5).
describe('checkRemovableSegments y validateRemoveAirSegmentsRequest', () => {
  const segment = (id: string, status: string, productId: string | null = id) => ({ id, sequence: Number(id), status, ...(productId === null ? {} : { productId }) });
  const pnr = [segment('8', 'UN'), segment('10', 'TK'), segment('9', 'HK'), segment('11', 'HX', '12')];
  const check = (ids: string[], allowed: string[] = ['UN', 'HX'], raw?: unknown) => {
    try {
      checkRemovableSegments(pnr, ids, allowed, raw);
    } catch (error) {
      return error as SabreReservationUpdateError;
    }
    return undefined;
  };

  it('no lanza si cada segmento existe, su Product@id es su id y su estado está permitido', () => {
    expect(check(['8'])).toBeUndefined();
    expect(check(['8', '9'], ['UN', 'HK'])).toBeUndefined();
  });

  it('precedencia: SEGMENT_NOT_FOUND, luego SEGMENT_ID_MISMATCH, luego SEGMENT_STATUS_NOT_ALLOWED', () => {
    expect(check(['99', '11', '9'])).toMatchObject({ reason: 'SEGMENT_NOT_FOUND', expectedSegments: ['99', '11', '9'], actualSegments: ['99'] });
    expect(check(['11', '9'])).toMatchObject({ reason: 'SEGMENT_ID_MISMATCH', actualSegments: ['11'] });
    expect(check(['8', '9', '10'])).toMatchObject({ reason: 'SEGMENT_STATUS_NOT_ALLOWED', actualSegments: ['9', '10'] });
  });

  it('un segmento sin productId es SEGMENT_ID_MISMATCH', () => {
    const error = (() => {
      try {
        checkRemovableSegments([segment('8', 'UN', null)], ['8'], ['UN']);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    })();
    expect(error).toMatchObject({ reason: 'SEGMENT_ID_MISMATCH', actualSegments: ['8'] });
  });

  it('raw es opcional: va en el error si se pasa', () => {
    expect(check(['99'])?.raw).toBeUndefined();
    expect(check(['99'], ['UN'], '<xml/>')?.raw).toBe('<xml/>');
  });

  it('validateRemoveAirSegmentsRequest normaliza ids y estados', () => {
    expect(validateRemoveAirSegmentsRequest({ ...REQUEST, segmentIds: [' 8 ', '8', '10'] }, {})).toEqual({ segmentIds: ['8', '10'], allowedStatuses: ['UN', 'HX'] });
    expect(validateRemoveAirSegmentsRequest({ ...REQUEST, allowedStatuses: [' hk', 'HK', 'un'] }, {})).toEqual({ segmentIds: ['8'], allowedStatuses: ['HK', 'UN'] });
    expect(() => validateRemoveAirSegmentsRequest({ ...REQUEST, allowedStatuses: [] }, {})).toThrow(TypeError);
  });
});
