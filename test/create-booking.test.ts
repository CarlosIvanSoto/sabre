import { describe, expect, it, vi } from 'vitest';
import { classifyCreateBooking } from '../src/booking/create-booking.js';
import {
  type CreateBookingRequest,
  Sabre,
  SabreBusinessError,
  SabreError,
  SabreGatewayError,
  SabreWarning,
} from '../src/index.js';
import { config, json } from './helpers.js';

const request: CreateBookingRequest = {
  flightDetails: {
    flights: [
      {
        flightNumber: 2402,
        airlineCode: 'AA',
        fromAirportCode: 'DFW',
        toAirportCode: 'LAX',
        departureDate: '2026-11-09',
        departureTime: '07:00',
        bookingClass: 'O',
        flightStatusCode: 'NN',
      },
    ],
    flightPricing: [{ qualifiers: { passengersPricing: [{ passengerCode: 'ADT', numberOfpassengers: 1 }] } }],
  },
  travelers: [{ givenName: 'ANAREAL', surname: 'PASAJERAREAL', passengerCode: 'ADT', emails: ['ana@real.example'] }],
  contactInfo: { emails: ['ana@real.example'], phones: ['5555555555'] },
};

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

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

const warning = (type: string, description = 'aviso') => ({ category: 'WARNING', type, description });

