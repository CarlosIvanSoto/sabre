// session.reservation.searchByUpdateDate (#250, ADR-033) contra las fixtures de #249: los sobres
// reales de CERT (cert1) y los armados desde la guía y el design.
import { describe, expect, it } from 'vitest';
import { SabreBusinessError, SabreError, SabreGatewayError, type SabreRawResponse, SabreTripSearchError, type SearchByUpdateDateRequest } from '../src/index.js';
import cert from './fixtures/trip-search.sandbox-cert1.json';
import synthetic from './fixtures/trip-search.synthetic-guide.json';
import validate from './fixtures/trip-search.sandbox-validate.json';
import { mockFetch } from './helpers.js';
import { fault, legacyClient, rejection, sentBody, sentTag, sessionOpened, soap, xml } from './soap-helpers.js';

const fromFixture = (fixture: { responses: { label: string; status: number; body: string }[] }, label: string) => {
  const response = fixture.responses.find((candidate) => candidate.label === label);
  if (response === undefined) throw new Error(`la fixture no tiene ${label}`);
  return xml(response.status, response.body);
};
const real = (label: string) => fromFixture(cert, label);
const guide = (label: string) => fromFixture(synthetic, label);

/** La ventana de la creación de cert1: 5 min antes del End Transaction hasta la llamada. */
const MEXICO: SearchByUpdateDateRequest = { pcc: 'ABCD', from: '2026-11-16T20:19:12Z', to: '2026-11-16T20:24:13Z', timeZone: 'America/Mexico_City' };

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const session = await legacyClient(fetch).client.openSession();
  return { fetch, session };
}

const payloadOf = (envelope: string) => /<Trip_SearchRQ[\s\S]*<\/Trip_SearchRQ>/.exec(envelope)?.[0];

