// sabre.tickets.fulfill y sabre.tickets.verify (#235, ADR-031) contra las respuestas grabadas en
// CERT (#231) y respuestas armadas desde el catálogo de Fulfill Flight Tickets.
import { describe, expect, it, vi } from 'vitest';
import {
  type FulfillTicketsRequest,
  Sabre,
  SabreBusinessError,
  SabreGatewayError,
  type SabreRawRequest,
  SabreUncertainOutcomeError,
} from '../src/index.js';
import issued from './fixtures/w4.sandbox-void-by-cancel-fulfill.json';
import getBooking from './fixtures/w4.sandbox-void-by-cancel-get-booking.json';
import commissionRequired from './fixtures/w4.sandbox-commission-required-fulfill.json';
import hardcopyRequired from './fixtures/w4.sandbox-hardcopy-required-fulfill.json';
import secureFlightRequired from './fixtures/w4.sandbox-secure-flight-required-fulfill.json';
import invalidStock from './fixtures/w4.sandbox-fulfill-invalid-ticket-stock-mx.json';
import { config, json } from './helpers.js';

const token = () => json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });

function router(service: Array<Response | Error>, tokenResponse: () => Response | Error = token) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input).includes('/auth/token')) {
      const next = tokenResponse();
      if (next instanceof Error) throw next;
      return next;
    }
    const next = service.shift();
    if (next === undefined) throw new Error(`sin respuesta para ${String(input)}`);
    if (next instanceof Error) throw next;
    return next;
  });
}

const serviceCalls = (fetch: ReturnType<typeof router>) => fetch.mock.calls.filter(([url]) => !String(url).includes('/auth/token'));
const sentBody = (fetch: ReturnType<typeof router>, index = 0) => JSON.parse(String(serviceCalls(fetch)[index]?.[1]?.body)) as Record<string, unknown>;
const tickets = (fetch: ReturnType<typeof router>) => new Sabre(config({ fetch })).tickets;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

const request: FulfillTicketsRequest = {
  confirmationId: 'ABCDEF',
  targetPcc: 'P8X1',
  fulfillments: [{ payment: { primaryFormOfPayment: 1 }, ticketingQualifiers: { commissionPercentage: '0.00' } }],
  formsOfPayment: [{ type: 'CASH' }],
  designatePrinters: [{ profileNumber: 1 }],
};

const recorded = (fixture: { first: { response: { status: number; body: unknown } } }) => json(fixture.first.response.status, fixture.first.response.body);
const ticket = (overrides: Record<string, unknown> = {}) => ({
  isCommitted: true,
  number: '0060000000001',
  date: '2026-11-13',
  payment: { total: '100.00', currencyCode: 'MXN' },
  ticketStatusName: 'Issued',
  ticketStatusCode: 'TE',
  ...overrides,
});
const error = (type: string, description: string, category = 'APPLICATION_ERROR') => ({ category, type, description });

describe('tickets.fulfill: request', () => {
  it('manda POST a fulfillFlightTickets con los defaults del SDK (ADR-019) y el resto tal cual', async () => {
    const fetch = router([recorded(issued)]);
    await tickets(fetch).fulfill(request);

    expect(String(serviceCalls(fetch)[0]?.[0])).toMatch(/\/v1\/trip\/orders\/fulfillFlightTickets$/);
    expect(sentBody(fetch)).toEqual({ acceptPriceChanges: false, priceQuoteExpirationMethod: 'Quit', ...request });
  });

  it('el consumidor puede pisar acceptPriceChanges y priceQuoteExpirationMethod', async () => {
    const fetch = router([recorded(issued)]);
    await tickets(fetch).fulfill({ ...request, acceptPriceChanges: true, priceQuoteExpirationMethod: 'Reprice' });

    expect(sentBody(fetch)).toMatchObject({ acceptPriceChanges: true, priceQuoteExpirationMethod: 'Reprice' });
  });

  it.each([
    [{ ...request, confirmationId: '' }, {}, 'confirmationId'],
    [{ ...request, fulfillments: [] }, {}, 'fulfillments'],
    [{ ...request, fulfillments: [{ ticketingQualifiers: { commissionAmount: '1', commissionPercentage: '1' } }] }, {}, 'commissionAmount'],
    [{ ...request, designatePrinters: [{ profileNumber: 1 }, { ticket: { countryCode: 'MX' } }] }, {}, 'perfil'],
    [request, { retry: { maxRetries: 2 } }, 'retry'],
  ])('una forma que Sabre rechaza, o retry, lanza TypeError sin red (%#)', async (bad, options, message) => {
    const fetch = router([]);
    const thrown = await rejection(tickets(fetch).fulfill(bad as FulfillTicketsRequest, options));

    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).message).toContain(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retry: { maxRetries: 0 } se acepta', async () => {
    await expect(tickets(router([recorded(issued)])).fulfill(request, { retry: { maxRetries: 0 } })).resolves.toMatchObject({ status: 'issued' });
  });
});

