// La fixture del «Summary» del DQB (#223, ADR-030): qué trae y que no quede ningún dato real.
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/reporting.production-daily-sales-summary.json';
import voidFixture from './fixtures/reporting.sandbox-daily-sales-void.json';

const texts = (body: string, name: string): string[] =>
  [...body.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([^<]*)<`, 'g'))].map((match) => match[1] ?? '');

const bodies = fixture.responses.map((response) => response.body);
const all = (name: string): string[] => bodies.flatMap((body) => texts(body, name));

describe('fixture reporting.production-daily-sales-summary', () => {
  it('trae el día en curso y el anterior, completos', () => {
    expect(fixture.responses.map((response) => response.label)).toEqual(['today', 'previousDay']);
    for (const body of bodies) {
      expect(body).toContain('DailySalesSummaryRS');
      expect(body).toContain('isQueryStillRunning="false"');
      expect(body).not.toMatch(/status="Incomplete"/);
    }
  });

  it('cubre boletos, EMD y reembolsos, con y sin DocumentStatusCode', () => {
    expect(new Set(all('DocumentType'))).toEqual(new Set(['TKT', 'EMD', 'RFD']));
    expect(new Set(all('TransactionCode'))).toEqual(new Set(['SALE', 'RFND']));
    const transactions = bodies.flatMap((body) => [...body.matchAll(/<(?:[\w-]+:)?Transaction\b[\s\S]*?<\/(?:[\w-]+:)?Transaction>/g)]);
    expect(transactions).toHaveLength(18);
    expect(all('DocumentStatusCode').length).toBeGreaterThan(0);
    expect(all('DocumentStatusCode').length).toBeLessThan(transactions.length);
  });

  it('no trae localizadores, nombres, boletos, importes, firmas ni PCC reales', () => {
    for (const locator of all('PnrLocator')) expect(locator).toMatch(/^AAA[A-Z]{3}$/);
    for (const name of all('PassengerName')) expect(name).toMatch(/^PASAJERO\/[A-Z0-9]+$/);
    for (const document of all('DocumentNumber')) expect(document).toMatch(/^\d{3}0{3,}\d{1,7}$/);
    for (const name of ['Amount', 'PaymentTotal', 'PaymentAmount']) for (const amount of all(name)) expect(amount).toMatch(/^100(\.0+)?$/);
    for (const name of ['CashTotals', 'CreditTotals', 'CommissionTotals']) for (const amount of all(name)) expect(amount).toMatch(/^1000(\.0+)?$/);
    for (const sine of all('AgentSine')) expect(sine).toBe('AAA');
    for (const pcc of [...all('AgentPseudoCity'), ...all('PseudoCityCode'), ...all('CPAId')]) expect(pcc).toBe('XXXX');
    expect(new Set(all('AgencyName'))).toEqual(new Set(['AGENCIA']));
    for (const body of bodies) expect(body).not.toMatch(/BinarySecurityToken[^>]*>(?!\[REDACTED\])[^<]+</);
  });
});

describe('fixture reporting.sandbox-daily-sales-void (#243)', () => {
  const voidBodies = voidFixture.responses.map((response) => response.body);
  const voidAll = (name: string): string[] => voidBodies.flatMap((body) => texts(body, name));

  it('trae dos días de CERT, completos, con un SALE anulado cada uno y sin totales', () => {
    expect(voidFixture.environment).toBe('sandbox');
    expect(voidFixture.responses.map((response) => response.label)).toEqual(['2026-11-12', '2026-11-13']);
    for (const body of voidBodies) {
      expect(body).toContain('isQueryStillRunning="false"');
      expect(body).not.toMatch(/status="Incomplete"/);
      expect(body).not.toMatch(/SaleTotals/);
    }
    expect(voidAll('TransactionCode')).toEqual(['SALE', 'SALE']);
    expect(voidAll('DocumentStatusCode')).toEqual(['V', 'V']);
  });

  it('no trae localizadores, nombres, boletos, importes, firmas ni PCC reales', () => {
    for (const locator of voidAll('PnrLocator')) expect(locator).toMatch(/^AAA[A-Z]{3}$/);
    for (const name of voidAll('PassengerName')) expect(name).toMatch(/^PASAJERO\/[A-Z0-9]+$/);
    for (const document of voidAll('DocumentNumber')) expect(document).toMatch(/^\d{3}0{3,}\d{1,7}$/);
    for (const name of ['Amount', 'PaymentTotal', 'PaymentAmount']) for (const amount of voidAll(name)) expect(amount).toMatch(/^100(\.0+)?$/);
    for (const sine of voidAll('AgentSine')) expect(sine).toBe('AAA');
    for (const pcc of [...voidAll('AgentPseudoCity'), ...voidAll('PseudoCityCode'), ...voidAll('CPAId')]) expect(pcc).toBe('XXXX');
    expect(new Set(voidAll('AgencyName'))).toEqual(new Set(['AGENCIA']));
    for (const body of voidBodies) expect(body).not.toMatch(/BinarySecurityToken[^>]*>(?!\[REDACTED\])[^<]+</);
  });
});
