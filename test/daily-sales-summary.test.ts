// session.reporting.dailySalesSummary (#224, ADR-030) contra la fixture de producción de P8
// (#223, 2026-11-12) y sobres armados desde el design 1.2.2 y la guía v4.
import { describe, expect, it } from 'vitest';
import { SabreBusinessError, type SabreRawResponse } from '../src/index.js';
import { dailySalesSummaryPayload } from '../src/reporting/daily-sales-summary.js';
import fixture from './fixtures/reporting.production-daily-sales-summary.json';
import voidFixture from './fixtures/reporting.sandbox-daily-sales-void.json';
import { mockFetch } from './helpers.js';
import { legacyClient, rejection, sentBody, sentTag, sessionOpened, soap, xml } from './soap-helpers.js';

const ASR = 'xmlns:asr="http://www.sabre.com/ns/Ticketing/AsrServices/1.0"';
const STL = 'xmlns:stl="http://services.sabre.com/STL/v01"';

const recorded = (label: 'today' | 'previousDay') => {
  const response = fixture.responses.find((r) => r.label === label);
  if (response === undefined) throw new Error(`la fixture no tiene ${label}`);
  return xml(response.status, response.body);
};

/** Un `DailySalesSummaryRS` armado: atributos de la raíz, `Header` y el resto del cuerpo. */
const summaryRS = (attributes: string, header: string, body = '') =>
  soap(`<asr:DailySalesSummaryRS ${ASR} ${STL} version="1.2.2" ${attributes}><asr:Header>${header}</asr:Header>${body}</asr:DailySalesSummaryRS>`);
const success = '<stl:Results><stl:Success><stl:System>T2-ASR</stl:System></stl:Success></stl:Results>';
const errorResults = (attributes: string, code: string, message: string) =>
  `<stl:Results><stl:Error ${attributes}><stl:System>T2-ASR</stl:System><stl:ErrorCode>${code}</stl:ErrorCode><stl:Message>${message}</stl:Message></stl:Error></stl:Results>`;
const oneTransaction = `<asr:DSHeader><asr:PseudoCityCode>ABCD</asr:PseudoCityCode></asr:DSHeader><asr:DailySalesReport><asr:ReportDate>2026-11-12</asr:ReportDate><asr:Transaction><asr:DocumentType>TKT</asr:DocumentType><asr:SettlementType>TKT</asr:SettlementType><asr:DocumentDetails><asr:DocumentNumber>1390000000001</asr:DocumentNumber><asr:TransactionCode>SALE</asr:TransactionCode></asr:DocumentDetails><asr:AirlineCode AirlineNumber="139">AM</asr:AirlineCode><asr:AgentSine>AAA</asr:AgentSine><asr:TransactionDateTime>2026-11-12T10:00:00.000</asr:TransactionDateTime></asr:Transaction></asr:DailySalesReport>`;

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const session = await legacyClient(fetch).client.openSession();
  return { fetch, session };
}

