import { describe, expect, it, vi } from 'vitest';
import { classifyCancelBooking } from '../src/booking/cancel-booking.js';
import {
  type CancelBookingRequest,
  Sabre,
  SabreBusinessError,
  SabreError,
  SabreGatewayError,
  SabreWarning,
} from '../src/index.js';
import { config, json } from './helpers.js';

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

const cancelAll: CancelBookingRequest = { confirmationId: 'KFZHAA', cancelAll: true };

/** Caso de uso 9 de la fuente: éxito sin `retrieveBooking`, solo el eco del request. */
const echoOnly = {
  request: { confirmationId: 'KFZHAA', retrieveBooking: false, errorHandlingPolicy: 'HALT_ON_ERROR', cancelAll: true },
};

/** Caso de uso 8 de la fuente: `NO_ITEMS_CANCELLED` junto con la causa real. */
const useCase8 = {
  request: {
    confirmationId: 'MFLSHG',
    retrieveBooking: false,
    flightTicketOperation: 'VOID',
    cancelAll: false,
    flights: [{ itemId: '7' }, { itemId: '19' }],
  },
  errors: [
    {
      category: 'WARNING',
      type: 'NO_ITEMS_CANCELLED',
      description: 'Nothing was cancelled - cancellation was interrupted due to errors',
    },
    {
      category: 'CANCELLATION_ERROR',
      type: 'UNABLE_TO_VOID_TICKET',
      description:
        'The ticket does not match the segments selected for cancellation. Review flights selection or void using /v1/trip/orders/cancelFlightTicket.',
      fieldPath: 'cancelBookingRequest.flights',
      fieldName: 'itemId',
      fieldValue: '[1251237703376, 6071237703375]',
    },
  ],
};

const segmentNotFound = {
  errors: [{ category: 'INVALID_DATA', type: 'SEGMENT_NOT_FOUND', description: 'Reservation does not contain any segments' }],
};

