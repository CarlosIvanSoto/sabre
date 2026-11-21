// session.reservation.confirmAirSegments (#268, ADR-034) contra las fixtures sintéticas de #267:
// GetReservationRS y UpdateReservationRS armados desde los ejemplos oficiales de Update Itinerary.
import { describe, expect, it } from 'vitest';
import {
  type ConfirmAirSegmentsRequest,
  SabreBusinessError,
  SabreGatewayError,
  type SabreRawRequest,
  type SabreRawResponse,
  SabreReservationUpdateError,
  SabreSessionError,
  SabreUncertainOutcomeError,
} from '../src/index.js';
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

/** Un `<root>` con `stl:ApplicationResults/Error`: lo lanza el transporte antes de que el SDK lo lea. */
const applicationError = (root: 'GetReservationRS' | 'UpdateReservationRS', code: string, text: string) =>
  xml(
    200,
    soap(
      `<${root} xmlns="http://webservices.sabre.com/pnrbuilder/v1_19" xmlns:stl="http://services.sabre.com/STL/v01" Version="1.19.0"><stl:ApplicationResults status="NotProcessed">${entry('Error', code, text)}</stl:ApplicationResults></${root}>`,
    ),
  );

const REQUEST: ConfirmAirSegmentsRequest = { locator: 'AAAAAA', receivedFrom: 'SCHEDULE CHANGE', expectedSegmentIds: ['8', '9'] };

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const { client, calls } = legacyClient(fetch);
  const session = await client.openSession();
  return { fetch, session, calls };
}

const payloadOf = (envelope: string, root: string) => new RegExp(`<${root}[\\s\\S]*?(</${root}>|/>)`).exec(envelope)?.[0];
/** Las acciones que salieron después de `SessionCreateRQ`. */
const actions = (fetch: ReturnType<typeof mockFetch>) => fetch.mock.calls.slice(1).map((_call, index) => sentTag(sentBody(fetch, index + 1), 'eb:Action'));

describe('reservation.confirmAirSegments: requests', () => {
  it('manda GetReservationRQ Stateful y UpdateReservationRQ CONFIRM-ALL con commitTransaction, RetrievePNR y ReceivedFrom', async () => {
    const { fetch, session } = await openWith(get('official-tk'), update('confirm-all-official'));
    await session.reservation.confirmAirSegments(REQUEST);

    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ']);
    expect(payloadOf(sentBody(fetch, 1), 'GetReservationRQ')).toBe(
      '<GetReservationRQ Version="1.19.0" xmlns="http://webservices.sabre.com/pnrbuilder/v1_19"><Locator>AAAAAA</Locator>' +
        '<RequestType>Stateful</RequestType><ReturnOptions><SubjectAreas><SubjectArea>FULL</SubjectArea></SubjectAreas></ReturnOptions></GetReservationRQ>',
    );
    expect(payloadOf(sentBody(fetch, 2), 'UpdateReservationRQ')).toBe(
      '<UpdateReservationRQ Version="1.19.0" xmlns="http://webservices.sabre.com/pnrbuilder/v1_19">' +
        '<RequestType commitTransaction="true">Stateful</RequestType>' +
        '<ReturnOptions RetrievePNR="true" IncludeUpdateDetails="true"><ViewName>Full</ViewName></ReturnOptions>' +
        '<ReservationUpdateList><ReservationUpdateItem UpdateId="1"><AirItineraryUpdate><Action>CONFIRM-ALL</Action></AirItineraryUpdate></ReservationUpdateItem>' +
        '<ReceivedFrom><Name>SCHEDULE CHANGE</Name></ReceivedFrom></ReservationUpdateList></UpdateReservationRQ>',
    );
  });

  it('escapa receivedFrom', async () => {
    const { fetch, session } = await openWith(get('official-tk'), update('confirm-all-official'));
    await session.reservation.confirmAirSegments({ ...REQUEST, receivedFrom: 'A&B <C>' });
    expect(sentBody(fetch, 2)).toContain('<Name>A&amp;B &lt;C&gt;</Name>');
  });

  it('entrega onRawRequest y onRawResponse por cada llamada, con la operación', async () => {
    const requests: SabreRawRequest[] = [];
    const responses: SabreRawResponse[] = [];
    const { session } = await openWith(get('official-tk'), update('confirm-all-official'));
    await session.reservation.confirmAirSegments(REQUEST, {
      onRawRequest: (raw) => requests.push(raw),
      onRawResponse: (raw) => responses.push(raw),
    });
    expect(requests.map((raw) => [raw.operation, /<(\w+RQ) /.exec(raw.body ?? '')?.[1]])).toEqual([
      ['reservation.confirmAirSegments', 'GetReservationRQ'],
      ['reservation.confirmAirSegments', 'UpdateReservationRQ'],
    ]);
    expect(responses.map((raw) => raw.operation)).toEqual(['reservation.confirmAirSegments', 'reservation.confirmAirSegments']);
  });

  it('el IgnoreTransaction también entrega onRawRequest y onRawResponse', async () => {
    const requests: SabreRawRequest[] = [];
    const responses: SabreRawResponse[] = [];
    const { session } = await openWith(get('official-tk'), update('error-aaa-modified'), ignored());
    await rejection(
      session.reservation.confirmAirSegments(REQUEST, {
        onRawRequest: (raw) => requests.push(raw),
        onRawResponse: (raw) => responses.push(raw),
      }),
    );
    expect(requests.map((raw) => [raw.operation, /<(\w+RQ) /.exec(raw.body ?? '')?.[1]])).toEqual([
      ['reservation.confirmAirSegments', 'GetReservationRQ'],
      ['reservation.confirmAirSegments', 'UpdateReservationRQ'],
      ['reservation.confirmAirSegments', 'IgnoreTransactionRQ'],
    ]);
    expect(responses).toHaveLength(3);
  });
});