describe('sabre.booking.create', () => {
  it('hace POST /v1/trip/orders/createBooking con el body tal cual y Bearer', async () => {
    const fetch = router([json(200, { confirmationId: 'GLEBNY' })]);
    await new Sabre(config({ fetch })).booking.create(request);

    const [[url, init]] = serviceCalls(fetch) as [[string, RequestInit]];
    expect(url).toBe('https://api.cert.platform.sabre.com/v1/trip/orders/createBooking');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(request);
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer T1');
  });

  it('devuelve confirmationId, booking y listas vacías si Sabre no manda errors[]', async () => {
    const body = { timestamp: '2026-10-10T18:00:00Z', confirmationId: 'GLEBNY', booking: { bookingId: 'GLEBNY' } };
    const result = await new Sabre(config({ fetch: router([json(200, body)]) })).booking.create(request);

    expect(result).toEqual({ ...body, warnings: [], errors: [] });
  });

  it('con reserva creada, los WARNING y los errores no fatales van adjuntos y no se lanza', async () => {
    const body = {
      confirmationId: 'GLEBNY',
      errors: [
        warning('AIRCRAFT_CHANGE', 'Seat selection has been partially completed.'),
        { category: 'APPLICATION_ERROR', type: 'UNABLE_TO_BOOK_SEATS', description: 'seat failed' },
        warning('PARTIAL_SEAT_ASSIGNMENT'),
      ],
    };
    const result = await new Sabre(config({ fetch: router([json(200, body)]) })).booking.create({
      ...request,
      errorHandlingPolicy: ['DO_NOT_HALT_ON_SEAT_BOOKING_ERROR'],
    });

    expect(result.confirmationId).toBe('GLEBNY');
    expect(result.warnings.map((w) => w.code)).toEqual(['AIRCRAFT_CHANGE', 'PARTIAL_SEAT_ASSIGNMENT']);
    expect(result.warnings.every((w) => w instanceof SabreWarning && w.service === 'createBooking')).toBe(true);
    expect(result.warnings[0]!.raw).toEqual(body.errors[0]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBeInstanceOf(SabreBusinessError);
    expect(result.errors[0]).toMatchObject({ code: 'UNABLE_TO_BOOK_SEATS', retryable: false });
    expect(result.errors[0]!.message).toBe('createBooking: APPLICATION_ERROR UNABLE_TO_BOOK_SEATS: seat failed');
  });

  it('UNABLE_TO_RETRIEVE_BOOKING: la reserva existe y el confirmationId sale del description', async () => {
    const body = {
      errors: [
        warning(
          'UNABLE_TO_RETRIEVE_BOOKING',
          'Booking was created successfully but could not be retrieved. (QWERTY)',
        ),
      ],
    };
    const result = await new Sabre(config({ fetch: router([json(200, body)]) })).booking.create(request);

    expect(result.confirmationId).toBe('QWERTY');
    expect(result.booking).toBeUndefined();
    expect(result.warnings.map((w) => w.code)).toEqual(['UNABLE_TO_RETRIEVE_BOOKING']);
  });

  it('sin reserva lanza SabreBusinessError con el primer error no WARNING y los avisos adjuntos', async () => {
    const body = {
      errors: [
        warning('DUPLICATE_TITLE_DETAILS'),
        { category: 'BAD_REQUEST', type: 'REQUIRED_FIELD_MISSING', fieldPath: 'travelers[0].surname', description: 'may not be null' },
        { category: 'APPLICATION_ERROR', type: 'UNABLE_TO_BOOK_FLIGHTS' },
      ],
    };
    const fetch = router([json(200, body)]);
    const error = await catchError(new Sabre(config({ fetch })).booking.create(request));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'createBooking', code: 'REQUIRED_FIELD_MISSING', retryable: false });
    expect((error as Error).message).toBe(
      'createBooking: BAD_REQUEST REQUIRED_FIELD_MISSING en travelers[0].surname: may not be null',
    );
    const { warnings } = error as SabreBusinessError;
    expect(warnings.map((w) => w.code)).toEqual(['DUPLICATE_TITLE_DETAILS']);
    expect((error as SabreError).raw).toEqual(body.errors[1]);
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('fieldValue no entra al mensaje ni a la serialización del error', async () => {
    const body = {
      errors: [
        {
          category: 'BAD_REQUEST',
          type: 'INVALID_FIELD_VALUE',
          fieldName: 'email',
          fieldValue: 'ana@real.example',
        },
      ],
    };
    const error = await catchError(new Sabre(config({ fetch: router([json(200, body)]) })).booking.create(request));
    expect(JSON.stringify(error)).not.toContain('ana@real.example');
    expect((error as Error).message).not.toContain('ana@real.example');
  });

  it('no reintenta: un 503 sale como SabreGatewayError tras una sola llamada', async () => {
    const fetch = router([json(503, { errorCode: 'ERR.2SG.PROVIDER.UNAVAILABLE' }), json(200, { confirmationId: 'X' })]);
    const error = await catchError(new Sabre(config({ fetch, retry: { baseDelayMs: 0 } })).booking.create(request));

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as SabreGatewayError).retryable).toBe(true);
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('no reintenta un fallo de red', async () => {
    const fetch = router([new TypeError('fetch failed'), json(200, { confirmationId: 'X' })]);
    const error = await catchError(new Sabre(config({ fetch, retry: { baseDelayMs: 0 } })).booking.create(request));

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('ante un 401 repite una sola vez con token nuevo (el gateway rechaza antes del proveedor)', async () => {
    const fetch = router([json(401, { errorCode: 'ERR.2SG.SEC.INVALID_CREDENTIALS' }), json(200, { confirmationId: 'GLEBNY' })]);
    const result = await new Sabre(config({ fetch })).booking.create(request);

    expect(result.confirmationId).toBe('GLEBNY');
    expect(serviceCalls(fetch)).toHaveLength(2);
  });

  it('un 4xx con errors[] sale hoy como SabreGatewayError con el body en raw (status real sin confirmar)', async () => {
    const body = { errors: [{ category: 'BAD_REQUEST', type: 'REQUIRED_FIELD_MISSING' }] };
    const error = await catchError(new Sabre(config({ fetch: router([json(400, body)]) })).booking.create(request));

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error).toMatchObject({ status: 400, retryable: false });
    expect((error as SabreError).raw).toEqual(body);
  });

  it('rechaza un request que no es objeto antes de llamar a la red', async () => {
    const fetch = router([]);
    await expect(
      new Sabre(config({ fetch })).booking.create(null as unknown as CreateBookingRequest),
    ).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('FUTURE_TICKETING sin futureTicketingPolicy lanza TypeError sin llamar a la red', async () => {
    const fetch = router([]);
    const error = await catchError(
      new Sabre(config({ fetch })).booking.create({ ...request, agency: { ticketingPolicy: 'FUTURE_TICKETING' } }),
    );

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/^sabre-client: .*futureTicketingPolicy/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('FUTURE_TICKETING con futureTicketingPolicy se envía tal cual', async () => {
    const fetch = router([json(200, { confirmationId: 'GLEBNY' })]);
    const withPolicy: CreateBookingRequest = {
      ...request,
      agency: {
        ticketingPolicy: 'FUTURE_TICKETING',
        futureTicketingPolicy: { ticketingDate: '2026-11-01', ticketingPcc: 'XXXX' },
      },
    };
    await new Sabre(config({ fetch })).booking.create(withPolicy);

    const [[, init]] = serviceCalls(fetch) as [[string, RequestInit]];
    expect(JSON.parse(init.body as string)).toEqual(withPolicy);
  });

  it.each(['TODAY', 'ALREADY_TICKETED', 'TICKETING_TIME_LIMIT'] as const)(
    '%s sin futureTicketingPolicy se envía igual que antes',
    async (ticketingPolicy) => {
      const fetch = router([json(200, { confirmationId: 'GLEBNY' })]);
      const other: CreateBookingRequest = { ...request, agency: { ticketingPolicy } };
      await new Sabre(config({ fetch })).booking.create(other);

      const [[, init]] = serviceCalls(fetch) as [[string, RequestInit]];
      expect(JSON.parse(init.body as string)).toEqual(other);
    },
  );

  it('ningún dato del pasajero llega al logger, ni en éxito ni en error', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fetch = router([
      json(200, { confirmationId: 'GLEBNY', request }),
      json(200, { errors: [{ category: 'BAD_REQUEST', type: 'INVALID', fieldValue: 'PASAJERAREAL' }] }),
    ]);
    const sabre = new Sabre(config({ fetch, logger }));
    await sabre.booking.create(request);
    await catchError(sabre.booking.create(request));

    const dump = JSON.stringify([logger.debug.mock.calls, logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(dump).toContain('createBooking');
    for (const secret of ['ANAREAL', 'PASAJERAREAL', 'ana@real.example', '5555555555']) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe('classifyCreateBooking', () => {
  it('con confirmationId no hay error aunque errors[] traiga errores', () => {
    expect(
      classifyCreateBooking({ confirmationId: 'GLEBNY', errors: [{ category: 'APPLICATION_ERROR', type: 'X' }] }),
    ).toBeUndefined();
  });

  it('booking.bookingId también cuenta como reserva creada', () => {
    expect(classifyCreateBooking({ booking: { bookingId: 'GLEBNY' } })).toBeUndefined();
  });

  it('booking sin localizador: la reserva existe pero no hay confirmationId que devolver', () => {
    const error = classifyCreateBooking({ booking: { isTicketed: false } });
    expect(error).toBeInstanceOf(SabreError);
    expect(error).not.toBeInstanceOf(SabreBusinessError);
    expect(error!.message).toContain('no devolvió su confirmationId');
  });

  it('UNABLE_TO_RETRIEVE_BOOKING sin localizador legible tampoco se da por fallido', () => {
    const error = classifyCreateBooking({
      errors: [
        warning('UNABLE_TO_RETRIEVE_BOOKING', 'could not be retrieved.'),
        { category: 'APPLICATION_ERROR', type: 'UNABLE_TO_BOOK_SEATS' },
      ],
    });
    expect(error).not.toBeInstanceOf(SabreBusinessError);
    expect(error!.message).toContain('no devolvió su confirmationId');
  });

  it('solo avisos y sin reserva es una respuesta malformada', () => {
    const error = classifyCreateBooking({ errors: [warning('AIRCRAFT_CHANGE')] });
    expect(error).not.toBeInstanceOf(SabreBusinessError);
    expect(error!.message).toBe('createBooking: respuesta malformada, sin confirmationId ni errores fatales');
  });

  it('un body que no es objeto es una respuesta malformada', () => {
    expect(classifyCreateBooking('<html>')).toBeInstanceOf(SabreError);
    expect(classifyCreateBooking(undefined)!.retryable).toBe(false);
  });

  it('la categoría WARNING se compara sin distinguir mayúsculas', () => {
    const error = classifyCreateBooking({
      errors: [{ category: 'warning', type: 'AIRCRAFT_CHANGE' }, { category: 'APPLICATION_ERROR', type: 'TIMEOUT' }],
    });
    expect(error).toMatchObject({ code: 'TIMEOUT' });
    expect((error as SabreBusinessError).warnings.map((w) => w.code)).toEqual(['AIRCRAFT_CHANGE']);
  });
});
