// Los candados y la anonimización de scripts/validate-update-reservation.mjs (#272): lo que se puede
// probar sin Sabre. Los sobres son las fixtures sintéticas de U.1 con datos "reales" inventados
// encima (nombre, localizadores, PCC, teléfono, correo, ReceivedFrom).
import { describe, expect, it } from 'vitest';
import { createAnonymizer } from '../src/testing/anonymize.js';
import getFixture from './fixtures/get-reservation.synthetic-guide.json';
import {
  compareSegmentIds,
  createScrubber,
  getReservationPayload,
  previewUpdate,
  readStlReservation,
  receivedFromShape,
  resolvePlan,
  statusCounts,
} from '../scripts/lib/update-reservation.mjs';

const base = { SABRE_ENVIRONMENT: 'production' };

describe('resolvePlan', () => {
  it('lee por defecto: colas 5 y 6, hasta 5 PNR, sin escribir', () => {
    expect(resolvePlan({})).toEqual({ step: 'read', environment: 'sandbox', write: false, queues: [5, 6], scan: 5 });
    expect(resolvePlan({ ...base, SABRE_UPDATE_LOCATOR: 'abc123', SABRE_UPDATE_QUEUES: '5', SABRE_UPDATE_SCAN: '10' })).toMatchObject({
      step: 'read',
      locator: 'ABC123',
      queues: [5],
      scan: 10,
      write: false,
    });
  });

  it('rechaza un candado en la lectura y valores inválidos', () => {
    expect(resolvePlan({ ...base, SABRE_UPDATE_WRITE: 'read:ABC123' }).error).toMatch(/no va con/);
    expect(resolvePlan({ SABRE_ENVIRONMENT: 'cert' }).error).toMatch(/sandbox o production/);
    expect(resolvePlan({ SABRE_UPDATE_STEP: 'delete' }).error).toMatch(/SABRE_UPDATE_STEP/);
    expect(resolvePlan({ SABRE_UPDATE_LOCATOR: 'ABC12' }).error).toMatch(/6 letras/);
    expect(resolvePlan({ SABRE_UPDATE_SCAN: '50' }).error).toMatch(/1 a 20/);
    expect(resolvePlan({ SABRE_UPDATE_QUEUES: '5,x' }).error).toMatch(/numéricas/);
  });

  it('confirm y remove sin candado son en seco', () => {
    const confirm = resolvePlan({ ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '8, 10' });
    expect(confirm).toEqual({
      step: 'confirm',
      environment: 'production',
      locator: 'ABC123',
      segmentIds: ['8', '10'],
      receivedFrom: 'SABRE CLIENT U6',
      lock: 'confirm:ABC123',
      write: false,
    });
    const remove = resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_SEGMENT_IDS: '8' });
    expect(remove).toMatchObject({ step: 'remove', segmentIds: ['8'], lock: 'remove:ABC123', write: false });
  });

  it('escribe solo con el candado exacto, en producción', () => {
    const env = { ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '10' };
    expect(resolvePlan({ ...env, SABRE_UPDATE_WRITE: 'confirm:ABC123' })).toMatchObject({ write: true });
    expect(resolvePlan({ ...env, SABRE_UPDATE_WRITE: 'confirm:XYZ999' }).error).toMatch(/candado no cuadra/);
    expect(resolvePlan({ ...env, SABRE_UPDATE_WRITE: 'remove:ABC123' }).error).toMatch(/candado no cuadra/);
    expect(resolvePlan({ ...env, SABRE_UPDATE_WRITE: 'confirm' }).error).toMatch(/candado no cuadra/);
    expect(resolvePlan({ ...env, SABRE_UPDATE_WRITE: 'yes' }).error).toMatch(/candado no cuadra/);
    expect(resolvePlan({ ...env, SABRE_ENVIRONMENT: 'sandbox', SABRE_UPDATE_WRITE: 'confirm:ABC123' }).error).toMatch(/producción/);
  });

  it('pide localizador e ids en las escrituras', () => {
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_EXPECTED_IDS: '8' }).error).toMatch(/falta SABRE_UPDATE_LOCATOR/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123' }).error).toMatch(/falta SABRE_UPDATE_EXPECTED_IDS/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123' }).error).toMatch(/falta SABRE_UPDATE_SEGMENT_IDS/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_SEGMENT_IDS: '8,a' }).error).toMatch(/numéricos/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_SEGMENT_IDS: '8,8' }).error).toMatch(/repetidos/);
  });

  it('la vista previa trae el item de cada paso', () => {
    const confirm = resolvePlan({ ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '10' });
    expect(previewUpdate(confirm)).toContain('<Action>CONFIRM-ALL</Action>');
    const remove = resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_SEGMENT_IDS: '8,12' });
    expect(previewUpdate(remove)).toContain('<ProductUpdate id="8" op="D"/>');
    expect(previewUpdate(remove)).toContain('<ProductUpdate id="12" op="D"/>');
  });
});

