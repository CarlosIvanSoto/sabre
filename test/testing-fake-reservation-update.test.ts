// El fake de sabre-client/testing con las escrituras de ADR-034 (#270): los mismos casos que
// reservation-confirm-air-segments.test.ts (U.2) y reservation-remove-air-segments.test.ts (U.3),
// contra el estado del fake.
import { describe, expect, it } from 'vitest';
import { type ConfirmAirSegmentsRequest, type RemoveAirSegmentsRequest, SabreLegacy, SabreReservationUpdateError, SabreUncertainOutcomeError } from '../src/index.js';
import { createQueueFake, type QueueFakeAirSegment, type QueueFakeOptions, type QueueFakeReservationUpdateUncertainReason } from '../src/testing/index.js';
import { rejection } from './soap-helpers.js';

const NOW = new Date('2026-11-20T18:00:00Z');

function client(options: QueueFakeOptions) {
  const fake = createQueueFake({ now: () => NOW, ...options });
  const legacy = new SabreLegacy({
    environment: 'production',
    authVersion: 'v2',
    credentials: { username: 'V1:7971:ABCD:AA', password: 'epr-pass' },
    fetch: fake.fetch,
    retry: { maxRetries: 0 },
  });
  return { fake, legacy };
}

const segment = (id: string, status: string, extra: Partial<QueueFakeAirSegment> = {}): QueueFakeAirSegment => ({ id, status, ...extra });
const JFK_FLL = { marketingCarrier: 'B6', flightNumber: '3309', from: 'JFK', to: 'FLL', departure: '2021-03-30T11:45:00', arrival: '2021-03-30T13:00:00' };

/** Un PNR con dos TK (8 y 9), como el ejemplo oficial de CONFIRM-ALL. */
const pnr = (segments: QueueFakeAirSegment[] = [segment('8', 'TK', JFK_FLL), segment('9', 'TK')]) => ({ locator: 'AAAAAA', segments });
const REQUEST: ConfirmAirSegmentsRequest = { locator: 'AAAAAA', receivedFrom: 'SCHEDULE CHANGE', expectedSegmentIds: ['8', '9'] };

async function confirm(options: QueueFakeOptions, request: Partial<ConfirmAirSegmentsRequest> = {}, signal?: AbortSignal) {
  const { fake, legacy } = client(options);
  const session = await legacy.openSession();
  try {
    return { fake, result: await session.reservation.confirmAirSegments({ ...REQUEST, ...request }, signal === undefined ? {} : { signal }) };
  } finally {
    await session.close();
  }
}

/** Lo que el fake recibió, sin abrir ni cerrar la sesión. */
const commands = (fake: { calls: readonly { command: string }[] }) => fake.calls.map((call) => call.command).filter((command) => command !== 'open' && command !== 'close');
const statuses = (segments: readonly { id: string; status: string }[] | undefined) => segments?.map((item) => `${item.id}:${item.status}`);