describe('reporting.dailySalesSummary: request', () => {
  it('sin filtros manda TKT_TravelAgencyReportsRQ con el día en curso, sin caché y 25 s', async () => {
    const { fetch, session } = await openWith(recorded('today'));
    await session.reporting.dailySalesSummary();

    const envelope = sentBody(fetch, 1);
    expect(sentTag(envelope, 'eb:Service')).toBe('TKT_TravelAgencyReportsRQ');
    expect(sentTag(envelope, 'eb:Action')).toBe('TKT_TravelAgencyReportsRQ');
    expect(envelope).toContain(
      '<DailySalesSummaryRQ xmlns="http://www.sabre.com/ns/Ticketing/AsrServices/1.0" version="1.2.2"><Header/><SelectionCriteria isCacheLateLargeReports="false" clientTimeoutSecs="25"></SelectionCriteria></DailySalesSummaryRQ>',
    );
  });

  it('con todos los filtros, en el orden del design y DocumentNumber con su nombre', () => {
    expect(
      dailySalesSummaryPayload({
        pcc: 'P8X1',
        date: '2026-11-11',
        documentType: 'RFND',
        settlementType: 'TKT',
        airline: { code: 'AM', number: '139' },
        documentNumber: '1390000000001',
      }),
    ).toContain(
      '<SelectionCriteria isCacheLateLargeReports="false" clientTimeoutSecs="25"><PseudoCityCode>P8X1</PseudoCityCode><Airline><AirlineCode>AM</AirlineCode><AirlineNumber>139</AirlineNumber></Airline><ReportDate>2026-11-11</ReportDate><SettlementType>TKT</SettlementType><DocumentType>RFND</DocumentType><DocumentNumber>1390000000001</DocumentNumber></SelectionCriteria>',
    );
  });

  it.each([
    [{ pcc: 'p8' }, 'pcc'],
    [{ date: '12NOV' }, 'date'],
    [{ date: '2026-13-45' }, 'date'],
    [{ documentType: 'RFD' }, 'documentType'],
    [{ settlementType: 'BSP' }, 'settlementType'],
    [{ airline: {} }, 'airline'],
    [{ airline: { code: 'AMX' } }, 'airline.code'],
    [{ airline: { number: '13' } }, 'airline.number'],
    [{ documentNumber: 'ABC' }, 'documentNumber'],
  ])('un filtro inválido (%j) lanza TypeError sin red', async (request, field) => {
    const { fetch, session } = await openWith();
    const error = await rejection(session.reporting.dailySalesSummary(request as never));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain(field);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('reporting.dailySalesSummary: respuesta de producción (P8, 2026-11-12)', () => {
  it('el día en curso: complete, con ventas, EMD y reembolsos', async () => {
    const { session } = await openWith(recorded('today'));
    const result = await session.reporting.dailySalesSummary();

    expect(result.status).toBe('complete');
    expect(result.pcc).toBe('XXXX');
    expect(result.agencyName).toBe('AGENCIA');
    expect(result.reportDate).toBe('2026-11-12');
    expect(result.failedDocuments).toBeUndefined();
    expect(result.deferred).toBeUndefined();
    expect(result.transactions).toHaveLength(10);
    const count = (key: 'documentType' | 'transactionCode') =>
      result.transactions.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t[key]]: (acc[t[key]] ?? 0) + 1 }), {});
    expect(count('documentType')).toEqual({ TKT: 6, EMD: 1, RFD: 3 });
    expect(count('transactionCode')).toEqual({ SALE: 7, RFND: 3 });
    expect(result.transactions.filter((t) => t.documentStatusCode === 'N')).toHaveLength(3);
    expect(result.transactions.every((t) => t.pnrLocator !== undefined && t.settlementType === 'TKT')).toBe(true);
  });

  it('una venta: horas tal como vienen, importes como string y banderas como boolean', async () => {
    const { session } = await openWith(recorded('today'));
    const [sale] = (await session.reporting.dailySalesSummary()).transactions;

    expect(sale).toEqual({
      documentType: 'TKT',
      transactionCode: 'SALE',
      settlementType: 'TKT',
      pnrLocator: 'AAAAAA',
      passengerName: 'PASAJERO/UNO',
      documentNumber: '1390000000001',
      stockType: 'MX',
      airline: { code: 'AM', number: '139' },
      commission: { amount: '100.00', percent: '1.0' },
      payments: { currencyCode: 'MXN', total: '100.00', details: [{ fop: 'CA', category: 'Cash', amount: '100.00' }] },
      agentSine: 'AAA',
      agentPseudoCity: 'XXXX',
      transactionDateTime: '2026-11-12T11:02:00.000',
      electronicDocument: true,
      nonInteractive: false,
      itineraryType: 'D',
    });
  });

  it('un reembolso: RFD con RFND y automatedRefund', async () => {
    const { session } = await openWith(recorded('today'));
    const refund = (await session.reporting.dailySalesSummary()).transactions.find((t) => t.documentType === 'RFD');

    expect(refund?.transactionCode).toBe('RFND');
    expect(typeof refund?.automatedRefund).toBe('boolean');
  });

  it('los totales por tipo de transacción y settlement, con su count', async () => {
    const { session } = await openWith(recorded('today'));
    const { totals } = await session.reporting.dailySalesSummary();

    expect(totals.length).toBeGreaterThan(0);
    for (const total of totals) {
      expect(total.settlementType).toBe('TKT');
      expect(total.currencyCode).toBe('MXN');
      expect(total.cash?.amount).toMatch(/^1000(\.0+)?$/);
      expect(typeof total.cash?.count).toBe('number');
    }
  });

  it('el día anterior, con un DocumentStatusCode A', async () => {
    const { session } = await openWith(recorded('previousDay'));
    const result = await session.reporting.dailySalesSummary({ date: '2026-11-11' });

    expect(result.status).toBe('complete');
    expect(result.reportDate).toBe('2026-11-11');
    expect(result.transactions).toHaveLength(8);
    expect(result.transactions.filter((t) => t.documentStatusCode === 'A')).toHaveLength(1);
  });

  it('la respuesta cruda llega por onRawResponse', async () => {
    const raws: SabreRawResponse[] = [];
    const { session } = await openWith(recorded('today'));
    await session.reporting.dailySalesSummary({}, { onRawResponse: (raw) => raws.push(raw) });

    expect(raws).toHaveLength(1);
    expect(raws[0]?.operation).toBe('reporting.dailySalesSummary');
    expect(String(raws[0]?.body)).toContain('DailySalesSummaryRS');
  });
});

