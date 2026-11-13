// El fake de sabre-client/testing con reserva, emisión y void por REST (#242, F3.1, ADR-031).
import { describe, expect, it } from 'vitest';
import { Sabre, SabreBusinessError, SabreUncertainOutcomeError, type SabreUncertainOutcomeReason } from '../src/index.js';
import { createQueueFake, type QueueFakeOptions } from '../src/testing/index.js';
import { config } from './helpers.js';

const NOW = new Date('2026-11-13T16:00:00Z');

function client(options: QueueFakeOptions = {}) {
  const fake = createQueueFake({ now: () => NOW, ...options });
  const sabre = new Sabre(config({ fetch: fake.fetch, retry: { maxRetries: 0 } }));
  return { fake, sabre };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

const fulfillRequest = (confirmationId: string) => ({
  confirmationId,
  fulfillments: [{ payment: { primaryFormOfPayment: 1 } }],
  formsOfPayment: [{ type: 'CASH' as const }],
  designatePrinters: [{ profileNumber: 1 }],
});
const voidAll = (confirmationId: string) => ({ confirmationId, cancelAll: true, flightTicketOperation: 'VOID' as const, retrieveBooking: true });

describe('W4 contra el fake', () => {
  it('create → fulfill → verify → cancel VOID → verify, como en CERT', async () => {
    const { fake, sabre } = client();
    const { confirmationId } = await sabre.booking.create({ flightDetails: { flights: [{}] } } as never);
    expect(confirmationId).toBe('FAKEAA');

    const issued = await sabre.tickets.fulfill(fulfillRequest(confirmationId));
    expect(issued).toMatchObject({ status: 'issued', tickets: [{ ticketStatusCode: 'TE', isCommitted: true }] });
    const number = issued.tickets[0]!.number;

    const booking = await sabre.booking.get({ confirmationId });
    expect(booking.isTicketed).toBe(true);
    expect(booking.flightTickets?.map((t) => [t.number, t.ticketStatusCode])).toEqual([[number, 'TE']]);
    await expect(sabre.tickets.verify({ confirmationId, expectedTickets: [number] })).resolves.toMatchObject({ status: 'issued' });

    const voided = await sabre.booking.cancel(voidAll(confirmationId));
    expect(voided.voidedTickets).toEqual([number]);

    const after = await sabre.booking.get({ confirmationId });
    expect(after.isTicketed).toBe(true);
    expect(after.flights).toEqual([]);
    expect(after.flightTickets?.map((t) => t.ticketStatusCode)).toEqual(['TV']);
    await expect(sabre.tickets.verify({ confirmationId })).resolves.toMatchObject({ status: 'notFound' });

    expect(fake.calls.filter((call) => call.command !== 'token').map((call) => `${call.command}:${call.locator}`)).toEqual([
      'createBooking:FAKEAA',
      'fulfill:FAKEAA',
      'getBooking:FAKEAA',
      'getBooking:FAKEAA',
      'cancelBooking:FAKEAA',
      'getBooking:FAKEAA',
      'getBooking:FAKEAA',
    ]);
  });

  it('una segunda emisión sobre la misma reserva da BOOKING_FULFILLED', async () => {
    const { sabre } = client({ bookings: { ABCDEF: {} } });
    await sabre.tickets.fulfill(fulfillRequest('ABCDEF'));
    const thrown = await rejection(sabre.tickets.fulfill(fulfillRequest('ABCDEF')));

    expect(thrown).toBeInstanceOf(SabreBusinessError);
    expect(thrown).toMatchObject({ code: 'BOOKING_FULFILLED' });
  });

  it('VOID sin boletos da NO_ITEMS_CANCELLED con UNABLE_TO_VOID_TICKET y no cancela nada', async () => {
    const { sabre } = client({ bookings: { ABCDEF: { flights: 2 } } });
    const thrown = (await rejection(sabre.booking.cancel(voidAll('ABCDEF')))) as SabreBusinessError;

    expect(thrown.code).toBe('NO_ITEMS_CANCELLED');
    expect(thrown.errors.map((error) => error.code)).toEqual(['UNABLE_TO_VOID_TICKET']);
    expect((await sabre.booking.get({ confirmationId: 'ABCDEF' })).flights).toHaveLength(2);
  });

  it('sin VOID, cancelAll cancela la reserva', async () => {
    const { sabre } = client({ bookings: { ABCDEF: {} } });
    await sabre.booking.cancel({ confirmationId: 'ABCDEF', cancelAll: true });
    expect((await sabre.booking.get({ confirmationId: 'ABCDEF' })).flights).toEqual([]);
  });

  it('las reservas sembradas traen sus boletos; una que no existe da BOOKING_NOT_FOUND', async () => {
    const { sabre } = client({ bookings: { ABCDEF: { tickets: [{ number: '0010000000001' }, { number: '0010000000002', ticketStatusCode: 'TV' }] } } });
    const result = await sabre.tickets.verify({ confirmationId: 'ABCDEF' });

    expect(result).toMatchObject({ status: 'issued', tickets: [{ number: '0010000000001' }] });
    await expect(sabre.booking.get({ confirmationId: 'ZZZZZZ' })).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });
});

describe('tickets.fulfill: desenlaces forzados', () => {
  it('partial emite y avisa PARTIAL_FULFILLMENT', async () => {
    const { sabre } = client({ bookings: { ABCDEF: {} }, ticketing: { fulfill: ['partial'] } });
    const result = await sabre.tickets.fulfill(fulfillRequest('ABCDEF'));

    expect(result.status).toBe('partial');
    expect(result.warnings.map((warning) => warning.code)).toEqual(['PARTIAL_FULFILLMENT']);
  });

  it.each<[SabreUncertainOutcomeReason, 'issued' | 'notFound' | 'notCommitted']>([
    ['UNABLE_TO_RETRIEVE_TICKETS', 'issued'],
    ['FULFILLMENT_NOT_CONFIRMED', 'notFound'],
    ['INTERNAL_SERVER_TIMEOUT', 'issued'],
    ['DOWNLINE_SERVICE_ERROR', 'notFound'],
    ['PAYMENT_CARD_ISSUE', 'notFound'],
    ['TRANSPORT', 'issued'],
    ['GATEWAY_5XX', 'issued'],
    ['UNPARSEABLE', 'issued'],
    ['ABORTED', 'issued'],
  ])('%s forzado lanza incierto, y verify da %s', async (reason, verified) => {
    const { sabre } = client({ bookings: { ABCDEF: {} }, ticketing: { fulfill: [{ uncertain: reason as never }] } });
    const thrown = await rejection(sabre.tickets.fulfill(fulfillRequest('ABCDEF')));

    expect(thrown).toBeInstanceOf(SabreUncertainOutcomeError);
    expect((thrown as SabreUncertainOutcomeError).reason).toBe(reason);
    expect((await sabre.tickets.verify({ confirmationId: 'ABCDEF' })).status).toBe(verified);
  });

  it('NOT_COMMITTED trae el boleto, que no aparece en el PNR: verify con expectedTickets da notCommitted', async () => {
    const { sabre } = client({ bookings: { ABCDEF: {} }, ticketing: { fulfill: [{ uncertain: 'NOT_COMMITTED' }] } });
    const thrown = (await rejection(sabre.tickets.fulfill(fulfillRequest('ABCDEF')))) as SabreUncertainOutcomeError;

    expect(thrown.reason).toBe('NOT_COMMITTED');
    expect(thrown.tickets).toHaveLength(1);
    const expectedTickets = thrown.tickets.map((ticket) => ticket.number);
    await expect(sabre.tickets.verify({ confirmationId: 'ABCDEF', expectedTickets })).resolves.toMatchObject({ status: 'notCommitted', missing: expectedTickets });
  });

  it('issued: false deja la reserva sin emitir aunque la reason suela emitir', async () => {
    const { sabre } = client({ bookings: { ABCDEF: {} }, ticketing: { fulfill: [{ uncertain: 'GATEWAY_5XX', issued: false }] } });
    await rejection(sabre.tickets.fulfill(fulfillRequest('ABCDEF')));
    await expect(sabre.tickets.verify({ confirmationId: 'ABCDEF' })).resolves.toMatchObject({ status: 'notFound' });
  });

  it.each([
    ['INVALID_TICKET_STOCK', 'INVALID TICKET STOCK-0096'],
    ['COMMISSION_REQUIRED', 'COMMISSION REQUIRED-0260'],
    ['HARDCOPY_PRINTER', 'USE PTR/-0052'],
    ['SECURE_FLIGHT', 'PASSENGER SECURITY DATA REQUIRED PLEASE UPDATE AND RETRY-1829'],
  ] as const)('el DOWNLINE_SERVICE_ERROR de CERT %s, con su texto', async (downline, textPart) => {
    const { sabre } = client({ bookings: { ABCDEF: {} }, ticketing: { fulfill: [{ downline }] } });
    const thrown = (await rejection(sabre.tickets.fulfill(fulfillRequest('ABCDEF')))) as SabreUncertainOutcomeError;

    expect(thrown.reason).toBe('DOWNLINE_SERVICE_ERROR');
    expect(thrown.message).toContain(textPart);
  });

  it('un error del catálogo forzado sale como SabreBusinessError', async () => {
    const { sabre } = client({ bookings: { ABCDEF: {} }, ticketing: { fulfill: [{ error: 'PRICE_MISMATCH' }] } });
    await expect(sabre.tickets.fulfill(fulfillRequest('ABCDEF'))).rejects.toMatchObject({ name: 'SabreBusinessError', code: 'PRICE_MISMATCH' });
  });

  it('los desenlaces se consumen en orden y después vuelve el normal', async () => {
    const { sabre } = client({ bookings: { ABCDEF: {} }, ticketing: { fulfill: [{ downline: 'COMMISSION_REQUIRED' }] } });
    await rejection(sabre.tickets.fulfill(fulfillRequest('ABCDEF')));
    await expect(sabre.tickets.fulfill(fulfillRequest('ABCDEF'))).resolves.toMatchObject({ status: 'issued' });
  });
});

describe('booking.cancel con VOID: desenlaces forzados', () => {
  it.each(['END_TRANSACTION_PROBLEM', 'TRANSPORT', 'GATEWAY_5XX', 'UNPARSEABLE', 'ABORTED'] as const)('%s lanza incierto, y por defecto el void se hizo', async (reason) => {
    const { sabre } = client({ bookings: { ABCDEF: { tickets: [{ number: '0010000000001' }] } }, ticketing: { void: [{ uncertain: reason }] } });
    const thrown = await rejection(sabre.booking.cancel(voidAll('ABCDEF')));

    expect(thrown).toMatchObject({ name: 'SabreUncertainOutcomeError', reason, operation: 'booking.cancel' });
    await expect(sabre.tickets.verify({ confirmationId: 'ABCDEF' })).resolves.toMatchObject({ status: 'notFound' });
  });

  it('voided: false deja el boleto vigente', async () => {
    const { sabre } = client({ bookings: { ABCDEF: { tickets: [{ number: '0010000000001' }] } }, ticketing: { void: [{ uncertain: 'GATEWAY_5XX', voided: false }] } });
    await rejection(sabre.booking.cancel(voidAll('ABCDEF')));
    await expect(sabre.tickets.verify({ confirmationId: 'ABCDEF' })).resolves.toMatchObject({ status: 'issued' });
  });
});

describe('siembra inválida', () => {
  it.each([
    [{ bookings: { abc: {} } }, 'localizador'],
    [{ bookings: { ABCDEF: { flights: -1 } } }, 'flights'],
    [{ bookings: { ABCDEF: { tickets: [{ number: '12' }] } } }, 'number'],
    [{ bookings: { ABCDEF: { tickets: [{ number: '0010000000001', ticketStatusCode: 'RF' }] } } }, 'ticketStatusCode'],
    [{ ticketing: { fulfill: ['maybe'] } }, 'ticketing.fulfill[0]'],
    [{ ticketing: { fulfill: [{ uncertain: 'END_TRANSACTION_PROBLEM' }] } }, 'uncertain'],
    [{ ticketing: { fulfill: [{ downline: 'X' }] } }, 'downline'],
    [{ ticketing: { void: [{ uncertain: 'NOT_COMMITTED' }] } }, 'ticketing.void[0]'],
  ])('%j falla al crear el fake', (options, message) => {
    expect(() => createQueueFake(options as never)).toThrow(message);
  });
});