describe('fake: reservation.confirmAirSegments, resultado', () => {
  it('confirmed: los TK pasan a HK en la respuesta y en el estado del fake', async () => {
    const { fake, result } = await confirm({ reservationUpdate: { reservations: [pnr()] } });
    expect(result.status).toBe('confirmed');
    expect(result.changed).toEqual(['8', '9']);
    expect(result.warnings).toEqual([]);
    expect(result.respondedAt).toBe('2026-11-20T18:00:00Z');
    expect(result.segments[0]).toEqual({ id: '8', sequence: 1, status: 'HK', previousStatus: 'TK', ...JFK_FLL });
    expect(result.segments[1]).toEqual({ id: '9', sequence: 2, status: 'HK', previousStatus: 'TK' });
    expect(statuses(fake.airSegments('AAAAAA'))).toEqual(['8:HK', '9:HK']);
    expect(commands(fake)).toEqual(['getReservation', 'updateReservation']);
  });

  it('registra el localizador y el receivedFrom de cada escritura', async () => {
    const { fake } = await confirm({ reservationUpdate: { reservations: [pnr()] } }, { receivedFrom: 'BX3 A&B' });
    expect(fake.calls.filter((call) => call.command !== 'open' && call.command !== 'close')).toEqual([
      { command: 'getReservation', locator: 'AAAAAA' },
      { command: 'updateReservation', locator: 'AAAAAA', receivedFrom: 'BX3 A&B' },
    ]);
  });

  it('TK con UN y HX: confirma el TK y deja los demás; changed solo trae el TK', async () => {
    const { fake, result } = await confirm(
      { reservationUpdate: { reservations: [pnr([segment('8', 'TK'), segment('9', 'UN'), segment('10', 'HX'), segment('11', 'HK')])] } },
      { expectedSegmentIds: ['8'] },
    );
    expect(result.changed).toEqual(['8']);
    expect(statuses(result.segments)).toEqual(['8:HK', '9:UN', '10:HX', '11:HK']);
    expect(statuses(fake.airSegments('AAAAAA'))).toEqual(['8:HK', '9:UN', '10:HX', '11:HK']);
  });

  it('NOT_APPLIED: Success, pero el fake no cambió nada', async () => {
    const { fake, result } = await confirm({ reservationUpdate: { reservations: [pnr()], outcomes: ['notApplied'] } });
    expect(result.status).toBe('confirmed');
    expect(result.changed).toEqual([]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'NOT_APPLIED', segmentIds: ['8', '9'] })]);
    expect(statuses(fake.airSegments('AAAAAA'))).toEqual(['8:TK', '9:TK']);
  });

  it('noop: sin ningún TK no manda Update ni consume un desenlace forzado', async () => {
    const options: QueueFakeOptions = { reservationUpdate: { reservations: [pnr([segment('8', 'HK'), segment('9', 'UN')])], outcomes: [{ error: { code: '700432' } }] } };
    const { fake, result } = await confirm(options, { expectedSegmentIds: ['1'] });
    expect(result).toMatchObject({ status: 'noop', changed: [] });
    expect(commands(fake)).toEqual(['getReservation']);
  });

  it('expectedSegmentIds se compara como conjunto: orden y repetidos no importan', async () => {
    const { result } = await confirm({ reservationUpdate: { reservations: [pnr()] } }, { expectedSegmentIds: ['9', '8', '9'] });
    expect(result.status).toBe('confirmed');
  });

  it('desenlaces en orden: la segunda escritura consume el segundo', async () => {
    const options: QueueFakeOptions = {
      reservationUpdate: { reservations: [pnr([segment('8', 'TK')]), { locator: 'AAAAAB', segments: [segment('3', 'TK')] }], outcomes: ['applied', { error: { code: '700411' } }] },
    };
    const { fake, legacy } = client(options);
    const session = await legacy.openSession();
    await session.reservation.confirmAirSegments({ ...REQUEST, expectedSegmentIds: ['8'] });
    const error = await rejection(session.reservation.confirmAirSegments({ locator: 'AAAAAB', receivedFrom: 'X', expectedSegmentIds: ['3'] }));
    await session.close();
    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code: '700411' });
    expect(statuses(fake.airSegments('AAAAAB'))).toEqual(['3:TK']);
  });
});