describe('reporting.dailySalesSummary: un void en CERT (#243, Q-122)', () => {
  const recordedVoid = (date: string) => {
    const response = voidFixture.responses.find((r) => r.label === date);
    if (response === undefined) throw new Error(`la fixture no tiene ${date}`);
    return xml(response.status, response.body);
  };

  it.each([
    ['2026-11-12', '0060000000001'],
    ['2026-11-13', '0060000000002'],
  ])('el %s: el boleto anulado sigue como SALE con documentStatusCode V y no suma en totals', async (date, documentNumber) => {
    const { session } = await openWith(recordedVoid(date));
    const result = await session.reporting.dailySalesSummary({ date });

    expect(result.status).toBe('complete');
    expect(result.reportDate).toBe(date);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      documentType: 'TKT',
      transactionCode: 'SALE',
      documentStatusCode: 'V',
      documentNumber,
      payments: { currencyCode: expect.any(String), total: '100.00' },
    });
    expect(result.transactions.some((t) => t.transactionCode !== 'SALE')).toBe(false);
    expect(result.totals).toEqual([]);
  });
});

describe('reporting.dailySalesSummary: estados y errores (design 1.2.2 y guía v4)', () => {
  it('sin transacciones: complete, con listas vacías y el PCC del request', async () => {
    const { session } = await openWith(xml(200, summaryRS('isQueryStillRunning="false"', success)));
    const result = await session.reporting.dailySalesSummary({ pcc: 'P8X1' });

    expect(result).toMatchObject({ status: 'complete', pcc: 'P8X1', transactions: [], totals: [] });
  });

  it('Error status="Incomplete": incomplete, con los documentos fallidos y sin lanzar', async () => {
    const results = errorResults('type="Application" status="Incomplete"', '0', 'The following are the failed transactions : [1390000000002, 1390000000003]');
    const { session } = await openWith(xml(200, summaryRS('isQueryStillRunning="false"', results, oneTransaction)));
    const result = await session.reporting.dailySalesSummary();

    expect(result.status).toBe('incomplete');
    expect(result.failedDocuments).toEqual(['1390000000002', '1390000000003']);
    expect(result.transactions).toHaveLength(1);
  });

  it('isQueryStillRunning o reportId: deferred, con el reportId y los chunks', async () => {
    const { session } = await openWith(xml(200, summaryRS('isQueryStillRunning="true" reportId="R-1" chunkNumber="1" maxChunks="3"', success)));
    const result = await session.reporting.dailySalesSummary();

    expect(result.status).toBe('deferred');
    expect(result.deferred).toEqual({ reportId: 'R-1', chunkNumber: 1, maxChunks: 3, queryStillRunning: true });
  });

  it.each([
    ['45100', 'Request security validation failed: Agent is not authorized to access the requested location'],
    ['21212', 'Invalid version'],
  ])('el error %s lanza SabreBusinessError de dailySalesSummary, sin reintentos', async (code, message) => {
    const { fetch, session } = await openWith(xml(200, summaryRS('', errorResults('type="BusinessLogic" status="NotProcessed"', code, message))));
    const error = await rejection(session.reporting.dailySalesSummary({ pcc: 'ZZ99' }));

    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'dailySalesSummary', code, retryable: false });
    expect((error as Error).message).toContain(message);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