describe('reservation.confirmAirSegments: resultado', () => {
  it('confirmed: los TK pasan a HK, con previousStatus y changed', async () => {
    const { session } = await openWith(get('official-tk'), update('confirm-all-official'));
    const result = await session.reservation.confirmAirSegments(REQUEST);

    expect(result).toEqual({
      status: 'confirmed',
      locator: 'AAAAAA',
      segments: [
        {
          id: '8',
          productId: '8',
          sequence: 1,
          marketingCarrier: 'B6',
          flightNumber: '3309',
          from: 'JFK',
          to: 'FLL',
          departure: '2021-03-30T11:45:00',
          arrival: '2021-03-30T13:00:00',
          previousStatus: 'TK',
          status: 'HK',
        },
        {
          id: '9',
          productId: '9',
          sequence: 2,
          marketingCarrier: 'B6',
          flightNumber: '1908',
          from: 'FLL',
          to: 'JFK',
          departure: '2021-04-15T12:00:00',
          arrival: '2021-04-15T14:50:00',
          previousStatus: 'TK',
          status: 'HK',
        },
      ],
      changed: ['8', '9'],
      warnings: [],
      respondedAt: '2026-11-16T21:42:37Z',
    });
  });

  it('TK con UN: confirma el TK y deja el UN; changed solo trae el TK', async () => {
    const { session } = await openWith(get('tk-un'), update('confirm-all-tk-un'));
    const result = await session.reservation.confirmAirSegments({ ...REQUEST, expectedSegmentIds: ['10'] });

    expect(result.status).toBe('confirmed');
    expect(result.segments.map((segment) => [segment.id, segment.previousStatus, segment.status])).toEqual([
      ['8', 'UN', 'UN'],
      ['10', 'TK', 'HK'],
      ['9', 'HK', 'HK'],
    ]);
    expect(result.changed).toEqual(['10']);
    expect(result.warnings).toEqual([]);
  });

  it('NOT_APPLIED: Success, pero un TK esperado no quedó en HK', async () => {
    const { session } = await openWith(get('tk-un'), update('confirm-all-not-applied'));
    const result = await session.reservation.confirmAirSegments({ ...REQUEST, expectedSegmentIds: ['10'] });

    expect(result.status).toBe('confirmed');
    expect(result.changed).toEqual([]);
    expect(result.warnings).toEqual([{ code: 'NOT_APPLIED', message: expect.stringContaining('10 (TK)'), segmentIds: ['10'] }]);
  });

  it('noop: sin ningún TK no manda Update, aunque expectedSegmentIds no coincida', async () => {
    const { fetch, session } = await openWith(get('hk-only'));
    const result = await session.reservation.confirmAirSegments(REQUEST);

    expect(actions(fetch)).toEqual(['GetReservationRQ']);
    expect(result).toMatchObject({ status: 'noop', locator: 'AAAAAA', changed: [], warnings: [], respondedAt: '2026-11-16T21:42:37Z' });
    expect(result.segments.map((segment) => [segment.id, segment.previousStatus, segment.status])).toEqual([
      ['8', 'HK', 'HK'],
      ['9', 'HK', 'HK'],
    ]);
  });

  it('TK con KK: el chequeo solo mira los TK; el KK tocado sale en changed y en UNEXPECTED_CHANGE (Q-139)', async () => {
    const { session } = await openWith(get('tk-kk'), update('confirm-all-official'));
    const result = await session.reservation.confirmAirSegments({ ...REQUEST, expectedSegmentIds: ['8'] });
    expect(result.changed).toEqual(['8', '9']);
    expect(result.segments.find((segment) => segment.id === '9')).toMatchObject({ previousStatus: 'KK', status: 'HK' });
    expect(result.warnings).toEqual([{ code: 'UNEXPECTED_CHANGE', message: expect.stringContaining('9 (HK)'), segmentIds: ['9'] }]);
  });

  it('expectedSegmentIds se compara como conjunto: orden y repetidos no importan', async () => {
    const { session } = await openWith(get('official-tk'), update('confirm-all-official'));
    const result = await session.reservation.confirmAirSegments({ ...REQUEST, expectedSegmentIds: ['9', '8', '9'] });
    expect(result.status).toBe('confirmed');
  });
});