describe('fake: reservation.confirmAirSegments, no escribe', () => {
  it('SEGMENTS_CHANGED: los TK del PNR no son los esperados; no manda Update', async () => {
    const { fake, legacy } = client({ reservationUpdate: { reservations: [pnr([segment('8', 'TK'), segment('9', 'TK'), segment('10', 'TK')])] } });
    const session = await legacy.openSession();
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));
    await session.close();
    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toMatchObject({ reason: 'SEGMENTS_CHANGED', expectedSegments: ['8', '9'], actualSegments: ['8', '9', '10'] });
    expect(commands(fake)).toEqual(['getReservation']);
    expect(statuses(fake.airSegments('AAAAAA'))).toEqual(['8:TK', '9:TK', '10:TK']);
  });

  it('PNR no sembrado: SABRE_ERROR 700226 en la lectura, sin Update ni IgnoreTransaction', async () => {
    const { fake, legacy } = client({});
    const session = await legacy.openSession();
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));
    await session.close();
    expect(error).toMatchObject({ name: 'SabreReservationUpdateError', reason: 'SABRE_ERROR', code: '700226', severity: 'MODERATE' });
    expect(commands(fake)).toEqual(['getReservation']);
  });

  it.each([
    ['700432', 'Reservation Orchestration Error'],
    ['700411', 'The PNR in the AAA has been modified'],
    ['700408', 'No PNR in AAA'],
    ['500810', 'PLEASE IGNORE OR COMMIT'],
  ])('error de negocio forzado %s: IgnoreTransaction y SABRE_ERROR con el texto de la fuente, sin escribir', async (code, text) => {
    const { fake, legacy } = client({ reservationUpdate: { reservations: [pnr()], outcomes: [{ error: { code } }] } });
    const session = await legacy.openSession();
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));
    await session.close();
    expect(error).toBeInstanceOf(SabreReservationUpdateError);
    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code });
    expect((error as Error).message).toContain(text);
    expect(commands(fake)).toEqual(['getReservation', 'updateReservation', 'ignoreTransaction']);
    expect(statuses(fake.airSegments('AAAAAA'))).toEqual(['8:TK', '9:TK']);
  });

  it('un error forzado con texto y severidad propios', async () => {
    const { legacy } = client({ reservationUpdate: { reservations: [pnr()], outcomes: [{ error: { code: '123', message: 'OTRO', severity: 'CRITICAL' } }] } });
    const session = await legacy.openSession();
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));
    await session.close();
    expect(error).toMatchObject({ code: '123', severity: 'CRITICAL', message: 'updateReservation: 123 OTRO' });
  });
});

describe('fake: reservation.confirmAirSegments, inciertos', () => {
  const REASONS: [QueueFakeReservationUpdateUncertainReason, boolean][] = [
    ['TRANSPORT', false],
    ['GATEWAY_5XX', false],
    ['UNPARSEABLE', false],
    ['ABORTED', false],
    ['END_TRANSACTION_PROBLEM', true],
    ['PREVIOUS_ENTRY_ACTIVE', false],
  ];

  it.each(REASONS)('%s: SabreUncertainOutcomeError con esa reason; por defecto applied es %s', async (reason, appliedByDefault) => {
    const { fake, legacy } = client({ reservationUpdate: { reservations: [pnr()], outcomes: [{ uncertain: reason }] } });
    const session = await legacy.openSession();
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));
    await session.close();
    expect(error).toBeInstanceOf(SabreUncertainOutcomeError);
    expect(error).toMatchObject({ reason, confirmationId: 'AAAAAA', operation: 'reservation.confirmAirSegments' });
    // Un incierto nunca manda IgnoreTransaction.
    expect(commands(fake)).toEqual(['getReservation', 'updateReservation']);
    expect(statuses(fake.airSegments('AAAAAA'))).toEqual(appliedByDefault ? ['8:HK', '9:HK'] : ['8:TK', '9:TK']);
  });

  it.each(REASONS)('%s: applied se puede forzar al contrario del default', async (reason, appliedByDefault) => {
    const { fake, legacy } = client({ reservationUpdate: { reservations: [pnr()], outcomes: [{ uncertain: reason, applied: !appliedByDefault }] } });
    const session = await legacy.openSession();
    expect(await rejection(session.reservation.confirmAirSegments(REQUEST))).toMatchObject({ reason });
    await session.close();
    expect(statuses(fake.airSegments('AAAAAA'))).toEqual(appliedByDefault ? ['8:TK', '9:TK'] : ['8:HK', '9:HK']);
  });

  it('ABORTED forzado lanza AbortError aunque la llamada no traiga signal, y el SDK lo da como ABORTED', async () => {
    const { legacy } = client({ reservationUpdate: { reservations: [pnr()], outcomes: [{ uncertain: 'ABORTED' }] } });
    const session = await legacy.openSession();
    const error = await rejection(session.reservation.confirmAirSegments(REQUEST));
    await session.close();
    expect(error).toMatchObject({ reason: 'ABORTED' });
    expect((error as Error).cause).toMatchObject({ name: 'AbortError' });
  });

  it('incierto que sí se guardó → se cierra la sesión → el reintento en otra da noop', async () => {
    const { fake, legacy } = client({ reservationUpdate: { reservations: [pnr()], outcomes: [{ uncertain: 'TRANSPORT', applied: true }] } });
    const first = await legacy.openSession();
    const error = await rejection(first.reservation.confirmAirSegments(REQUEST));
    await first.close();
    expect(error).toMatchObject({ name: 'SabreUncertainOutcomeError', reason: 'TRANSPORT' });

    const second = await legacy.openSession();
    const retried = await second.reservation.confirmAirSegments(REQUEST);
    await second.close();
    expect(retried).toMatchObject({ status: 'noop', changed: [] });
    expect(statuses(retried.segments)).toEqual(['8:HK', '9:HK']);
    expect(commands(fake)).toEqual(['getReservation', 'updateReservation', 'getReservation']);
  });

  it('incierto que no se guardó → el reintento en otra sesión confirma', async () => {
    const { fake, legacy } = client({ reservationUpdate: { reservations: [pnr()], outcomes: [{ uncertain: 'GATEWAY_5XX' }] } });
    const first = await legacy.openSession();
    await rejection(first.reservation.confirmAirSegments(REQUEST));
    await first.close();
    const second = await legacy.openSession();
    const retried = await second.reservation.confirmAirSegments(REQUEST);
    await second.close();
    expect(retried).toMatchObject({ status: 'confirmed', changed: ['8', '9'] });
    expect(statuses(fake.airSegments('AAAAAA'))).toEqual(['8:HK', '9:HK']);
  });
});