it('getReservationPayload es el del SDK con Stateful, y Stateless para revisar', () => {
  expect(getReservationPayload('ABC123')).toBe(
    '<GetReservationRQ Version="1.19.0" xmlns="http://webservices.sabre.com/pnrbuilder/v1_19"><Locator>ABC123</Locator><RequestType>Stateful</RequestType><ReturnOptions><SubjectAreas><SubjectArea>FULL</SubjectArea></SubjectAreas></ReturnOptions></GetReservationRQ>',
  );
  expect(getReservationPayload('ABC123', 'Stateless')).toContain('<RequestType>Stateless</RequestType>');
});

const tkUn = getFixture.responses.find((r) => r.label === 'tk-un')!.body;
/** El sobre sintético con datos que parecen reales. */
const realistic = tkUn
  .replace('<stl19:RecordLocator>AAAAAA</stl19:RecordLocator>', '<stl19:RecordLocator>QWERTZ</stl19:RecordLocator>')
  .replaceAll('DCB6*AAAAAB', 'DCB6*JKLMNP')
  .replace('<eb:CPAId>XXXX</eb:CPAId>', '<eb:CPAId>P8QA</eb:CPAId>')
  .replace('PseudoCityCode="XXXX"', 'PseudoCityCode="P8QA"')
  .replace('AgentSine="AAA"', 'AgentSine="ZQ7"')
  .replace('<stl19:LastName>PASAJERO</stl19:LastName>', '<stl19:LastName>GUTIÉRREZ</stl19:LastName>')
  .replace('<stl19:FirstName>UNO</stl19:FirstName>', '<stl19:FirstName>MARÍA JOSÉ</stl19:FirstName>')
  .replace('<stl19:Name>TEST</stl19:Name>', '<stl19:Name>LUPITA ROMERO</stl19:Name>')
  .replace('<stl19:Number>0000000</stl19:Number>', '<stl19:Number>5512345678</stl19:Number>')
  .replace('<stl19:EmailAddresses/>', '<stl19:EmailAddresses><stl19:EmailAddress id="12"><stl19:Address>maria.g@example.com</stl19:Address></stl19:EmailAddress></stl19:EmailAddresses>')
  .replace('<stl19:Text>12354</stl19:Text>', '<stl19:Text>PAX VIP &amp; TKT 0012345678901</stl19:Text>');

function scrubberFor() {
  const anonymizer = createAnonymizer({ secrets: ['P8QA'] });
  return { anonymizer, scrub: createScrubber({ aliasOf: anonymizer.aliasOf, secrets: ['P8QA'] }) };
}

