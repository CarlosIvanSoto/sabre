import { describe, expect, it, vi } from 'vitest';
import { classifyGetBooking, getBooking } from '../src/booking/get-booking.js';
import { resolveConfig } from '../src/config.js';
import { RestTransport } from '../src/http/rest-transport.js';
import {
  type GetBookingRequest,
  Sabre,
  SabreBusinessError,
  SabreError,
  SabreGatewayError,
  SabreWarning,
} from '../src/index.js';
import ndcExample from './fixtures/get-booking.wiki-example.json';
import { config, json } from './helpers.js';

const request: GetBookingRequest = { confirmationId: 'GLEBNY', returnOnly: ['FLIGHTS', 'TRAVELERS', 'ALL_SEGMENTS'] };

const token = () => json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });

function router(service: Array<Response | Error>) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input).includes('/auth/token')) return token();
    const next = service.shift();
    if (next === undefined) throw new Error(`sin respuesta para ${String(input)}`);
    if (next instanceof Error) throw next;
    return next;
  });
}

function serviceCalls(fetch: ReturnType<typeof router>) {
  return fetch.mock.calls.filter(([url]) => !String(url).includes('/auth/token'));
}

/** Sin espera real entre reintentos. */
function transport(fetch: typeof globalThis.fetch) {
  return new RestTransport(resolveConfig(config({ fetch })), { random: () => 1, sleep: async () => {} });
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

const issue = (category: string, type: string, description = 'detalle') => ({ category, type, description });
const notFound = { errors: [issue('RESOURCE_NOT_FOUND', 'BOOKING_NOT_FOUND', 'Booking cannot be found')] };
const fareRulesWarning = issue(
  'WARNING',
  'RESOURCE_UNAVAILABLE',
  'FareRules cannot be populated because no Price Quote or Ticket is present in the booking',
);

describe('sabre.booking.get', () => {
  it('hace POST /v1/trip/orders/getBooking con el body tal cual y Bearer', async () => {
    const fetch = router([json(200, ndcExample)]);
    await new Sabre(config({ fetch })).booking.get(request);

    const [[url, init]] = serviceCalls(fetch) as [[string, RequestInit]];
    expect(url).toBe('https://api.cert.platform.sabre.com/v1/trip/orders/getBooking');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(request);
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer T1');
  });

  it('devuelve el Booking en el primer nivel, tal cual, con listas vacías (ejemplo oficial NDC)', async () => {
    const result = await new Sabre(config({ fetch: router([json(200, ndcExample)]) })).booking.get({
      confirmationId: '1SXXXCROMS3E3',
    });

    expect(result).toEqual({ ...ndcExample, warnings: [], errors: [] });
    expect(result.bookingId).toBe('1SXXXCROMS3E3');
    expect(result).not.toHaveProperty('booking');
    expect(result.flights).toEqual(ndcExample.flights);
  });

  it('con reserva, RESOURCE_UNAVAILABLE (WARNING) va en warnings y no se lanza', async () => {
    const body = { bookingId: 'GLEBNY', isTicketed: false, errors: [fareRulesWarning] };
    const result = await new Sabre(config({ fetch: router([json(200, body)]) })).booking.get(request);

    expect(result.bookingId).toBe('GLEBNY');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toBeInstanceOf(SabreWarning);
    expect(result.warnings[0]).toMatchObject({ service: 'getBooking', code: 'RESOURCE_UNAVAILABLE', retryable: false });
    expect(result.warnings[0]!.raw).toEqual(fareRulesWarning);
  });

  it('con reserva, un error downline (UNAUTHORIZED_ACCESS de fare rules) va en errors y no se lanza', async () => {
    const downline = issue(
      'UNAUTHORIZED',
      'UNAUTHORIZED_ACCESS',
      'The fareRules could not be retrieved. The service StructureFareRulesRQ returned an authorization failure.',
    );
    const body = { bookingId: 'GLEBNY', errors: [downline, fareRulesWarning] };
    const result = await new Sabre(config({ fetch: router([json(200, body)]) })).booking.get(request);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(SabreBusinessError);
    expect(result.errors[0]).toMatchObject({ service: 'getBooking', code: 'UNAUTHORIZED_ACCESS', retryable: false });
    expect(result.warnings.map((w) => w.code)).toEqual(['RESOURCE_UNAVAILABLE']);
  });

  it('BOOKING_NOT_FOUND lanza SabreBusinessError no reintentable, tras una sola llamada', async () => {
    const fetch = router([json(200, notFound)]);
    const error = await catchError(new Sabre(config({ fetch })).booking.get(request));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'getBooking', code: 'BOOKING_NOT_FOUND', retryable: false });
    expect((error as Error).message).toBe('getBooking: RESOURCE_NOT_FOUND BOOKING_NOT_FOUND: Booking cannot be found');
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('UNAUTHORIZED en un 200 lanza sin refresco reactivo ni reintento', async () => {
    const body = { errors: [issue('UNAUTHORIZED', 'UNAUTHORIZED_ACCESS', 'Expired or invalid security token')] };
    const fetch = router([json(200, body)]);
    const error = await catchError(new Sabre(config({ fetch })).booking.get(request));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ code: 'UNAUTHORIZED_ACCESS', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(2); // un token y una sola llamada al servicio
  });

  it('sin reserva, los avisos viajan adjuntos al error', async () => {
    const body = { errors: [fareRulesWarning, issue('BAD_REQUEST', 'INVALID_VALUE', 'Invalid filtering option.')] };
    const error = await catchError(new Sabre(config({ fetch: router([json(200, body)]) })).booking.get(request));

    expect(error).toMatchObject({ code: 'INVALID_VALUE' });
    expect((error as SabreBusinessError).warnings.map((w) => w.code)).toEqual(['RESOURCE_UNAVAILABLE']);
  });

  it('reintenta un 503 de gateway: es una lectura idempotente', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, ndcExample));
    const result = await getBooking(transport(fetch), request);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.bookingId).toBe('1SXXXCROMS3E3');
  });

  it('un 404 de gateway sale como SabreGatewayError sin reintento', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(404, {}));
    const error = await catchError(getBooking(transport(fetch), request));

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rechaza un request sin confirmationId antes de llamar a la red', async () => {
    const fetch = router([]);
    const sabre = new Sabre(config({ fetch }));

    await expect(sabre.booking.get({} as GetBookingRequest)).rejects.toThrow(TypeError);
    await expect(sabre.booking.get(null as unknown as GetBookingRequest)).rejects.toThrow(
      'sabre-client: booking.get espera { confirmationId: string, ... }',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fieldValue y los datos del pasajero no llegan al logger ni a los mensajes de error', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const unauthorized = {
      errors: [
        { category: 'UNAUTHORIZED', type: 'UNAUTHORIZED_ACCESS', fieldName: 'surname', fieldValue: 'PASAJERAREAL' },
      ],
    };
    const fetch = router([json(200, ndcExample), json(200, unauthorized)]);
    const sabre = new Sabre(config({ fetch, logger }));

    await sabre.booking.get({ confirmationId: '1SXXXCROMS3E3', surname: 'PASAJERAREAL' });
    const error = await catchError(sabre.booking.get({ confirmationId: 'GLEBNY', surname: 'PASAJERAREAL' }));

    const dump = JSON.stringify([logger.debug.mock.calls, logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    for (const secret of ['PASAJERAREAL', 'Yasmine', 'Koss', 'travel@sabre.com', '1970-01-23']) {
      expect(dump).not.toContain(secret);
    }
    expect((error as Error).message).not.toContain('PASAJERAREAL');
    expect(JSON.stringify(error)).not.toContain('PASAJERAREAL');
    expect((error as SabreError).raw).toEqual(unauthorized.errors[0]);
  });
});

