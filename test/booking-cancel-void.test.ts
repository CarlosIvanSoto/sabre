// booking.cancel con flightTicketOperation VOID (#236, ADR-031, sección 6), contra las respuestas
// grabadas en CERT (#231).
import { describe, expect, it, vi } from 'vitest';
import { type CancelBookingRequest, Sabre, SabreBusinessError, SabreGatewayError, SabreUncertainOutcomeError } from '../src/index.js';
import voided from './fixtures/w4.sandbox-void-by-cancel-cancel-void.json';
import withoutTickets from './fixtures/w4.sandbox-cancel-void-without-tickets.json';
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

const serviceCalls = (fetch: ReturnType<typeof router>) => fetch.mock.calls.filter(([url]) => !String(url).includes('/auth/token'));
const cancel = (fetch: ReturnType<typeof router>, request: CancelBookingRequest, options = {}) => new Sabre(config({ fetch })).booking.cancel(request, options);

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.fail('se esperaba un error'),
    (error: unknown) => error,
  );
}

const voidAll: CancelBookingRequest = { confirmationId: 'ABCDEF', targetPcc: 'P8X1', cancelAll: true, flightTicketOperation: 'VOID', retrieveBooking: true };
const pending = { category: 'WARNING', type: 'END_TRANSACTION_PROBLEM', description: 'Confirmation is pending. Redisplay the booking' };

describe('booking.cancel con VOID (CERT, 2026-11-13)', () => {
  it('el void grabado anula y cancela en una llamada: voidedTickets como lista de números', async () => {
    const fetch = router([json(voided.cancelVoid.response.status, voided.cancelVoid.response.body)]);
    const result = await cancel(fetch, voidAll);

    expect(result.voidedTickets).toEqual(['0060000000001']);
    expect(result.warnings).toEqual([]);
    expect(result.request).toMatchObject({ errorHandlingPolicy: 'HALT_ON_ERROR', flightTicketOperation: 'VOID' });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('VOID sin boletos: NO_ITEMS_CANCELLED con UNABLE_TO_VOID_TICKET, y no se canceló nada', async () => {
    const thrown = await rejection(cancel(router([json(withoutTickets.void.response.status, withoutTickets.void.response.body)]), voidAll));

    expect(thrown).toBeInstanceOf(SabreBusinessError);
    expect(thrown).toMatchObject({ code: 'NO_ITEMS_CANCELLED', retryable: false });
    expect((thrown as SabreBusinessError).errors.map((error) => error.code)).toEqual(['UNABLE_TO_VOID_TICKET']);
  });
});

describe('booking.cancel con VOID: incierto (ADR-031)', () => {
  it('END_TRANSACTION_PROBLEM con VOID lanza incierto, con los boletos anulados que vinieron', async () => {
    const thrown = (await rejection(cancel(router([json(200, { voidedTickets: ['0060000000001'], errors: [pending] })]), voidAll))) as SabreUncertainOutcomeError;

    expect(thrown).toBeInstanceOf(SabreUncertainOutcomeError);
    expect(thrown).toMatchObject({ reason: 'END_TRANSACTION_PROBLEM', operation: 'booking.cancel', confirmationId: 'ABCDEF', retryable: false });
    expect(thrown.tickets).toEqual([{ number: '0060000000001' }]);
    expect(thrown.warnings.map((warning) => warning.code)).toEqual(['END_TRANSACTION_PROBLEM']);
  });

  it('sin VOID, END_TRANSACTION_PROBLEM sigue siendo un aviso', async () => {
    const result = await cancel(router([json(200, { errors: [pending] })]), { confirmationId: 'ABCDEF', cancelAll: true });
    expect(result.warnings.map((warning) => warning.code)).toEqual(['END_TRANSACTION_PROBLEM']);
  });

  it('un fallo de red con el void mandado da TRANSPORT, sin reintento', async () => {
    const fetch = router([new TypeError('fetch failed')]);
    const thrown = await rejection(cancel(fetch, voidAll));

    expect(thrown).toMatchObject({ name: 'SabreUncertainOutcomeError', reason: 'TRANSPORT', operation: 'booking.cancel' });
    expect(serviceCalls(fetch)).toHaveLength(1);
  });

  it('un 503 da GATEWAY_5XX con VOID, y sin VOID sale como SabreGatewayError', async () => {
    await expect(cancel(router([json(503, {})]), voidAll)).rejects.toMatchObject({ reason: 'GATEWAY_5XX' });
    const plain = await rejection(cancel(router([json(503, {})]), { confirmationId: 'ABCDEF', cancelAll: true }));
    expect(plain).toBeInstanceOf(SabreGatewayError);
    expect(plain).not.toBeInstanceOf(SabreUncertainOutcomeError);
  });

  it('un 2xx que no es JSON da UNPARSEABLE', async () => {
    await expect(cancel(router([new Response('oops', { status: 200 })]), voidAll)).rejects.toMatchObject({ reason: 'UNPARSEABLE' });
  });

  it('un abort con el void mandado da ABORTED; el onRawRequest del consumidor se sigue llamando', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const operations: string[] = [];
    const thrown = await rejection(cancel(router([abort]), voidAll, { onRawRequest: (raw: { operation: string }) => operations.push(raw.operation) }));

    expect(thrown).toMatchObject({ reason: 'ABORTED' });
    expect((thrown as Error).cause).toBe(abort);
    expect(operations).toEqual(['booking.cancel']);
  });
});