describe('tickets.fulfill: emitido (CERT, 2026-11-13)', () => {
  it('la emisión grabada da issued, con el boleto TE y el eco del request', async () => {
    const result = await tickets(router([recorded(issued)])).fulfill(request);

    expect(result.status).toBe('issued');
    expect(result.confirmationId).toBe('ABCDEF');
    expect(result.tickets).toEqual([expect.objectContaining({ number: '0060000000001', ticketStatusCode: 'TE', ticketStatusName: 'Issued', isCommitted: true })]);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.request).toMatchObject({ acceptPriceChanges: false, priceQuoteExpirationMethod: 'Quit' });
    expect(typeof result.timestamp).toBe('string');
  });

  it('el onRawRequest del consumidor se sigue llamando', async () => {
    const raws: SabreRawRequest[] = [];
    await tickets(router([recorded(issued)])).fulfill(request, { onRawRequest: (raw) => raws.push(raw) });

    expect(raws.map((raw) => raw.operation)).toEqual(['tickets.fulfill']);
  });
});

describe('tickets.fulfill: parcial', () => {
  it('PARTIAL_FULFILLMENT con boletos da partial, con el aviso', async () => {
    const body = { tickets: [ticket()], warnings: [error('PARTIAL_FULFILLMENT', 'At least one fulfillment operation was not processed correctly.', 'WARNING')] };
    const result = await tickets(router([json(200, body)])).fulfill(request);

    expect(result.status).toBe('partial');
    expect(result.tickets).toHaveLength(1);
    expect(result.warnings.map((warning) => warning.code)).toEqual(['PARTIAL_FULFILLMENT']);
  });

  it('un error que no da incierto junto con boletos da partial, con el error adjunto', async () => {
    const body = { tickets: [ticket()], errors: [error('MINIMUM_CONNECT_TIME_NOT_VALID', 'The fulfillment process cannot be continued.')] };
    const result = await tickets(router([json(200, body)])).fulfill(request);

    expect(result.status).toBe('partial');
    expect(result.errors.map((item) => item.code)).toEqual(['MINIMUM_CONNECT_TIME_NOT_VALID']);
  });
});