describe('reservation.confirmAirSegments: no escribe', () => {
  it.each([
    ['falta uno', ['8']],
    ['sobra uno', ['8', '9', '10']],
    ['otro id', ['8', '10']],
  ])('SEGMENTS_CHANGED si los TK no son los esperados (%s), sin mandar Update', async (_case, expectedSegmentIds) => {
    const { fetch, session } = await openWith(get('official-tk'));
    const error = await rejection(session.reservation.confirmAirSegments({ ...REQUEST, expectedSegmentIds }));

    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({
      service: 'updateReservation',
      reason: 'SEGMENTS_CHANGED',
      code: 'SEGMENTS_CHANGED',
      retryable: false,
      expectedSegments: [...new Set(expectedSegmentIds)],
      actualSegments: ['8', '9'],
    });
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it('un stl:ApplicationResults/Error en la lectura: SABRE_ERROR, sin Update ni IgnoreTransaction', async () => {
    const { fetch, session } = await openWith(applicationError('GetReservationRS', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'UNABLE TO RETRIEVE'));
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code: 'ERR.SWS.HOST.ERROR_IN_RESPONSE' });
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it('PNR no encontrado en la lectura: SABRE_ERROR 700226, sin Update ni IgnoreTransaction', async () => {
    const { fetch, session } = await openWith(get('error-pnr-not-found'));
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code: '700226', severity: 'MODERATE', service: 'updateReservation', retryable: false });
    expect((error as Error).message).toContain('PNR not found');
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it.each(['    ', ''])('valida sin red: receivedFrom vacío (%j)', async (receivedFrom) => {
    const { fetch, session } = await openWith();
    await expect(session.reservation.confirmAirSegments({ ...REQUEST, receivedFrom })).rejects.toThrow(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['localizador corto', { ...REQUEST, locator: 'AAAAA' }],
    ['localizador en minúscula', { ...REQUEST, locator: 'aaaaaa' }],
    ['sin expectedSegmentIds', { locator: 'AAAAAA', receivedFrom: 'X' }],
    ['expectedSegmentIds vacío', { ...REQUEST, expectedSegmentIds: [] }],
    ['id vacío', { ...REQUEST, expectedSegmentIds: ['8', ' '] }],
  ])('valida sin red: %s', async (_case, request) => {
    const { fetch, session } = await openWith();
    await expect(session.reservation.confirmAirSegments(request as ConfirmAirSegmentsRequest)).rejects.toThrow(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retry.maxRetries distinto de 0 lanza TypeError sin red; 0 se acepta', async () => {
    const { fetch, session } = await openWith(get('hk-only'));
    await expect(session.reservation.confirmAirSegments(REQUEST, { retry: { maxRetries: 2 } })).rejects.toThrow(/retry\.maxRetries/);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(session.reservation.confirmAirSegments(REQUEST, { retry: { maxRetries: 0 } })).resolves.toMatchObject({ status: 'noop' });
  });
});

describe('reservation.confirmAirSegments: errores de Sabre en el Update', () => {
  it.each([
    ['error-orchestration-cancel', '700432'],
    ['error-aaa-modified', '700411'],
    ['error-no-pnr-in-aaa', '700408'],
    ['error-ignore-or-commit', '500810'],
  ])('%s: IgnoreTransaction y SABRE_ERROR %s', async (label, code) => {
    const { fetch, session } = await openWith(get('official-tk'), update(label), ignored());
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code, severity: 'MODERATE', service: 'updateReservation', retryable: false });
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ', 'IgnoreTransactionLLSRQ']);
    expect(payloadOf(sentBody(fetch, 3), 'IgnoreTransactionRQ')).toBe(
      '<IgnoreTransactionRQ Version="2.0.0" xmlns="http://webservices.sabre.com/sabreXML/2011/10"/>',
    );
  });

  it('un stl:ApplicationResults/Error en el Update: IgnoreTransaction y SABRE_ERROR, no un SabreBusinessError pelado', async () => {
    const { fetch, session } = await openWith(get('official-tk'), applicationError('UpdateReservationRS', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'UNABLE TO PROCESS'), ignored());
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code: 'ERR.SWS.HOST.ERROR_IN_RESPONSE', service: 'updateReservation', retryable: false });
    expect((error as Error).cause).toBeInstanceOf(SabreBusinessError);
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ', 'IgnoreTransactionLLSRQ']);
  });

  it('si el IgnoreTransaction falla, avisa al logger y lanza el error de Sabre', async () => {
    const { session, calls } = await openWith(
      get('official-tk'),
      update('error-aaa-modified'),
      xml(500, soap(fault('soap-env:Server', 'boom'))),
    );
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));

    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code: '700411' });
    expect(calls).toContainEqual(['warn', 'sabre.reservation.ignoreFailed', expect.objectContaining({ operation: 'reservation.confirmAirSegments' })]);
  });
});

