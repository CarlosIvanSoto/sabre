// El fake de sabre-client/testing con reporting.dailySalesSummary (#225, ADR-030).
import { describe, expect, it } from 'vitest';
import { type DailySalesTransaction, SabreBusinessError, SabreLegacy } from '../src/index.js';
import { createQueueFake, type QueueFakeOptions } from '../src/testing/index.js';
import { rejection } from './soap-helpers.js';

const NOW = new Date('2026-11-12T17:14:00Z');

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

const sale = (documentNumber: string, overrides: Partial<DailySalesTransaction> = {}): DailySalesTransaction => ({
  documentType: 'TKT',
  transactionCode: 'SALE',
  settlementType: 'TKT',
  pnrLocator: 'AAAAAA',
  passengerName: 'PASAJERO/UNO',
  documentNumber,
  stockType: 'MX',
  airline: { code: 'AM', number: '139' },
  commission: { amount: '100.00', percent: '1.0' },
  payments: { currencyCode: 'MXN', total: '100.00', details: [{ fop: 'CA', category: 'Cash', amount: '100.00' }] },
  agentSine: 'AAA',
  agentPseudoCity: 'P8X1',
  transactionDateTime: '2026-11-12T11:02:00.000',
  electronicDocument: true,
  nonInteractive: false,
  itineraryType: 'D',
  ...overrides,
});
const refund = sale('1390000000009', { documentType: 'RFD', transactionCode: 'RFND', documentStatusCode: 'N', automatedRefund: false });

describe('reporting.dailySalesSummary contra el fake', () => {
  it('devuelve lo sembrado tal cual lo lee el SDK, para el PCC y la fecha pedidos', async () => {
    const { fake, legacy } = client({ dailySales: { P8X1: { '2026-11-11': [sale('1390000000001'), refund] } } });
    const result = await legacy.withSession((session) => session.reporting.dailySalesSummary({ pcc: 'P8X1', date: '2026-11-11' }));

    expect(result).toMatchObject({ status: 'complete', pcc: 'P8X1', reportDate: '2026-11-11', totals: [] });
    expect(result.transactions).toEqual([sale('1390000000001'), refund]);
    expect(fake.calls.filter((call) => call.command === 'dailySalesSummary')).toEqual([{ command: 'dailySalesSummary', pcc: 'P8X1', date: '2026-11-11' }]);
  });

  it('sin date da el día de now(); sin pcc, el de la sesión', async () => {
    const { legacy } = client({ dailySales: { ABCD: { '2026-11-12': [sale('1390000000001')] }, P8X1: { '2026-11-12': [sale('1390000000002')] } } });
    const result = await legacy.withSession((session) => session.reporting.dailySalesSummary());

    expect(result.pcc).toBe('ABCD');
    expect(result.reportDate).toBe('2026-11-12');
    expect(result.transactions.map((t) => t.documentNumber)).toEqual(['1390000000001']);
  });

  it('un PCC o un día sin sembrar da un reporte complete vacío', async () => {
    const { legacy } = client({ dailySales: { P8X1: { '2026-11-12': [sale('1390000000001')] } } });
    const [otherPcc, otherDay] = await legacy.withSession(async (session) => [
      await session.reporting.dailySalesSummary({ pcc: 'ZZ99' }),
      await session.reporting.dailySalesSummary({ pcc: 'P8X1', date: '2026-11-10' }),
    ]);

    expect(otherPcc).toMatchObject({ status: 'complete', pcc: 'ZZ99', transactions: [] });
    expect(otherDay).toMatchObject({ status: 'complete', transactions: [] });
  });

  it('documentType filtra; RFND trae las RFD', async () => {
    const { legacy } = client({ dailySales: { P8X1: { '2026-11-12': [sale('1390000000001'), refund] } } });
    const refunds = await legacy.withSession((session) => session.reporting.dailySalesSummary({ pcc: 'P8X1', documentType: 'RFND' }));

    expect(refunds.transactions.map((t) => t.documentType)).toEqual(['RFD']);
  });

  it('incomplete forzado: los documentos fallidos', async () => {
    const { legacy } = client({
      dailySales: { P8X1: { '2026-11-12': { transactions: [sale('1390000000001')], status: 'incomplete', failedDocuments: ['1390000000002', '1390000000003'] } } },
    });
    const result = await legacy.withSession((session) => session.reporting.dailySalesSummary({ pcc: 'P8X1' }));

    expect(result.status).toBe('incomplete');
    expect(result.failedDocuments).toEqual(['1390000000002', '1390000000003']);
    expect(result.transactions).toHaveLength(1);
  });

  it('deferred forzado: reportId y chunks, con valores por defecto', async () => {
    const { legacy } = client({
      dailySales: {
        P8X1: { '2026-11-12': { transactions: [], status: 'deferred', deferred: { chunkNumber: 1, maxChunks: 2 } }, '2026-11-11': { transactions: [], status: 'deferred' } },
      },
    });
    const [today, yesterday] = await legacy.withSession(async (session) => [
      await session.reporting.dailySalesSummary({ pcc: 'P8X1' }),
      await session.reporting.dailySalesSummary({ pcc: 'P8X1', date: '2026-11-11' }),
    ]);

    expect(today.status).toBe('deferred');
    expect(today.deferred).toEqual({ reportId: 'FAKE-REPORT', chunkNumber: 1, maxChunks: 2, queryStillRunning: true });
    expect(yesterday.deferred).toEqual({ reportId: 'FAKE-REPORT', queryStillRunning: true });
  });

  it.each([['45100'], ['21212']])('el error %s forzado es un SabreBusinessError de dailySalesSummary', async (errorCode) => {
    const { legacy } = client({ dailySales: { P8X1: { '2026-11-12': { transactions: [], errorCode } } } });
    const error = await rejection(legacy.withSession((session) => session.reporting.dailySalesSummary({ pcc: 'P8X1' })));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'dailySalesSummary', code: errorCode });
  });

  it.each([
    [{ p8x1: {} }, 'PCC'],
    [{ P8X1: { '12NOV': [] } }, 'YYYY-MM-DD'],
    [{ P8X1: { '2026-11-12': { transactions: 'x' } } }, 'lista de transacciones'],
    [{ P8X1: { '2026-11-12': { transactions: [], status: 'late' } } }, 'status'],
    [{ P8X1: { '2026-11-12': [{ documentType: 'TKT' }] } }, 'transactionCode'],
  ])('una siembra inválida (%j) falla al crear el fake', (dailySales, message) => {
    expect(() => createQueueFake({ dailySales: dailySales as never })).toThrow(message);
  });
});
