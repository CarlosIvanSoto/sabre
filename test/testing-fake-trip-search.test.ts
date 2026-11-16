// El fake de sabre-client/testing con reservation.searchByUpdateDate (#251, ADR-033).
import { describe, expect, it } from 'vitest';
import { SabreError, SabreLegacy, SabreTripSearchError, type SearchByUpdateDateRequest, type TripSearchErrorReason } from '../src/index.js';
import { createQueueFake, type QueueFakeOptions } from '../src/testing/index.js';
import { rejection } from './soap-helpers.js';

const NOW = new Date('2026-11-16T20:30:00Z'); // 14:30 en México

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

async function search(options: QueueFakeOptions, request: Partial<SearchByUpdateDateRequest> = {}) {
  const { fake, legacy } = client(options);
  const session = await legacy.openSession();
  try {
    return { fake, result: await session.reservation.searchByUpdateDate({ ...WINDOW, ...request }) };
  } finally {
    await session.close();
  }
}

/** La última hora antes de NOW, en P8X1 y con la zona de México. */
const WINDOW: SearchByUpdateDateRequest = { pcc: 'P8X1', from: '2026-11-16T19:30:00Z', to: '2026-11-16T20:30:00Z', timeZone: 'America/Mexico_City' };

const MEXICO = 'America/Mexico_City';
const seeded: QueueFakeOptions = {
  tripSearchTimeZone: MEXICO,
  tripSearch: {
    reservations: [
      { locator: 'AAAAAA', createdBy: 'P8X1', updatedAt: '2026-11-16T20:10:00Z' },
      // Creado por otro PCC y emitido por P8X1: solo con anyBranch.
      { locator: 'AAAAAB', createdBy: 'OTRO', visibleTo: ['P8X1'], updatedAt: ['2026-11-15T18:00:00Z', new Date('2026-11-16T19:51:00Z')] },
      // Fuera de la ventana.
      { locator: 'AAAAAC', createdBy: 'P8X1', updatedAt: '2026-11-16T18:00:00Z' },
      // De otro PCC que P8X1 no ve.
      { locator: 'AAAAAD', createdBy: 'OTRO', updatedAt: '2026-11-16T20:00:00Z' },
      // Ya depurado.
      { locator: 'AAAAAE', createdBy: 'P8X1', updatedAt: '2026-11-16T20:05:00Z', pastDate: true },
    ],
  },
};
const locators = (result: { reservations: { locator: string }[] }) => result.reservations.map((reservation) => reservation.locator);