/** Como el ejemplo de Delete: el UN viejo (8), el TK nuevo (10) y un HK (9). */
const scheduleChange = (old = 'UN') => ({ locator: 'AAAAAA', segments: [segment('8', old), segment('10', 'TK'), segment('9', 'HK')] });
const REMOVE: RemoveAirSegmentsRequest = { locator: 'AAAAAA', receivedFrom: 'SCHEDULE CHANGE', segmentIds: ['8'] };
const ids = (segments: readonly { id: string; sequence?: number; status: string }[] | undefined) => segments?.map((item) => `${item.id}/${item.sequence}:${item.status}`);

async function remove(options: QueueFakeOptions, request: Partial<RemoveAirSegmentsRequest> = {}) {
  const { fake, legacy } = client(options);
  const session = await legacy.openSession();
  try {
    return { fake, result: await session.reservation.removeAirSegments({ ...REMOVE, ...request }) };
  } finally {
    await session.close();
  }
}

async function removeRejection(options: QueueFakeOptions, request: Partial<RemoveAirSegmentsRequest> = {}) {
  const { fake, legacy } = client(options);
  const session = await legacy.openSession();
  const error = await rejection(session.reservation.removeAirSegments({ ...REMOVE, ...request }));
  await session.close();
  return { fake, error };
}

