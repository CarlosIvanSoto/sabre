// Las fixtures sintéticas de ADR-034 (#267): sobres bien formados, con los estados que dice cada
// caso y sin los datos del ejemplo oficial (localizador, PCC, agente, pasajero, teléfono).
import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { untrimmedPayload } from '../src/http/soap-transport.js';
import getReservation from './fixtures/get-reservation.synthetic-guide.json';
import updateReservation from './fixtures/update-reservation.synthetic-guide.json';

type Fixture = { responses: { label: string; source: string; status: number; body: string }[] };
const all = (fixture: Fixture) => fixture.responses.map((response) => [response.label, response] as const);

/** `[id, ActionCode]` de cada `stl19:Air`, en orden. */
const statuses = (body: string) => [...body.matchAll(/<stl19:Air id="(\d+)"[\s\S]*?<stl19:ActionCode>(\w+)<\/stl19:ActionCode>/g)].map((m) => [m[1], m[2]]);
const body = (fixture: Fixture, label: string) => {
  const found = fixture.responses.find((response) => response.label === label);
  if (found === undefined) throw new Error(`falta ${label}`);
  return found.body;
};

describe.each([
  ['get-reservation', getReservation as Fixture, 'GetReservationRS'],
  ['update-reservation', updateReservation as Fixture, 'UpdateReservationRS'],
])('%s.synthetic-guide.json', (_name, fixture, root) => {
  it.each(all(fixture))('%s: XML bien formado, con el payload esperado y su source', (_label, response) => {
    expect(XMLValidator.validate(response.body)).toBe(true);
    expect(untrimmedPayload(response.body)).toBeDefined();
    expect(response.body).toContain(`<stl19:${root} `);
    // Un error STL no trae Success; un éxito no trae Errors.
    expect(response.body.includes('<stl19:Errors>')).toBe(response.label.startsWith('error-'));
    expect(response.source.length).toBeGreaterThan(20);
    // El Air y el Product (or114) de cada segmento dicen el mismo estado.
    const air = statuses(response.body).map(([, status]) => status);
    const product = [...response.body.matchAll(/<or114:ActionCode>(\w+)<\/or114:ActionCode>/g)].map((m) => m[1]);
    expect(product).toEqual(air);
  });

  it('los sobres no traen los datos del ejemplo oficial (el source sí los cita)', () => {
    const text = JSON.stringify(fixture.responses.map((response) => response.body));
    for (const value of ['MHTFNG', 'TSGZJC', 'MHTGWH', 'FF9A', 'FSG', '"MDG"', '>MDG<', 'ADULT', '123345']) expect(text).not.toContain(value);
    for (const match of text.matchAll(/RecordLocator>(\w+)</g)) expect(match[1]).toBe('AAAAAA');
    for (const match of text.matchAll(/PseudoCityCode=\\"(\w+)\\"/g)) expect(match[1]).toBe('XXXX');
  });
});

describe('los errores', () => {
  it.each([
    [getReservation, 'error-pnr-not-found', '700226'],
    [updateReservation, 'error-orchestration-cancel', '700432'],
    [updateReservation, 'error-aaa-modified', '700411'],
    [updateReservation, 'error-no-pnr-in-aaa', '700408'],
    [updateReservation, 'error-ignore-or-commit', '500810'],
  ])('%#: Errors/Error con Code, Message y Severity como elementos, sin Success ni Reservation', (fixture, label, code) => {
    const xml = body(fixture as Fixture, label);
    expect(xml).toMatch(new RegExp(`<stl19:Errors><stl19:Error><stl19:Code>${code}</stl19:Code><stl19:Message>[^<]+</stl19:Message><stl19:Severity>MODERATE</stl19:Severity></stl19:Error></stl19:Errors>`));
    expect(xml).not.toContain('<stl19:Success>');
    expect(xml).not.toContain('<stl19:Reservation ');
  });
});

describe('los estados de cada caso', () => {
  it.each([
    ['official-tk', [['8', 'TK'], ['9', 'TK']]],
    ['tk-un', [['8', 'UN'], ['10', 'TK'], ['9', 'HK']]],
    ['tk-hx', [['8', 'HX'], ['10', 'TK'], ['9', 'HK']]],
    ['tk-un-hx', [['8', 'UN'], ['10', 'HX'], ['12', 'TK'], ['9', 'HK']]],
    ['hk-only', [['8', 'HK'], ['9', 'HK']]],
    ['tk-kk', [['8', 'TK'], ['9', 'KK']]],
  ])('get %s', (label, expected) => {
    expect(statuses(body(getReservation, label))).toEqual(expected);
  });

  it.each([
    ['confirm-all-official', [['8', 'HK'], ['9', 'HK']], 0],
    ['confirm-all-tk-un', [['8', 'UN'], ['10', 'HK'], ['9', 'HK']], 0],
    ['confirm-all-not-applied', [['8', 'UN'], ['10', 'TK'], ['9', 'HK']], 0],
    ['delete-un', [['10', 'TK'], ['9', 'HK']], 1],
    ['delete-hx', [['10', 'TK'], ['9', 'HK']], 1],
    ['delete-un-hx', [['12', 'TK'], ['9', 'HK']], 2],
    ['delete-not-applied', [['8', 'UN'], ['10', 'TK'], ['9', 'HK']], 1],
  ])('update %s: segmentos después y un UpdateResult por UpdateId', (label, expected, results) => {
    const xml = body(updateReservation, label);
    expect(xml).toContain('<stl19:Success>OK</stl19:Success>');
    expect(statuses(xml)).toEqual(expected);
    const ids = [...xml.matchAll(/<stl19:UpdateResult UpdateId="(\d+)" Status="SUCCESS">/g)].map((m) => Number(m[1]));
    expect(ids).toEqual(Array.from({ length: results }, (_, index) => index + 1));
  });
});