describe('fake: reservation.searchByUpdateDate', () => {
  it('con anyBranch (default) trae los del PCC y los que puede ver, en la ventana', async () => {
    const { fake, result } = await search(seeded);
    expect(locators(result)).toEqual(['AAAAAA', 'AAAAAB']);
    expect(result.status).toBe('complete');
    expect(result.numberResults).toBe(2);
    expect(result.totalResults).toBe(2);
    expect(result.respondedAt).toBe('2026-11-16T20:30:00Z');
    expect(result.sabreLocalOffsetMinutes).toBe(-360);
    expect(result.warnings).toEqual([]);
    expect(fake.calls.filter((call) => call.command === 'tripSearch')).toEqual([{ command: 'tripSearch', pcc: 'P8X1' }]);
  });

  it('con anyBranch: false, solo los que creó el PCC', async () => {
    const { result } = await search(seeded, { anyBranch: false });
    expect(locators(result)).toEqual(['AAAAAA']);
  });

  it('searchType INACTIVE y BOTH traen los depurados, con pastDate', async () => {
    expect((await search(seeded, { searchType: 'INACTIVE' })).result.reservations).toEqual([{ locator: 'AAAAAE', pastDate: true }]);
    expect(locators((await search(seeded, { searchType: 'BOTH' })).result)).toEqual(['AAAAAA', 'AAAAAB', 'AAAAAE']);
  });

  it('con otra zona en el request, la ventana se corre y llega TIMEZONE_MISMATCH, como con Sabre', async () => {
    // UTC: After/Before salen 6 h adelante de lo que Sabre lee en México.
    const { result } = await search(seeded, { timeZone: 'UTC' });
    expect(locators(result)).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(['TIMEZONE_MISMATCH']);
  });

  it('un PCC en America/Chicago con el horario de verano: la ventana local convierte bien', async () => {
    const { result } = await search(
      {
        now: () => new Date('2026-07-01T18:00:00Z'),
        tripSearchTimeZone: 'America/Chicago',
        tripSearch: { reservations: [{ locator: 'AAAAAA', createdBy: 'P8X1', updatedAt: '2026-07-01T17:30:00Z' }] },
      },
      { from: '2026-07-01T17:00:00Z', to: '2026-07-01T18:00:00Z', timeZone: 'America/Chicago' },
    );
    expect(locators(result)).toEqual(['AAAAAA']);
    expect(result.sabreLocalOffsetMinutes).toBe(-300);
    expect(result.warnings).toEqual([]);
  });

  it('con maxItems por encima del tope de la vista (no visto en Sabre): los primeros, TotalResults con el total y truncated', async () => {
    const { result } = await search({ ...seeded, tripSearch: { ...seeded.tripSearch, limit: 1 } });
    expect(result.status).toBe('truncated');
    expect(locators(result)).toEqual(['AAAAAA']);
    expect(result.numberResults).toBe(1);
    expect(result.totalResults).toBe(2);
    expect(result.warnings).toEqual([{ code: '200006', message: 'Number of results exceeded view limit or requested PNRs limit' }]);
  });

  it('más resultados que maxItems: 200206 sin lista y TOO_MANY_RESULTS, como Sabre en CERT', async () => {
    const { legacy } = client(seeded);
    const session = await legacy.openSession();
    const error = (await rejection(session.reservation.searchByUpdateDate({ ...WINDOW, maxItems: 1 }))) as SabreTripSearchError;
    expect(error).toBeInstanceOf(SabreTripSearchError);
    expect(error.reason).toBe('TOO_MANY_RESULTS');
    expect(error.code).toBe('200206');
    expect(error.severity).toBe('WARNING');
    expect(error.message).toBe('tripSearch: 200206 Too many results - specify more data; wanted: 1 , found: 2');
    expect((await session.reservation.searchByUpdateDate({ ...WINDOW, maxItems: 2 })).status).toBe('complete');
    await session.close();
  });

  it('pedir más que el tope da 200005 sin truncar', async () => {
    const { result } = await search({ ...seeded, tripSearch: { ...seeded.tripSearch, limit: 500 } });
    expect(result.status).toBe('complete');
    expect(result.warnings).toEqual([{ code: '200005', message: 'Max number of requested PNRs exceeded view limit [500]' }]);
  });

  it.each<[TripSearchErrorReason, string]>([
    ['NO_PRIMARY_CRITERIA', '200204'],
    ['CRITERIA_TOO_WEAK', '200207'],
    ['TOO_MANY_RESULTS', '200206'],
    ['SEARCH_TIMEOUT', '200203'],
    ['PCC_NOT_ACCESSIBLE', '200208'],
    ['UNKNOWN', '200202'],
  ])('error forzado %s: SabreTripSearchError, y la búsqueda siguiente responde', async (reason, code) => {
    const { legacy } = client({ ...seeded, tripSearch: { ...seeded.tripSearch, errors: [reason] } });
    const session = await legacy.openSession();
    const error = await rejection(session.reservation.searchByUpdateDate(WINDOW));
    expect(error).toBeInstanceOf(SabreTripSearchError);
    expect((error as SabreTripSearchError).reason).toBe(reason);
    expect((error as SabreTripSearchError).code).toBe(code);
    expect(locators(await session.reservation.searchByUpdateDate(WINDOW))).toEqual(['AAAAAA', 'AAAAAB']);
    await session.close();
  });

  it('sin PNR sembrados, una ventana vacía', async () => {
    const { result } = await search({ tripSearchTimeZone: MEXICO });
    expect(result).toMatchObject({ status: 'complete', reservations: [], numberResults: 0, totalResults: 0 });
  });

  it('sin tripSearchTimeZone no simula la búsqueda', async () => {
    const { legacy } = client({});
    const session = await legacy.openSession();
    const error = await rejection(session.reservation.searchByUpdateDate(WINDOW));
    expect(error).toBeInstanceOf(SabreError);
    expect((error as Error).message).toContain('tripSearchTimeZone');
    await session.close();
  });

  it('valida el request igual que el método real: TypeError sin llegar al fake', async () => {
    const { fake, legacy } = client(seeded);
    const session = await legacy.openSession();
    const error = await rejection(session.reservation.searchByUpdateDate({ ...WINDOW, from: '2026-11-16T14:00:00' }));
    expect(error).toBeInstanceOf(TypeError);
    expect(fake.calls.some((call) => call.command === 'tripSearch')).toBe(false);
    await session.close();
  });

  it.each<[QueueFakeOptions, string]>([
    [{ tripSearch: {} }, 'tripSearchTimeZone'],
    [{ tripSearchTimeZone: 'Mexico/Ciudad' }, 'tripSearchTimeZone'],
    [{ tripSearchTimeZone: MEXICO, tripSearch: { limit: 0 } }, 'limit'],
    [{ tripSearchTimeZone: MEXICO, tripSearch: { errors: ['NOPE' as TripSearchErrorReason] } }, 'errors[0]'],
    [{ tripSearchTimeZone: MEXICO, tripSearch: { reservations: [{ locator: 'abc', createdBy: 'P8X1', updatedAt: NOW }] } }, 'locator'],
    [{ tripSearchTimeZone: MEXICO, tripSearch: { reservations: [{ locator: 'AAAAAA', createdBy: 'p8', updatedAt: NOW }] } }, 'createdBy'],
    [{ tripSearchTimeZone: MEXICO, tripSearch: { reservations: [{ locator: 'AAAAAA', createdBy: 'P8X1', visibleTo: ['x'], updatedAt: NOW }] } }, 'visibleTo'],
    [{ tripSearchTimeZone: MEXICO, tripSearch: { reservations: [{ locator: 'AAAAAA', createdBy: 'P8X1', updatedAt: '2026-11-16T14:00:00' }] } }, 'updatedAt'],
    [{ tripSearchTimeZone: MEXICO, tripSearch: { reservations: [{ locator: 'AAAAAA', createdBy: 'P8X1', updatedAt: [] }] } }, 'updatedAt'],
  ])('una siembra inválida lanza TypeError al crear el fake (%#)', (options, message) => {
    expect(() => createQueueFake(options)).toThrow(TypeError);
    expect(() => createQueueFake(options)).toThrow(message);
  });
});