describe('tickets.fulfill: no emitido', () => {
  it.each([
    ['BOOKING_FULFILLED', 'The fulfillment operation cannot be processed. The booking is already fulfilled.'],
    ['PRICE_MISMATCH', 'No new tickets have been issued due to the price change (new total price: 120.00).'],
    ['INTERNAL_SERVER_TIMEOUT', 'No new tickets have been issued. Call to internal service timed out.'],
  ])('%s lanza SabreBusinessError no reintentable, sin repetir la llamada', async (type, description) => {
    const fetch = router([json(200, { errors: [error(type, description)] })]);
    const thrown = await rejection(tickets(fetch).fulfill(request));

    expect(thrown).toBeInstanceOf(SabreBusinessError);
    expect(thrown).toMatchObject({ service: 'fulfillFlightTickets', code: type, retryable: false });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it.each([[400], [403], [429]])('un %i del gateway sale como SabreGatewayError, sin reintento', async (status) => {
    const fetch = router([json(status, { errorCode: 'ERR.2SG.X', message: 'gateway' })]);
    const thrown = await rejection(tickets(fetch).fulfill(request));

    expect(thrown).toBeInstanceOf(SabreGatewayError);
    expect(thrown).not.toBeInstanceOf(SabreUncertainOutcomeError);
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('un 401 se repite una sola vez con token nuevo, como en Create y Cancel', async () => {
    const fetch = router([json(401, { errorCode: 'ERR.2SG.SEC.INVALID_CREDENTIALS' }), recorded(issued)]);
    await expect(tickets(fetch).fulfill(request)).resolves.toMatchObject({ status: 'issued' });
    expect(serviceCalls(fetch)).toHaveLength(2);
  });
});

describe('tickets.fulfill: incierto (ADR-031)', () => {
  it.each([
    ['comisión', commissionRequired],
    ['hardcopy', hardcopyRequired],
    ['Secure Flight', secureFlightRequired],
    ['stock de boleto', invalidStock],
  ])('DOWNLINE_SERVICE_ERROR grabado en CERT (%s) da incierto, aunque diga «No new tickets»', async (_, fixture) => {
    const fetch = router([recorded(fixture)]);
    const thrown = await rejection(tickets(fetch).fulfill(request));

    expect(thrown).toBeInstanceOf(SabreUncertainOutcomeError);
    expect(thrown).toMatchObject({ reason: 'DOWNLINE_SERVICE_ERROR', operation: 'tickets.fulfill', confirmationId: 'ABCDEF', retryable: false, tickets: [] });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['UNABLE_TO_RETRIEVE_TICKETS como error', { errors: [error('UNABLE_TO_RETRIEVE_TICKETS', 'Tickets might have been issued successfully but application could not retrieve them.')] }, 'UNABLE_TO_RETRIEVE_TICKETS'],
    ['UNABLE_TO_RETRIEVE_TICKETS como aviso', { tickets: [ticket()], warnings: [error('UNABLE_TO_RETRIEVE_TICKETS', 'The fulfillment process has not been completed in the requested time.', 'WARNING')] }, 'UNABLE_TO_RETRIEVE_TICKETS'],
    ['FULFILLMENT_NOT_CONFIRMED', { warnings: [error('FULFILLMENT_NOT_CONFIRMED', 'The fulfillment operation cannot be confirmed.', 'WARNING')] }, 'FULFILLMENT_NOT_CONFIRMED'],
    ['INTERNAL_SERVER_TIMEOUT «exceeded»', { errors: [error('INTERNAL_SERVER_TIMEOUT', 'The downline ticketing service exceeded its processing time and the request timed out. Please retry the fulfillment attempt.')] }, 'INTERNAL_SERVER_TIMEOUT'],
    ['PAYMENT_CARD_ISSUE', { errors: [error('PAYMENT_CARD_ISSUE', 'At least one fulfillment operation was not processed correctly.')] }, 'PAYMENT_CARD_ISSUE'],
    ['un 2xx sin boletos ni errores', {}, 'FULFILLMENT_NOT_CONFIRMED'],
  ])('%s da incierto', async (_, body, reason) => {
    const thrown = await rejection(tickets(router([json(200, body)])).fulfill(request));

    expect(thrown).toBeInstanceOf(SabreUncertainOutcomeError);
    expect((thrown as SabreUncertainOutcomeError).reason).toBe(reason);
  });

  it('con isCommitted: false da NOT_COMMITTED y trae siempre los boletos (están emitidos)', async () => {
    const body = { tickets: [ticket(), ticket({ number: '0060000000002', isCommitted: false })] };
    const thrown = (await rejection(tickets(router([json(200, body)])).fulfill(request))) as SabreUncertainOutcomeError;

    expect(thrown.reason).toBe('NOT_COMMITTED');
    expect(thrown.tickets).toEqual([
      { number: '0060000000001', ticketStatusCode: 'TE', isCommitted: true },
      { number: '0060000000002', ticketStatusCode: 'TE', isCommitted: false },
    ]);
  });

  it('un fallo de red con el request mandado da TRANSPORT, sin reintento', async () => {
    const fetch = router([new TypeError('fetch failed')]);
    const thrown = await rejection(tickets(fetch).fulfill(request));

    expect(thrown).toMatchObject({ name: 'SabreUncertainOutcomeError', reason: 'TRANSPORT' });
    expect((thrown as Error).cause).toBeInstanceOf(SabreGatewayError);
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it.each([[500], [502], [503], [504]])('un %i del gateway da GATEWAY_5XX, sin reintento', async (status) => {
    const fetch = router([json(status, { errorCode: 'ERR.2SG.PROVIDER.ERROR' })]);
    const thrown = await rejection(tickets(fetch).fulfill(request));

    expect(thrown).toMatchObject({ reason: 'GATEWAY_5XX' });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('un 2xx que no es JSON da UNPARSEABLE', async () => {
    const thrown = await rejection(tickets(router([new Response('<html>oops</html>', { status: 200 })])).fulfill(request));
    expect(thrown).toMatchObject({ reason: 'UNPARSEABLE' });
  });

  it('un abort con el request ya mandado da ABORTED, con el AbortError en cause', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const thrown = await rejection(tickets(router([abort])).fulfill(request, { signal: new AbortController().signal }));

    expect(thrown).toMatchObject({ reason: 'ABORTED' });
    expect((thrown as Error).cause).toBe(abort);
  });

  it('un abort antes de mandar el request (al pedir el token) se propaga tal cual', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const fetch = router([], () => abort);
    const thrown = await rejection(tickets(fetch).fulfill(request));

    expect(thrown).toBe(abort);
    expect(serviceCalls(fetch)).toHaveLength(0);
  });
});

describe('tickets.verify (Get Booking grabado en CERT)', () => {
  const booking = (stage: 'before' | 'afterFulfill' | 'afterVoid') => json(200, getBooking[stage].response.body);

  it('antes de emitir: notFound', async () => {
    await expect(tickets(router([booking('before')])).verify({ confirmationId: 'ABCDEF' })).resolves.toMatchObject({ status: 'notFound' });
  });

  it('después de emitir: issued, con el boleto TE, y manda targetPcc a Get Booking', async () => {
    const fetch = router([booking('afterFulfill')]);
    const result = await tickets(fetch).verify({ confirmationId: 'ABCDEF', targetPcc: 'P8X1' });

    expect(result).toMatchObject({ status: 'issued', tickets: [{ number: '0060000000001', ticketStatusCode: 'TE' }] });
    expect(sentBody(fetch)).toEqual({ confirmationId: 'ABCDEF', targetPcc: 'P8X1' });
  });

  it('un boleto anulado (TV) no cuenta, aunque isTicketed siga en true', async () => {
    await expect(tickets(router([booking('afterVoid')])).verify({ confirmationId: 'ABCDEF' })).resolves.toMatchObject({ status: 'notFound' });
  });

  it('knownTickets deja afuera los boletos que ya estaban', async () => {
    const result = await tickets(router([booking('afterFulfill')])).verify({ confirmationId: 'ABCDEF', knownTickets: ['0060000000001'] });
    expect(result.status).toBe('notFound');
  });

  it('expectedTickets que no están en el PNR dan notCommitted, no notFound', async () => {
    const result = await tickets(router([booking('before')])).verify({ confirmationId: 'ABCDEF', expectedTickets: ['0060000000009'] });
    expect(result).toMatchObject({ status: 'notCommitted', missing: ['0060000000009'] });
  });

  it('expectedTickets presentes dan issued', async () => {
    const result = await tickets(router([booking('afterFulfill')])).verify({ confirmationId: 'ABCDEF', expectedTickets: ['0060000000001'] });
    expect(result.status).toBe('issued');
  });

  it('es una lectura: un 503 de Get Booking se reintenta', async () => {
    const fetch = router([json(503, {}), booking('afterFulfill')]);
    const result = await new Sabre(config({ fetch, retry: { maxRetries: 1, baseDelayMs: 0 } })).tickets.verify({ confirmationId: 'ABCDEF' });

    expect(result.status).toBe('issued');
    expect(serviceCalls(fetch)).toHaveLength(2);
  });

  it.each([[{ confirmationId: '' }], [{ confirmationId: 'ABCDEF', expectedTickets: [1] }]])('una forma inválida lanza TypeError sin red (%j)', async (bad) => {
    const fetch = router([]);
    await expect(tickets(fetch).verify(bad as never)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