describe('sabre.booking.cancel', () => {
  it('hace POST /v1/trip/orders/cancelBooking con el body tal cual, sin errorHandlingPolicy por defecto', async () => {
    const fetch = router([json(200, echoOnly)]);
    await new Sabre(config({ fetch })).booking.cancel(cancelAll);

    const [[url, init]] = serviceCalls(fetch) as [[string, RequestInit]];
    expect(url).toBe('https://api.cert.platform.sabre.com/v1/trip/orders/cancelBooking');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(cancelAll);
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer T1');
  });

  it('éxito sin errors (solo request): devuelve el eco y warnings vacío', async () => {
    const result = await new Sabre(config({ fetch: router([json(200, echoOnly)]) })).booking.cancel(cancelAll);

    expect(result).toEqual({ ...echoOnly, warnings: [] });
  });

  it('con retrieveBooking, el estado posterior viene anidado en booking', async () => {
    const body = { ...echoOnly, booking: { bookingId: 'KFZHAA', isCancelable: false } };
    const result = await new Sabre(config({ fetch: router([json(200, body)]) })).booking.cancel({
      confirmationId: 'KFZHAA',
      retrieveBooking: true,
      flights: [{ itemId: '2' }],
    });

    expect(result.booking).toEqual({ bookingId: 'KFZHAA', isCancelable: false });
  });

  it('END_TRANSACTION_PROBLEM es un aviso: no lanza y va en warnings', async () => {
    const pending = {
      category: 'WARNING',
      type: 'END_TRANSACTION_PROBLEM',
      description: 'The cancellation was sent to the vendor. Confirmation is pending. Redisplay the booking to verify the status.',
    };
    const result = await new Sabre(config({ fetch: router([json(200, { ...echoOnly, errors: [pending] })]) })).booking.cancel(
      cancelAll,
    );

    expect(result).not.toHaveProperty('errors');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toBeInstanceOf(SabreWarning);
    expect(result.warnings[0]).toMatchObject({ service: 'cancelBooking', code: 'END_TRANSACTION_PROBLEM' });
  });

  it('con ALLOW_PARTIAL_CANCEL, UNABLE_TO_CANCEL como WARNING no lanza', async () => {
    const body = { ...echoOnly, errors: [{ category: 'WARNING', type: 'UNABLE_TO_CANCEL', description: 'Operation of cancel CSL content failed' }] };
    const result = await new Sabre(config({ fetch: router([json(200, body)]) })).booking.cancel({
      confirmationId: 'KFZHAA',
      flights: [{ itemId: '2' }],
      hotels: [{ itemId: '3' }],
      errorHandlingPolicy: 'ALLOW_PARTIAL_CANCEL',
    });

    expect(result.warnings.map((w) => w.code)).toEqual(['UNABLE_TO_CANCEL']);
  });

  it('NO_ITEMS_CANCELLED lanza aunque llegue como WARNING, con la causa real en errors (caso de uso 8)', async () => {
    const fetch = router([json(200, useCase8)]);
    const error = await catchError(
      new Sabre(config({ fetch })).booking.cancel({
        confirmationId: 'MFLSHG',
        flightTicketOperation: 'VOID',
        flights: [{ itemId: '7' }, { itemId: '19' }],
      }),
    );

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'cancelBooking', code: 'NO_ITEMS_CANCELLED', retryable: false });
    expect((error as Error).message).toBe(
      'cancelBooking: WARNING NO_ITEMS_CANCELLED: Nothing was cancelled - cancellation was interrupted due to errors',
    );
    const { errors, warnings } = error as SabreBusinessError;
    expect(warnings).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ service: 'cancelBooking', code: 'UNABLE_TO_VOID_TICKET' });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('SEGMENT_NOT_FOUND lanza SabreBusinessError (cancelar de nuevo un PNR vacío)', async () => {
    const error = await catchError(new Sabre(config({ fetch: router([json(200, segmentNotFound)]) })).booking.cancel(cancelAll));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ code: 'SEGMENT_NOT_FOUND', retryable: false, errors: [], warnings: [] });
  });

  it('SECURITY_TOKEN_CONTEXT_ERROR lanza sin refresco reactivo ni reintento', async () => {
    const body = {
      errors: [{ category: 'BAD_REQUEST', type: 'SECURITY_TOKEN_CONTEXT_ERROR', description: 'Invalid authentication token. Nothing was cancelled.' }],
    };
    const fetch = router([json(200, body)]);
    const error = await catchError(new Sabre(config({ fetch })).booking.cancel(cancelAll));

    expect(error).toMatchObject({ code: 'SECURITY_TOKEN_CONTEXT_ERROR', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(2); // un token y una sola llamada al servicio
  });

  it('sin NO_ITEMS_CANCELLED, lanza el primer error fatal con el resto en errors y los avisos en warnings', async () => {
    const body = {
      errors: [
        { category: 'WARNING', type: 'UNABLE_TO_RETRIEVE_BOOKING', description: 'Problem occurred when booking data fetched.' },
        { category: 'APPLICATION_ERROR', type: 'SYSTEM_SLOW_DOWN', description: 'Operation aborted due to system slow down.' },
        { category: 'CANCELLATION_ERROR', type: 'UNABLE_TO_CANCEL', description: 'Operation of ending transaction failed' },
      ],
    };
    const error = await catchError(new Sabre(config({ fetch: router([json(200, body)]) })).booking.cancel(cancelAll));

    expect(error).toMatchObject({ code: 'SYSTEM_SLOW_DOWN' });
    expect((error as SabreBusinessError).errors.map((e) => e.code)).toEqual(['UNABLE_TO_CANCEL']);
    expect((error as SabreBusinessError).warnings.map((w) => w.code)).toEqual(['UNABLE_TO_RETRIEVE_BOOKING']);
  });

  it('no reintenta: un 503 sale como SabreGatewayError tras una sola llamada', async () => {
    const fetch = router([json(503, {})]);
    const error = await catchError(new Sabre(config({ fetch })).booking.cancel(cancelAll));

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('no reintenta un fallo de red', async () => {
    const fetch = router([new TypeError('fetch failed')]);
    const error = await catchError(new Sabre(config({ fetch })).booking.cancel(cancelAll));

    expect(error).toMatchObject({ retryable: true });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('fieldValue no llega al logger ni a los mensajes de error', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const error = await catchError(
      new Sabre(config({ fetch: router([json(200, useCase8)]), logger })).booking.cancel({
        confirmationId: 'MFLSHG',
        flights: [{ itemId: '7' }],
      }),
    );

    const dump = JSON.stringify([logger.debug.mock.calls, logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(dump).not.toContain('1251237703376');
    expect(JSON.stringify(error)).not.toContain('1251237703376');
    expect((error as SabreBusinessError).errors[0]!.message).not.toContain('1251237703376');
  });
});

describe('validación local de booking.cancel', () => {
  it.each<[string, CancelBookingRequest, string]>([
    ['sin confirmationId', { cancelAll: true } as CancelBookingRequest, 'espera { confirmationId: string, ... }'],
    ['cancelAll con flights', { confirmationId: 'KFZHAA', cancelAll: true, flights: [{ itemId: '2' }] }, 'no combina cancelAll con listas'],
    ['cancelAll con segments vacío', { confirmationId: 'KFZHAA', cancelAll: true, segments: [] }, 'no combina cancelAll con listas'],
    ['sin cancelAll ni listas', { confirmationId: 'KFZHAA' }, 'necesita cancelAll: true o al menos una lista'],
    ['cancelAll: false y listas vacías', { confirmationId: 'KFZHAA', cancelAll: false, flights: [] }, 'necesita cancelAll: true o al menos una lista'],
    [
      'offerItemId con flightTicketOperation',
      { confirmationId: 'KFZHAA', cancelAll: true, offerItemId: 'OFFER1', flightTicketOperation: 'VOID' },
      'no combina offerItemId con flightTicketOperation',
    ],
  ])('%s → TypeError sin red', async (_case, request, message) => {
    const fetch = router([]);
    const promise = new Sabre(config({ fetch })).booking.cancel(request);

    await expect(promise).rejects.toThrow(TypeError);
    await expect(promise).rejects.toThrow(`sabre-client: booking.cancel ${message}`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<[string, CancelBookingRequest]>([
    ['cancelAll', { confirmationId: 'KFZHAA', cancelAll: true }],
    ['flights por itemId', { confirmationId: 'KFZHAA', flights: [{ itemId: '2' }] }],
    ['segments por id', { confirmationId: 'KFZHAA', cancelAll: false, segments: [{ id: '12' }] }],
    ['offerItemId solo', { confirmationId: '1SXXXCROMS3E3', cancelAll: true, offerItemId: 'OFFER1' }],
  ])('%s es válido', async (_case, request) => {
    const fetch = router([json(200, echoOnly)]);
    await new Sabre(config({ fetch })).booking.cancel(request);

    expect(serviceCalls(fetch)).toHaveLength(1);
  });
});

describe('classifyCancelBooking', () => {
  it('solo avisos es éxito', () => {
    expect(classifyCancelBooking({ errors: [{ category: 'warning', type: 'END_TRANSACTION_PROBLEM' }] })).toBeUndefined();
  });

  it('NO_ITEMS_CANCELLED solo, sin otros errores, también es fallo', () => {
    const error = classifyCancelBooking({ errors: [useCase8.errors[0]] });
    expect(error).toMatchObject({ code: 'NO_ITEMS_CANCELLED', errors: [] });
  });

  it('un body que no es objeto es una respuesta malformada', () => {
    const error = classifyCancelBooking('<html>');
    expect(error).toBeInstanceOf(SabreError);
    expect(error).not.toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ retryable: false, raw: '<html>' });
  });
});
