// La fixture del «Summary» del DQB (#223, ADR-030): qué trae y que no quede ningún dato real.
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/reporting.production-daily-sales-summary.json';

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