describe('reservation.searchByUpdateDate: request', () => {
  it('manda Trip_SearchRQ con la ventana en hora local del PCC, TripSearchTN y AnyBranch="true"', async () => {
    const { fetch, session } = await openWith(real('one'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);

    const envelope = sentBody(fetch, 1);
    expect(sentTag(envelope, 'eb:Service')).toBe('Trip_SearchRQ');
    expect(sentTag(envelope, 'eb:Action')).toBe('Trip_SearchRQ');
    expect(payloadOf(envelope)).toBe(
      '<Trip_SearchRQ Version="4.5.0" xmlns="http://webservices.sabre.com/triprecord"><ReadRequests><ReservationReadRequest>' +
        '<DateCriteria><UpdateDate After="2026-11-16T14:19:12" Before="2026-11-16T14:24:13"/></DateCriteria>' +
        '<PosCriteria AnyBranch="true"><Pcc>ABCD</Pcc></PosCriteria>' +
        '<ReturnOptions ViewName="TripSearchTN" ResponseFormat="STL" SearchType="ACTIVE" MaxItemsReturned="800"/>' +
        '</ReservationReadRequest></ReadRequests></Trip_SearchRQ>',
    );
    expect(envelope).not.toMatch(/ResultAction|QueuePlace/);
    expect(result.window).toEqual({
      from: '2026-11-16T20:19:12Z',
      to: '2026-11-16T20:24:13Z',
      after: '2026-11-16T14:19:12',
      before: '2026-11-16T14:24:13',
      timeZone: 'America/Mexico_City',
    });
  });

  it('convierte con el horario de verano de la zona: America/Chicago en julio es UTC-5', async () => {
    const { fetch, session } = await openWith(real('empty'));
    const result = await session.reservation.searchByUpdateDate({
      pcc: 'ABCD',
      from: new Date('2026-07-01T17:00:00.750Z'),
      to: '2026-07-01T13:30:00-05:00',
      timeZone: 'America/Chicago',
    });
    expect(payloadOf(sentBody(fetch, 1))).toContain('<UpdateDate After="2026-07-01T12:00:00" Before="2026-07-01T13:30:00"/>');
    expect(result.window.from).toBe('2026-07-01T17:00:00Z');
    expect(result.window.to).toBe('2026-07-01T18:30:00Z');
  });

  it('respeta anyBranch, searchType y maxItems', async () => {
    const { fetch, session } = await openWith(real('empty'));
    const result = await session.reservation.searchByUpdateDate({ ...MEXICO, anyBranch: false, searchType: 'BOTH', maxItems: 50 });
    const payload = payloadOf(sentBody(fetch, 1));
    expect(payload).toContain('<PosCriteria AnyBranch="false">');
    expect(payload).toContain('SearchType="BOTH" MaxItemsReturned="50"');
    expect(result.anyBranch).toBe(false);
  });

  it.each([
    [{ ...MEXICO, timeZone: undefined }, 'timeZone es obligatoria'],
    [{ ...MEXICO, timeZone: 'Mexico/Ciudad' }, 'timeZone'],
    [{ ...MEXICO, from: '2026-11-16T14:00:00' }, 'sin zona es ambiguo'],
    [{ ...MEXICO, to: '16NOV' }, 'to'],
    [{ ...MEXICO, from: new Date('x') }, 'from'],
    [{ ...MEXICO, from: 1_700_000_000_000 }, 'from'],
    [{ ...MEXICO, from: MEXICO.to }, 'from debe ser anterior a to'],
    [{ ...MEXICO, from: '2026-11-16T21:00:00Z' }, 'from debe ser anterior a to'],
    [{ ...MEXICO, pcc: 'p8' }, 'pcc'],
    [{ ...MEXICO, pcc: undefined }, 'pcc'],
    [{ ...MEXICO, anyBranch: 'true' }, 'anyBranch'],
    [{ ...MEXICO, searchType: 'ALL' }, 'searchType'],
    [{ ...MEXICO, maxItems: 0 }, 'maxItems'],
    [{ ...MEXICO, maxItems: 801 }, 'maxItems'],
    [{ ...MEXICO, maxItems: 1.5 }, 'maxItems'],
  ])('un request inválido (%j) lanza TypeError sin red', async (request, message) => {
    const { fetch, session } = await openWith();
    const error = await rejection(session.reservation.searchByUpdateDate(request as never));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain(message);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('reservation.searchByUpdateDate: respuestas reales de CERT (cert1)', () => {
  it('la ventana de la creación: complete, con el PNR de prueba y el offset de México', async () => {
    const { session } = await openWith(real('one'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result).toEqual({
      status: 'complete',
      pcc: 'ABCD',
      anyBranch: true,
      window: expect.any(Object),
      reservations: [{ locator: 'AAAAAA' }],
      numberResults: 1,
      totalResults: 1,
      warnings: [],
      respondedAt: '2026-11-16T20:24:13Z',
      sabreLocalOffsetMinutes: -360,
    });
  });

  it('una ventana vacía: complete, sin reservas', async () => {
    const { session } = await openWith(real('empty'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.status).toBe('complete');
    expect(result.reservations).toEqual([]);
    expect(result.numberResults).toBe(0);
    expect(result.totalResults).toBe(0);
  });

  it('redondea el offset aunque los dos relojes difieran en un segundo', async () => {
    const { session } = await openWith(real('two'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.respondedAt).toBe('2026-11-16T20:24:14Z');
    expect(result.sabreLocalOffsetMinutes).toBe(-360);
    expect(result.warnings).toEqual([]);
    expect(result.reservations).toHaveLength(2);
  });

  it('30 días: 26 localizadores distintos, complete', async () => {
    const { session } = await openWith(real('wide'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.status).toBe('complete');
    expect(result.reservations).toHaveLength(26);
    expect(new Set(result.reservations.map((reservation) => reservation.locator)).size).toBe(26);
  });

  it('America/Chicago en noviembre también es UTC-6: sin TIMEZONE_MISMATCH', async () => {
    const { session } = await openWith(real('one'));
    const result = await session.reservation.searchByUpdateDate({ ...MEXICO, timeZone: 'America/Chicago' });
    expect(result.warnings).toEqual([]);
  });

  it('con timeZone UTC, la respuesta en UTC-6 da TIMEZONE_MISMATCH', async () => {
    const { session } = await openWith(real('one'));
    const result = await session.reservation.searchByUpdateDate({ ...MEXICO, timeZone: 'UTC' });
    expect(result.warnings).toEqual([{ code: 'TIMEZONE_MISMATCH', message: expect.stringContaining('UTC-06:00') }]);
    expect(result.warnings[0]?.message).toContain('360 min');
  });

  it('la respuesta cruda llega por onRawResponse', async () => {
    const { session } = await openWith(real('one'));
    const raws: SabreRawResponse[] = [];
    await session.reservation.searchByUpdateDate(MEXICO, { onRawResponse: (raw) => raws.push(raw) });
    expect(raws).toHaveLength(1);
    expect(raws[0]?.operation).toBe('reservation.searchByUpdateDate');
    expect(raws[0]?.body).toContain('Trip_SearchRS');
  });
});

describe('reservation.searchByUpdateDate: sobres armados desde la guía', () => {
  it('TotalResults > NumberResults: truncated, aunque no venga advertencia', async () => {
    const { session } = await openWith(guide('truncated-counters'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.status).toBe('truncated');
    expect(result.numberResults).toBe(3);
    expect(result.totalResults).toBe(5);
    expect(result.reservations).toHaveLength(3);
    expect(result.warnings).toEqual([]);
  });

  it.each(['truncated-warning-error-element', 'truncated-warning-warning-element'])('200006 (%s): truncated, con la advertencia en warnings', async (label) => {
    const { session } = await openWith(guide(label));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.status).toBe('truncated');
    expect(result.reservations).toHaveLength(2);
    expect(result.warnings).toEqual([{ code: '200006', message: 'Number of results exceeded view limit or requested PNRs limit' }]);
  });

  it('200005: complete, con la advertencia en warnings', async () => {
    const { session } = await openWith(guide('max-exceeded-warning'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.status).toBe('complete');
    expect(result.warnings).toEqual([{ code: '200005', message: 'Max number of requested PNRs exceeded view limit [800]' }]);
  });

  it('NumberPages > 1: truncated (no hay paginación síncrona)', async () => {
    const { session } = await openWith(guide('number-pages'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.status).toBe('truncated');
    expect(result.numberResults).toBe(result.totalResults);
  });

  it('Reservation@Error: el localizador queda y el error va a warnings', async () => {
    const { session } = await openWith(guide('reservation-error'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.status).toBe('complete');
    expect(result.reservations).toEqual([{ locator: 'AAAAAA' }, { locator: 'AAAAAB' }]);
    expect(result.warnings).toEqual([{ code: 'RESERVATION_ERROR', message: 'AAAAAB: General PNR error' }]);
  });

  it('deduplica los localizadores, en el orden de la respuesta', async () => {
    const { session } = await openWith(guide('duplicate-locator'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.reservations).toEqual([{ locator: 'AAAAAA' }, { locator: 'AAAAAB' }]);
    expect(result.numberResults).toBe(3);
  });

  it('un TimeStamp en UTC-5 con America/Mexico_City da TIMEZONE_MISMATCH', async () => {
    const { session } = await openWith(guide('timezone-mismatch'));
    const result = await session.reservation.searchByUpdateDate(MEXICO);
    expect(result.sabreLocalOffsetMinutes).toBe(-300);
    expect(result.warnings).toEqual([
      { code: 'TIMEZONE_MISMATCH', message: 'Sabre respondió en UTC-05:00 y America/Mexico_City es UTC-06:00 en ese instante: la ventana puede estar corrida 60 min' },
    ]);
    expect(result.status).toBe('complete');
  });
});

describe('reservation.searchByUpdateDate: errores', () => {
  it.each([
    ['error-no-primary-criteria', 'NO_PRIMARY_CRITERIA', '200204', 'MINOR'],
    ['error-criteria-too-weak', 'CRITERIA_TOO_WEAK', '200207', 'MODERATE'],
    ['error-too-many-results', 'TOO_MANY_RESULTS', '200206', 'MODERATE'],
    ['error-db-search-timeout', 'SEARCH_TIMEOUT', '200203', 'MODERATE'],
    ['error-empty-pcc-after-branch-access', 'PCC_NOT_ACCESSIBLE', '200208', 'MODERATE'],
    ['error-empty-pcc-list', 'PCC_NOT_ACCESSIBLE', '200102', 'MODERATE'],
    ['error-unable-to-process-db-search', 'UNKNOWN', '200202', 'MODERATE'],
  ])('%s: SabreTripSearchError con reason %s, sin reintento', async (label, reason, code, severity) => {
    const { fetch, session } = await openWith(guide(label));
    const error = await rejection(session.reservation.searchByUpdateDate(MEXICO));
    expect(error).toBeInstanceOf(SabreTripSearchError);
    expect(error).toBeInstanceOf(SabreBusinessError);
    const tripError = error as SabreTripSearchError;
    expect(tripError.service).toBe('tripSearch');
    expect(tripError.reason).toBe(reason);
    expect(tripError.code).toBe(code);
    expect(tripError.severity).toBe(severity);
    expect(tripError.message).toMatch(new RegExp(`^tripSearch: ${code} `));
    expect(tripError.retryable).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('más resultados que maxItems (sobre real de CERT): 200206 con Severity WARNING lanza TOO_MANY_RESULTS', async () => {
    const response = validate.responses.filter((candidate) => candidate.operation === 'reservation.searchByUpdateDate').find((candidate) => candidate.body.includes('200206'));
    if (response === undefined) throw new Error('la fixture no tiene el 200206');
    const { fetch, session } = await openWith(xml(response.status, response.body));
    const error = (await rejection(session.reservation.searchByUpdateDate({ ...MEXICO, maxItems: 1 }))) as SabreTripSearchError;
    expect(error).toBeInstanceOf(SabreTripSearchError);
    expect(error.reason).toBe('TOO_MANY_RESULTS');
    expect(error.code).toBe('200206');
    expect(error.severity).toBe('WARNING');
    expect(error.message).toBe('tripSearch: 200206 Too many results - specify more data; wanted: 1 , found: 2');
    expect(error.retryable).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  const errorRS = (error: string) =>
    xml(200, soap(`<Trip_SearchRS xmlns="http://webservices.sabre.com/triprecord" TimeStamp="2026-10-31T06:00:00" Version="4.5.0"><Errors>${error}</Errors></Trip_SearchRS>`));

  it('sin código, clasifica por el texto', async () => {
    const { session } = await openWith(errorRS('<Error Severity="MODERATE" ErrorMessage="Primary criteria too weak – add more specific primary criterion"/>'));
    const error = (await rejection(session.reservation.searchByUpdateDate(MEXICO))) as SabreTripSearchError;
    expect(error.reason).toBe('CRITERIA_TOO_WEAK');
    expect(error.code).toBe('UNKNOWN');
  });

  it('200205 (sin POS) también es NO_PRIMARY_CRITERIA, y los demás errores van en errors', async () => {
    const { session } = await openWith(
      errorRS('<Error ErrorCode="200205" Severity="MINOR" ErrorMessage="There is no POS criteria specified"/><Error ErrorCode="200204" Severity="MINOR" ErrorMessage="There is no primary criteria specified"/>'),
    );
    const error = (await rejection(session.reservation.searchByUpdateDate(MEXICO))) as SabreTripSearchError;
    expect(error.reason).toBe('NO_PRIMARY_CRITERIA');
    expect(error.code).toBe('200205');
    expect(error.errors).toHaveLength(1);
    expect((error.errors[0] as SabreTripSearchError).reason).toBe('NO_PRIMARY_CRITERIA');
  });

  it('un error junto a una advertencia de tope lanza igual', async () => {
    const { session } = await openWith(
      errorRS('<Error ErrorCode="200006" Severity="MINOR" ErrorMessage="Number of results exceeded view limit or requested PNRs limit"/><Error ErrorCode="200203" Severity="MODERATE" ErrorMessage="DB search timeout"/>'),
    );
    const error = (await rejection(session.reservation.searchByUpdateDate(MEXICO))) as SabreTripSearchError;
    expect(error.reason).toBe('SEARCH_TIMEOUT');
  });

  it('sin ReservationsList ni Errors: SabreGatewayError', async () => {
    const { session } = await openWith(xml(200, soap('<Trip_SearchRS xmlns="http://webservices.sabre.com/triprecord" Version="4.5.0"><Success>Success</Success></Trip_SearchRS>')));
    const error = await rejection(session.reservation.searchByUpdateDate(MEXICO));
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as Error).message).toContain('sin ReservationsList');
  });

  it('un fallo de autorización del gateway sale como los demás de la sesión, no como SabreTripSearchError', async () => {
    const { session } = await openWith(
      xml(500, soap(fault('soap-env:Client.AuthorizationFailed', 'Authorization failed', '<StackTrace>com.sabre.universalservices.base.exception.AuthorizationException: errors.authorization.USG_AUTHORIZATION_FAILED</StackTrace>'))),
    );
    const error = await rejection(session.reservation.searchByUpdateDate(MEXICO));
    expect(error).toBeInstanceOf(SabreError);
    expect(error).not.toBeInstanceOf(SabreTripSearchError);
  });
});