describe('createScrubber', () => {
  it('no deja datos reales en el GetReservationRS', () => {
    const { anonymizer, scrub } = scrubberFor();
    const out = scrub.xml(realistic);
    for (const real of ['QWERTZ', 'JKLMNP', 'P8QA', 'ZQ7', 'GUTIÉRREZ', 'MARÍA', 'LUPITA', 'ROMERO', '5512345678', 'maria.g', 'example.com', '0012345678901', 'VIP']) {
      expect(out, real).not.toContain(real);
    }
    expect(scrub.leaks(out)).toEqual([]);
    expect(anonymizer.leaks(out)).toEqual([]);
    expect(out).toContain('<stl19:RecordLocator>AAAAAA</stl19:RecordLocator>');
    expect(out).toContain('<stl19:AirlineRefId>DCB6*AAAAAB</stl19:AirlineRefId>');
    expect(out).toContain('<eb:CPAId>XXXX</eb:CPAId>');
    expect(out).toContain('AgentSine="AAA"');
    expect(out).toContain('<stl19:LastName>XXXXXXXXX</stl19:LastName>');
    expect(out).toContain('<stl19:Text>XXX XXX &amp; XXX 9999999999999</stl19:Text>');
  });

  it('conserva los vuelos, los ids, los estados y MarriageGrp', () => {
    const { scrub } = scrubberFor();
    const before = readStlReservation(realistic);
    const after = readStlReservation(scrub.xml(realistic));
    expect(after.segments).toEqual(before.segments);
    expect(after.segments.map((s) => `${s.airId}:${s.status}`)).toEqual(['8:UN', '10:TK', '9:HK']);
    expect(after.segments[0]?.marriage).toEqual({ ind: '0', group: '0', sequence: '0' });
    expect(after.locator).toBe('AAAAAA');
    expect(receivedFromShape(scrub.xml(realistic))).toEqual(receivedFromShape(realistic));
  });

  it('un Group que no es número se enmascara', () => {
    const { scrub } = scrubberFor();
    expect(scrub.xml('<a><Group>FAMILIA PEREZ</Group><Ind>1</Ind></a>')).toBe('<a><Group>XXXXXXX XXXXX</Group><Ind>1</Ind></a>');
  });

  it('enmascara atributos desconocidos, también con comillas simples', () => {
    const { scrub } = scrubberFor();
    expect(scrub.xml(`<a id="3" Owner='JUAN' Note="x1"/>`)).toBe(`<a id="3" Owner="XXXX" Note="X9"/>`);
  });

  it('el mismo localizador da el mismo alias en el SOAP y en Get Booking', () => {
    const { scrub } = scrubberFor();
    scrub.xml(realistic);
    const booking = scrub.json({
      bookingId: 'QWERTZ',
      travelers: [{ givenName: 'MARÍA JOSÉ', surname: 'GUTIÉRREZ', emails: ['maria.g@example.com'], phones: [{ number: '5512345678' }] }],
      flights: [{ itemId: '10', confirmationId: 'JKLMNP', flightNumber: 3309, airlineCode: 'B6', fromAirportCode: 'JFK', toAirportCode: 'FLL', departureDate: '2021-03-30', flightStatusCode: 'TK' }],
      creationDetails: { creationUserSabreId: 'ZQ7', agencyIataNumber: '12345678', userWorkPcc: 'P8QA' },
    });
    expect(booking.bookingId).toBe('AAAAAA');
    expect(booking.flights[0]).toMatchObject({ itemId: '10', confirmationId: 'AAAAAB', flightNumber: 3309, flightStatusCode: 'TK' });
    const text = JSON.stringify(booking);
    expect(scrub.leaks(text)).toEqual([]);
    for (const real of ['GUTIÉRREZ', 'MARÍA', 'maria.g', '5512345678', 'ZQ7', '12345678', 'P8QA']) expect(text, real).not.toContain(real);
  });

  it('leaks avisa si un valor real quedó en el texto', () => {
    const { scrub } = scrubberFor();
    scrub.xml(realistic);
    expect(scrub.leaks('nota: GUTIÉRREZ llamó al 5512345678')).toEqual(expect.arrayContaining(['LastName', 'Number']));
    expect(scrub.leaks('XXXXXXXXX')).toEqual([]);
    expect(scrub.text('el PNR QWERTZ en P8QA')).toBe('el PNR AAAAAA en XXXX');
  });
});

describe('segmentos', () => {
  const segments = readStlReservation(tkUn).segments;

  it('lee los tres ids y cuenta los estados', () => {
    expect(segments[1]).toMatchObject({ segmentId: '10', airId: '10', productId: '10', status: 'TK', carrier: 'B6', flightNumber: '3309', from: 'JFK', to: 'FLL' });
    expect(statusCounts(segments)).toEqual({ UN: 1, TK: 1, HK: 1 });
  });

  it('compara Air@id con flights[].itemId (Q-140)', () => {
    const flights = [
      { itemId: '10', airlineCode: 'B6', flightNumber: 3309, fromAirportCode: 'JFK', toAirportCode: 'FLL', departureDate: '2021-03-30', departureTime: '12:45', flightStatusCode: 'TK' },
      { itemId: '9', airlineCode: 'B6', flightNumber: 1908, fromAirportCode: 'FLL', toAirportCode: 'JFK', departureDate: '2021-04-15', departureTime: '12:00', flightStatusCode: 'HK' },
    ];
    const result = compareSegmentIds(segments, flights);
    // El UN (8) y el TK (10) son el mismo vuelo el mismo día: la hora los separa.
    expect(result.pairs.map((p: { airId?: string; matched: boolean; itemId?: string }) => [p.airId, p.matched, p.itemId])).toEqual([
      ['8', false, undefined],
      ['10', true, '10'],
      ['9', true, '9'],
    ]);
    expect(result).toMatchObject({ airIdEqualsProductId: true, itemIdIsAirId: true, statusesAgree: true, unmatchedStl: ['8'], unmatchedRest: [] });
  });

  it('lee los errores de un GetReservationRS', () => {
    const error = getFixture.responses.find((r) => r.label === 'error-pnr-not-found')!.body;
    const read = readStlReservation(error);
    expect(read.hasReservation).toBe(false);
    expect(read.errors[0]).toMatchObject({ severity: 'MODERATE' });
  });
});
