// El fake de sabre-client/testing con las escrituras de ADR-034 (#270): los mismos casos que
// reservation-confirm-air-segments.test.ts (U.2), contra el estado del fake.
import { describe, expect, it } from 'vitest';
import { type ConfirmAirSegmentsRequest, SabreLegacy, SabreReservationUpdateError, SabreUncertainOutcomeError } from '../src/index.js';
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

describe('fake: reservation.confirmAirSegments, siembra', () => {
  it.each([
    [{ reservations: [{ locator: 'abc', segments: [] }] }, /locator/],
    [{ reservations: [{ locator: 'AAAAAA', segments: [segment('1', 'TK'), segment('1', 'HK')] }] }, /repetido/],
    [{ reservations: [{ locator: 'AAAAAA', segments: [segment('1', 'tk')] }] }, /status/],
    [{ reservations: [{ locator: 'AAAAAA', segments: [segment('1', 'TK', { sequence: 0 })] }] }, /sequence/],
    [{ reservations: [pnr(), pnr()] }, /dos veces/],
    [{ outcomes: [{ uncertain: 'NOT_COMMITTED' }] }, /uncertain/],
    [{ outcomes: [{ error: {} }] }, /code/],
    [{ outcomes: ['otro'] }, /applied/],
  ])('una siembra inválida lanza TypeError al crear el fake (%#)', (reservationUpdate, message) => {
    expect(() => createQueueFake({ reservationUpdate: reservationUpdate as NonNullable<QueueFakeOptions['reservationUpdate']> })).toThrow(message);
  });

  it('airSegments de un PNR no sembrado es undefined', () => {
    expect(createQueueFake({}).airSegments('AAAAAA')).toBeUndefined();
  });
});