describe('fake: reservation.removeAirSegments, resultado', () => {
  it.each(['UN', 'HX'])('baja de un %s: sale del PNR y los demás se renumeran', async (old) => {
    const { fake, result } = await remove({ reservationUpdate: { reservations: [scheduleChange(old)] } });
    expect(result).toMatchObject({ status: 'removed', changed: ['8'], warnings: [] });
    expect(ids(result.segments)).toEqual(['10/1:TK', '9/2:HK']);
    expect(ids(fake.airSegments('AAAAAA'))).toEqual(['10/1:TK', '9/2:HK']);
    expect(fake.calls.filter((call) => call.command === 'updateReservation')).toEqual([{ command: 'updateReservation', locator: 'AAAAAA', receivedFrom: 'SCHEDULE CHANGE' }]);
  });

  it('baja de un UN y un HX juntos, en una sola escritura', async () => {
    const options = { reservationUpdate: { reservations: [{ locator: 'AAAAAA', segments: [segment('8', 'UN'), segment('10', 'HX'), segment('12', 'TK'), segment('9', 'HK')] }] } };
    const { fake, result } = await remove(options, { segmentIds: ['10', '8'] });
    expect(result.changed).toEqual(['8', '10']);
    expect(ids(fake.airSegments('AAAAAA'))).toEqual(['12/1:TK', '9/2:HK']);
    expect(commands(fake)).toEqual(['getReservation', 'updateReservation']);
  });

  it('allowedStatuses ampliado: borra un HK si se incluye', async () => {
    const { fake } = await remove({ reservationUpdate: { reservations: [scheduleChange()] } }, { segmentIds: ['9'], allowedStatuses: ['UN', 'HX', 'HK'] });
    expect(ids(fake.airSegments('AAAAAA'))).toEqual(['8/1:UN', '10/2:TK']);
  });

  it('NOT_APPLIED: Success, pero el segmento sigue en el PNR', async () => {
    const { fake, result } = await remove({ reservationUpdate: { reservations: [scheduleChange()], outcomes: ['notApplied'] } });
    expect(result.changed).toEqual([]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'NOT_APPLIED', segmentIds: ['8'] })]);
    expect(ids(fake.airSegments('AAAAAA'))).toEqual(['8/1:UN', '10/2:TK', '9/3:HK']);
  });
});

describe('fake: reservation.removeAirSegments, no escribe', () => {
  it('SEGMENT_NOT_FOUND: no manda Update, no borra los demás ni consume un desenlace', async () => {
    const { fake, error } = await removeRejection({ reservationUpdate: { reservations: [scheduleChange()], outcomes: [{ uncertain: 'TRANSPORT' }] } }, { segmentIds: ['8', '99'] });
    expect(error).toMatchObject({ name: 'SabreReservationUpdateError', reason: 'SEGMENT_NOT_FOUND', actualSegments: ['99'] });
    expect(commands(fake)).toEqual(['getReservation']);
    expect(ids(fake.airSegments('AAAAAA'))).toEqual(['8/1:UN', '10/2:TK', '9/3:HK']);
  });

  it.each([
    ['un HK con el default', ['9'], undefined, ['9']],
    ['un TK con el default', ['10'], undefined, ['10']],
    ['un UN fuera de allowedStatuses', ['8'], ['HX'], ['8']],
  ])('SEGMENT_STATUS_NOT_ALLOWED: %s, sin mandar Update', async (_label, segmentIds, allowedStatuses, blocked) => {
    const { fake, error } = await removeRejection(
      { reservationUpdate: { reservations: [scheduleChange()] } },
      { segmentIds, ...(allowedStatuses === undefined ? {} : { allowedStatuses }) },
    );
    expect(error).toMatchObject({ reason: 'SEGMENT_STATUS_NOT_ALLOWED', actualSegments: blocked });
    expect(commands(fake)).toEqual(['getReservation']);
  });

  it('error de negocio forzado: IgnoreTransaction y SABRE_ERROR, sin borrar', async () => {
    const { fake, error } = await removeRejection({ reservationUpdate: { reservations: [scheduleChange()], outcomes: [{ error: { code: '700432' } }] } });
    expect(error).toMatchObject({ reason: 'SABRE_ERROR', code: '700432' });
    expect((error as Error).message).toContain('UNABLE TO CANCEL - AIRLINE DENIES CANCELLATION');
    expect(commands(fake)).toEqual(['getReservation', 'updateReservation', 'ignoreTransaction']);
    expect(ids(fake.airSegments('AAAAAA'))).toEqual(['8/1:UN', '10/2:TK', '9/3:HK']);
  });
});

