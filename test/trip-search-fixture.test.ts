// Las fixtures de Search For Itineraries (#249, ADR-033): qué traen y que no quede ningún dato real.
import { describe, expect, it } from 'vitest';
import cert from './fixtures/trip-search.sandbox-cert1.json';
import synthetic from './fixtures/trip-search.synthetic-guide.json';

const attribute = (body: string, element: string, name: string): string | undefined =>
  new RegExp(`<(?:[\\w-]+:)?${element}\\b[^>]*\\b${name}="([^"]*)"`).exec(body)?.[1];
const locators = (body: string): string[] => [...body.matchAll(/<(?:[\w-]+:)?Reservation\b[^>]*\bLocator="([^"]*)"/g)].map((match) => match[1] ?? '');
const headerTimestamp = (body: string): string | undefined => /<eb:Timestamp>([^<]*)</.exec(body)?.[1];
const minutesBetween = (local: string, utc: string): number => (Date.parse(`${local}Z`) - Date.parse(`${utc}Z`)) / 60_000;

const bodyOf = (fixture: { responses: { label: string; body: string }[] }, label: string): string => {
  const response = fixture.responses.find((candidate) => candidate.label === label);
  if (response === undefined) throw new Error(`falta el sobre ${label}`);
  return response.body;
};

function expectAnonymous(bodies: string[]): void {
  for (const body of bodies) {
    for (const locator of locators(body)) expect(locator).toMatch(/^AAA[A-Z]{3}$/);
    expect(/<eb:CPAId>([^<]*)</.exec(body)?.[1]).toBe('XXXX');
    expect(body).not.toMatch(/BinarySecurityToken[^>]*>(?!\[REDACTED\])[^<]+</);
    expect(body).not.toMatch(/<Pcc>|PseudoCityCode>(?!XXXX)/);
  }
}

describe('fixture trip-search.sandbox-cert1', () => {
  const bodies = cert.responses.map((response) => response.body);

  it('trae una ventana con el PNR de prueba, una vacía, una con dos y una de 30 días', () => {
    expect(cert.environment).toBe('sandbox');
    expect(cert.responses.map((response) => response.label)).toEqual(['one', 'empty', 'two', 'wide']);
    const counts = cert.responses.map(({ body }) => ({
      numberResults: attribute(body, 'ReservationsList', 'NumberResults'),
      numberPages: attribute(body, 'ReservationsList', 'NumberPages'),
      totalResults: attribute(body, 'ReservationsList', 'TotalResults'),
      reservations: locators(body).length,
    }));
    expect(counts).toEqual([
      { numberResults: '1', numberPages: '1', totalResults: '1', reservations: 1 },
      { numberResults: '0', numberPages: '1', totalResults: '0', reservations: 0 },
      { numberResults: '2', numberPages: '1', totalResults: '2', reservations: 2 },
      { numberResults: '26', numberPages: '1', totalResults: '26', reservations: 26 },
    ]);
    expect(locators(bodyOf(cert, 'one'))).toEqual(['AAAAAA']);
    expect(locators(bodyOf(cert, 'two'))).toContain('AAAAAA');
    expect(new Set(locators(bodyOf(cert, 'wide'))).size).toBe(26);
  });

  it('trae el TimeStamp local de la raíz (UTC-6) junto a eb:Timestamp, en UTC y sin zona', () => {
    for (const body of bodies) {
      const local = attribute(body, 'Trip_SearchRS', 'TimeStamp');
      const utc = headerTimestamp(body);
      expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      // Puede haber un segundo de diferencia entre los dos relojes.
      expect(Math.round(minutesBetween(local!, utc!))).toBe(-360);
    }
    expect(bodies.every((body) => /<Success>Success<\/Success>/.test(body))).toBe(true);
  });

  it('no trae localizadores, PCC ni tokens reales', () => {
    expectAnonymous(bodies);
  });
});

describe('fixture trip-search.synthetic-guide', () => {
  const bodies = synthetic.responses.map((response) => response.body);

  it('cada sobre dice de dónde sale y que no se vio en Sabre', () => {
    expect(synthetic.environment).toBe('synthetic');
    for (const response of synthetic.responses) {
      expect(response.source).toMatch(/guía|Guide|design|Design|Sobre real/);
      expect(response.source).toMatch(/no se vio en Sabre|Armado/i);
    }
  });

  it('cubre el truncado, NumberPages > 1, Reservation@Error, la zona y los errores de ADR-033', () => {
    expect(attribute(bodyOf(synthetic, 'truncated-counters'), 'ReservationsList', 'TotalResults')).toBe('5');
    expect(attribute(bodyOf(synthetic, 'number-pages'), 'ReservationsList', 'NumberPages')).toBe('2');
    expect(/<Reservation Locator="AAAAAB" Error="([^"]*)"/.exec(bodyOf(synthetic, 'reservation-error'))?.[1]).toBe('General PNR error');
    expect(locators(bodyOf(synthetic, 'duplicate-locator'))).toEqual(['AAAAAA', 'AAAAAB', 'AAAAAA']);
    const mismatch = bodyOf(synthetic, 'timezone-mismatch');
    expect(Math.round(minutesBetween(attribute(mismatch, 'Trip_SearchRS', 'TimeStamp')!, headerTimestamp(mismatch)!))).toBe(-300);
    const codes = Object.fromEntries(
      synthetic.responses.filter((response) => response.label.startsWith('error-')).map(({ label, body }) => [label, attribute(body, 'Error', 'ErrorCode')]),
    );
    expect(codes).toEqual({
      'error-no-primary-criteria': '200204',
      'error-criteria-too-weak': '200207',
      'error-too-many-results': '200206',
      'error-db-search-timeout': '200203',
      'error-empty-pcc-after-branch-access': '200208',
      'error-empty-pcc-list': '200102',
      'error-unable-to-process-db-search': '200202',
    });
    for (const label of Object.keys(codes)) expect(bodyOf(synthetic, label)).not.toMatch(/ReservationsList|<Success>/);
  });

  it('no trae localizadores, PCC ni tokens reales', () => {
    expectAnonymous(bodies);
  });
});