describe('reintentos de los errores temporales de Get Booking', () => {
  it.each(['INTERNAL_SERVER_TIMEOUT', 'DOWNLINE_SERVICE_FAILURE'])('%s se reintenta y devuelve la reserva', async (type) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(200, { errors: [issue('APPLICATION_ERROR', type)] }))
      .mockResolvedValueOnce(json(200, ndcExample));
    const result = await getBooking(transport(fetch), request);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.bookingId).toBe('1SXXXCROMS3E3');
  });

  it('agota maxRetries y lanza el SabreBusinessError reintentable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json(200, { errors: [issue('APPLICATION_ERROR', 'INTERNAL_SERVER_TIMEOUT', 'Call to internal service timed out.')] }),
    );
    const error = await catchError(getBooking(transport(fetch), request));

    expect(fetch).toHaveBeenCalledTimes(4); // DEFAULT_RETRY.maxRetries = 3
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ code: 'INTERNAL_SERVER_TIMEOUT', retryable: true });
  });

  it.each(['FAULT_RESPONSE', 'BOOKING_RETRIEVAL', 'INTERNAL_PROCESSING_TIMEOUT', 'TRANSACTION_PROCESSING_TIMEOUT'])(
    '%s no se reintenta (solo los dos códigos decididos en #39)',
    async (type) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => json(200, { errors: [issue('APPLICATION_ERROR', type)] }));
      const error = await catchError(getBooking(transport(fetch), request));

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(error).toMatchObject({ code: type, retryable: false });
    },
  );
});

describe('classifyGetBooking', () => {
  it('con bookingId no hay error aunque errors[] traiga errores', () => {
    expect(classifyGetBooking({ bookingId: 'GLEBNY', errors: [issue('APPLICATION_ERROR', 'INTERNAL_PROCESSING_TIMEOUT')] })).toBeUndefined();
  });

  it('solo avisos y sin bookingId es una respuesta malformada', () => {
    const error = classifyGetBooking({ errors: [fareRulesWarning] });
    expect(error).toBeInstanceOf(SabreError);
    expect(error).not.toBeInstanceOf(SabreBusinessError);
    expect(error?.message).toBe('getBooking: respuesta malformada, sin bookingId ni errores fatales');
  });

  it('un body que no es objeto es una respuesta malformada', () => {
    expect(classifyGetBooking('<html>')).toMatchObject({ retryable: false, raw: '<html>' });
  });

  it('bookingId vacío no cuenta como reserva', () => {
    expect(classifyGetBooking({ bookingId: '', ...notFound })).toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });
});