describe('fake: reservation.removeAirSegments, inciertos', () => {
  it.each(['TRANSPORT', 'GATEWAY_5XX', 'UNPARSEABLE', 'ABORTED', 'END_TRANSACTION_PROBLEM', 'PREVIOUS_ENTRY_ACTIVE'] as const)(
    '%s: SabreUncertainOutcomeError con la operación de la baja',
    async (reason) => {
      const { error } = await removeRejection({ reservationUpdate: { reservations: [scheduleChange()], outcomes: [{ uncertain: reason }] } });
      expect(error).toBeInstanceOf(SabreUncertainOutcomeError);
      expect(error).toMatchObject({ reason, operation: 'reservation.removeAirSegments', confirmationId: 'AAAAAA' });
    },
  );

  it('incierto que sí se guardó → el reintento en otra sesión da SEGMENT_NOT_FOUND, y el PNR ya no tiene el segmento', async () => {
    const { fake, legacy } = client({ reservationUpdate: { reservations: [scheduleChange()], outcomes: [{ uncertain: 'GATEWAY_5XX', applied: true }] } });
    const first = await legacy.openSession();
    expect(await rejection(first.reservation.removeAirSegments(REMOVE))).toMatchObject({ reason: 'GATEWAY_5XX' });
    await first.close();
    const second = await legacy.openSession();
    expect(await rejection(second.reservation.removeAirSegments(REMOVE))).toMatchObject({ reason: 'SEGMENT_NOT_FOUND' });
    await second.close();
    expect(ids(fake.airSegments('AAAAAA'))).toEqual(['10/1:TK', '9/2:HK']);
  });
});

describe('fake: confirmar y después borrar, como un cambio de horario completo', () => {
  it('confirmAirSegments y removeAirSegments en la misma sesión', async () => {
    const { fake, legacy } = client({ reservationUpdate: { reservations: [scheduleChange()] } });
    const session = await legacy.openSession();
    await session.reservation.confirmAirSegments({ ...REQUEST, expectedSegmentIds: ['10'] });
    await session.reservation.removeAirSegments(REMOVE);
    await session.close();
    expect(ids(fake.airSegments('AAAAAA'))).toEqual(['10/1:HK', '9/2:HK']);
    expect(commands(fake)).toEqual(['getReservation', 'updateReservation', 'getReservation', 'updateReservation']);
  });
});

describe('fake: reservation.confirmAirSegments, siembra', () => {
  it.each([
    [{ reservations: [{ locator: 'abc', segments: [] }] }, /locator/],
    [{ reservations: [{ locator: 'AAAAAA', segments: [segment('1', 'TK'), segment('1', 'HK')] }] }, /repetido/],
    [{ reservations: [{ locator: 'AAAAAA', segments: [segment('1', 'tk')] }] }, /status/],
    [{ reservations: [{ locator: 'AAAAAA', segments: [segment('1', 'TK', { sequence: 0 })] }] }, /sequence/],
    [{ reservations: [pnr(), pnr()] }, /dos veces/],
    [{ reservations: [{ locator: 'AAAAAA', segments: [segment('1', 'TK', { productId: '' })] }] }, /productId/],
    [{ reservations: [{ locator: 'AAAAAA', segments: [segment('1', 'TK', { productId: '2' }), segment('2', 'HK')] }] }, /productId '2' está repetido/],
    [{ outcomes: [{ uncertain: 'NOT_COMMITTED' }] }, /uncertain/],
    [{ outcomes: [{ error: {} }] }, /code/],
    [{ outcomes: ['otro'] }, /applied/],
  ])('una siembra inválida lanza TypeError al crear el fake (%#)', (reservationUpdate, message) => {
    expect(() => createQueueFake({ reservationUpdate: reservationUpdate as NonNullable<QueueFakeOptions['reservationUpdate']> })).toThrow(message);
  });

  it('productId: por defecto igual al id; uno distinto o null se conserva en airSegments', () => {
    const fake = createQueueFake({
      reservationUpdate: { reservations: [{ locator: 'AAAAAA', segments: [segment('8', 'UN'), segment('10', 'TK', { productId: '18' }), segment('9', 'HK', { productId: null })] }] },
    });
    expect(fake.airSegments('AAAAAA')?.map((item) => item.productId)).toEqual([undefined, '18', null]);
  });

  it('airSegments de un PNR no sembrado es undefined', () => {
    expect(createQueueFake({}).airSegments('AAAAAA')).toBeUndefined();
  });
});