describe('reservation.confirmAirSegments: inciertos', () => {
  const official = bodyOf(updateFixture, 'confirm-all-official');

  it.each([
    ['TRANSPORT', () => new TypeError('fetch failed')],
    ['GATEWAY_5XX', () => xml(500, soap(fault('soap-env:Server', 'Internal error')))],
    ['GATEWAY_5XX', () => new Response('<html>Bad gateway</html>', { status: 502 })],
    ['GATEWAY_5XX', () => xml(200, soap(fault('soap-env:Client', 'Invalid request')))],
    ['GATEWAY_5XX', () => xml(400, soap(fault('soap-env:Client', 'Invalid request')))],
    ['UNPARSEABLE', () => new Response('<html>oops</html>', { status: 200 })],
    ['UNPARSEABLE', () => new Response('<html>not found</html>', { status: 404 })],
    ['UNPARSEABLE', () => xml(200, official.replace(/<stl19:Reservation\b[\s\S]*<\/stl19:Reservation>/, ''))],
    ['UNPARSEABLE', () => xml(200, official.replace('<stl19:Success>OK</stl19:Success>', ''))],
    ['UNPARSEABLE', () => get('official-tk')],
    [
      'END_TRANSACTION_PROBLEM',
      () =>
        xml(
          200,
          official.replace(
            '<stl19:Success>OK</stl19:Success>',
            '<stl19:Success>OK</stl19:Success><stl19:Errors><stl19:Error><stl19:Code>700000</stl19:Code><stl19:Message>END TRANSACTION</stl19:Message></stl19:Error></stl19:Errors>',
          ),
        ),
    ],
  ] as const)('%s: incierto, sin IgnoreTransaction', async (reason, response) => {
    const { fetch, session } = await openWith(get('official-tk'), response());
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreUncertainOutcomeError);
    expect(error).toMatchObject({ reason, operation: 'reservation.confirmAirSegments', confirmationId: 'AAAAAA', retryable: false });
    expect((error as Error).message).toContain('Relee el PNR');
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
          official.replace(
            '<stl19:Success>OK</stl19:Success>',
            '<stl19:Errors><stl19:Error><stl19:Code>700000</stl19:Code><stl19:Message>PREVIOUS ENTRY ACTIVE</stl19:Message><stl19:Severity>MODERATE</stl19:Severity></stl19:Error></stl19:Errors>',
          ),
        ),
    ],
  ] as const)('PREVIOUS ENTRY ACTIVE en el Update (%s): incierto %s, un solo UpdateReservationRQ y sin IgnoreTransaction', async (_case, reason, response) => {
    // Si el transporte lo reintentara, el segundo Update recibiría confirm-all-official y saldría `confirmed`.
    const { fetch, session, calls } = await openWith(get('official-tk'), response(), update('confirm-all-official'), ignored());
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreUncertainOutcomeError);
    expect(error).toMatchObject({ reason, confirmationId: 'AAAAAA' });
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ']);
    expect(calls.some(([, event]) => event === 'sabre.request.retry')).toBe(false);
  });

  it('un abort con el Update ya mandado da ABORTED, con el AbortError en cause', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const { session } = await openWith(get('official-tk'), abort);
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST, { signal: new AbortController().signal }));

    expect(error).toMatchObject({ reason: 'ABORTED' });
    expect((error as Error).cause).toBe(abort);
  });

  it('un abort antes del Update se propaga tal cual y no manda el Update', async () => {
    const controller = new AbortController();
    const { fetch, session } = await openWith(get('official-tk'));
    const pending = session.reservation.confirmAirSegments(REQUEST, {
      signal: controller.signal,
      onRawResponse: () => controller.abort(new DOMException('cancelado', 'AbortError')),
    });
    const error = await rejection(pending);

    expect(error).not.toBeInstanceOf(SabreUncertainOutcomeError);
    expect((error as Error).name).toBe('AbortError');
    expect(actions(fetch)).toEqual(['GetReservationRQ']);
  });

  it('un abort en la lectura se propaga tal cual', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const { session } = await openWith(abort);
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST, { signal: new AbortController().signal }));
    expect(error).toBe(abort);
  });

  it('USG_*_BUSY en el Update sale tal cual: el gateway no lo procesó, y no se reintenta', async () => {
    const { fetch, session } = await openWith(get('official-tk'), xml(500, soap(fault('soap-env:Server.USG_SERVICE_IS_BUSY', 'busy'))));
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error).not.toBeInstanceOf(SabreUncertainOutcomeError);
    expect(error).toMatchObject({ code: 'USG_SERVICE_IS_BUSY' });
    expect(actions(fetch)).toEqual(['GetReservationRQ', 'UpdateReservationRQ']);
  });

  it('una sesión inválida en el Update sale como SabreSessionError', async () => {
    const { session } = await openWith(get('official-tk'), xml(500, soap(fault('soap-env:Client.InvalidSecurityToken', 'USG_INVALID_SESSION'))));
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));
    expect(error).toBeInstanceOf(SabreSessionError);
  });
});
