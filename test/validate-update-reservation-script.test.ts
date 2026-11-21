// Los candados y la anonimización de scripts/validate-update-reservation.mjs (#272): lo que se puede
// probar sin Sabre. Los sobres son las fixtures sintéticas de U.1 con datos "reales" inventados
// encima (nombre, localizadores, PCC, teléfono, correo, ReceivedFrom).
import { describe, expect, it } from 'vitest';
import { createAnonymizer } from '../src/testing/anonymize.js';
import getFixture from './fixtures/get-reservation.synthetic-guide.json';
import {
  aaaCommand,
  aaaScreenValues,
  anonymizeAaaScreen,
  compareSegmentIds,
  contextChangePayload,
  createScrubber,
  describeError,
  errorMentions,
  firstReadError,
  formatReadError,
  getReservationPayload,
  isPcc,
  parseContextChange,
  parseAaaScreen,
  previewUpdate,
  readAfterAaa,
  readStlReservation,
  resolveSessionContext,
  resolveSessionPcc,
  receivedFromShape,
  resolvePlan,
  scanRow,
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
    expect(resolvePlan({ ...base }, ['--write=read:ABC123']).error).toMatch(/no va con SABRE_UPDATE_STEP=read/);
    expect(resolvePlan({ SABRE_ENVIRONMENT: 'cert' }).error).toMatch(/sandbox o production/);
    expect(resolvePlan({ SABRE_UPDATE_STEP: 'delete' }).error).toMatch(/SABRE_UPDATE_STEP/);
    expect(resolvePlan({ SABRE_UPDATE_LOCATOR: 'ABC12' }).error).toMatch(/6 letras/);
    expect(resolvePlan({ SABRE_UPDATE_SCAN: '50' }).error).toMatch(/1 a 20/);
    expect(resolvePlan({ SABRE_UPDATE_QUEUES: '5,x' }).error).toMatch(/numéricas/);
  });

  it('scan lee las colas sin localizador y nunca escribe', () => {
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'scan', SABRE_UPDATE_QUEUES: '5', SABRE_UPDATE_SCAN: '20' })).toEqual({
      step: 'scan',
      environment: 'production',
      write: false,
      queues: [5],
      scan: 20,
    });
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'scan', SABRE_UPDATE_LOCATOR: 'ABC123' }).error).toMatch(/scan no usa SABRE_UPDATE_LOCATOR/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'scan' }, ['--write=scan:ABC123']).error).toMatch(/no va con SABRE_UPDATE_STEP=scan/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'scan', SABRE_UPDATE_SCAN: '0' }).error).toMatch(/1 a 20/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'scan', SABRE_UPDATE_SCAN: '21' }).error).toMatch(/1 a 20/);
  });

  it('confirm y remove sin candado son en seco, con el candado que incluye los ids', () => {
    const confirm = resolvePlan({ ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '10, 8' });
    expect(confirm).toEqual({
      step: 'confirm',
      environment: 'production',
      locator: 'ABC123',
      segmentIds: ['10', '8'],
      lock: 'confirm:ABC123:10,8',
      write: false,
    });
    const remove = resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_SEGMENT_IDS: '8', SABRE_UPDATE_RECEIVED_FROM: ' BX3 ' });
    expect(remove).toMatchObject({ step: 'remove', segmentIds: ['8'], receivedFrom: 'BX3', lock: 'remove:ABC123:8', write: false });
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_SEGMENT_IDS: '8', SABRE_UPDATE_RECEIVED_FROM: '  ' }).error).toMatch(/no puede ir vacío/);
  });

  it('escribe solo con --write exacto en argv, en producción y con ReceivedFrom', () => {
    const env = { ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '8,10', SABRE_UPDATE_RECEIVED_FROM: 'BX3' };
    expect(resolvePlan(env, ['--write=confirm:ABC123:8,10'])).toMatchObject({ write: true, receivedFrom: 'BX3', lock: 'confirm:ABC123:8,10' });
    for (const lock of ['confirm:ABC123', 'confirm:ABC123:10,8', 'confirm:ABC123:8', 'confirm:XYZ999:8,10', 'remove:ABC123:8,10', 'confirm', 'yes', '', 'confirm:abc123:8,10']) {
      expect(resolvePlan(env, [`--write=${lock}`]).error, lock).toMatch(/candado no cuadra/);
    }
    expect(resolvePlan({ ...env, SABRE_ENVIRONMENT: 'sandbox' }, ['--write=confirm:ABC123:8,10']).error).toMatch(/producción/);
    const { SABRE_UPDATE_RECEIVED_FROM: _, ...withoutReceivedFrom } = env;
    expect(resolvePlan(withoutReceivedFrom, ['--write=confirm:ABC123:8,10']).error).toMatch(/falta SABRE_UPDATE_RECEIVED_FROM: la escritura no tiene default \(p\. ej\. SABRE_UPDATE_RECEIVED_FROM=BX3\)/);
  });

  it('el candado no sale del entorno y argv no acepta otra cosa', () => {
    const env = { ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '8', SABRE_UPDATE_RECEIVED_FROM: 'BX3' };
    // El candado de antes, en el entorno (un `export` o .env.production), es un error incluso en la lectura.
    expect(resolvePlan({ ...env, SABRE_UPDATE_WRITE: 'confirm:ABC123:8' }).error).toMatch(/SABRE_UPDATE_WRITE ya no se acepta/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_WRITE: '' }).error).toMatch(/SABRE_UPDATE_WRITE ya no se acepta/);
    expect(resolvePlan({ ...env, SABRE_UPDATE_WRITE: 'confirm:ABC123:8' }, ['--write=confirm:ABC123:8']).error).toMatch(/SABRE_UPDATE_WRITE ya no se acepta/);
    expect(resolvePlan(env, ['--write=confirm:ABC123:8', '--write=confirm:ABC123:8']).error).toMatch(/una sola vez/);
    expect(resolvePlan(env, ['--write', 'confirm:ABC123:8']).error).toMatch(/va pegado/);
    expect(resolvePlan(env, ['--dry-run']).error).toMatch(/argumento desconocido: --dry-run/);
    expect(resolvePlan(env, ['confirm:ABC123:8']).error).toMatch(/argumento desconocido/);
  });

  it('pide localizador e ids en las escrituras', () => {
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_EXPECTED_IDS: '8' }).error).toMatch(/falta SABRE_UPDATE_LOCATOR/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123' }).error).toMatch(/falta SABRE_UPDATE_EXPECTED_IDS/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123' }).error).toMatch(/falta SABRE_UPDATE_SEGMENT_IDS/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_SEGMENT_IDS: '8,a' }).error).toMatch(/numéricos/);
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_SEGMENT_IDS: '8,8' }).error).toMatch(/repetidos/);
  });

  it('la vista previa usa BX3 de ejemplo si falta ReceivedFrom', () => {
    const plan = resolvePlan({ ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '10' });
    expect(previewUpdate(plan)).toContain('<ReceivedFrom><Name>BX3</Name></ReceivedFrom>');
    const named = resolvePlan({ ...base, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '10', SABRE_UPDATE_RECEIVED_FROM: 'BX3 JPEREZ' });
    expect(previewUpdate(named)).toContain('<ReceivedFrom><Name>BX3 JPEREZ</Name></ReceivedFrom>');
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

describe('createScrubber: lo que no es texto de un elemento hoja (I-2)', () => {
  const scrubbed = (body: string) => {
    const { scrub } = scrubberFor();
    const out = scrub.xml(body);
    return { scrub, out };
  };

  it('enmascara el contenido mixto', () => {
    const { out } = scrubbed('<Remark>JUAN PEREZ<Sub/>CALLE 5</Remark>');
    expect(out).toBe('<Remark>XXXX XXXXX<Sub/>XXXXX 9</Remark>');
  });

  it('enmascara un CDATA, también en un elemento de la lista blanca', () => {
    expect(scrubbed('<FreeText><![CDATA[JUAN PEREZ 5512345678]]></FreeText>').out).toBe('<FreeText><![CDATA[XXXX XXXXX 9999999999]]></FreeText>');
    expect(scrubbed('<ActionCode><![CDATA[PEREZ]]></ActionCode>').out).toBe('<ActionCode><![CDATA[XXXXX]]></ActionCode>');
  });

  it('un > entre comillas no corta el atributo, y lo que no es nombre="valor" se enmascara', () => {
    expect(scrubbed('<Person Name="PEREZ>JUAN"/>').out).toBe('<Person Name="XXXXX&gt;XXXX"/>');
    expect(scrubbed('<Person id="1" PEREZ JUAN/>').out).toBe('<Person id="1" XXXXX XXXX/>');
  });

  it('enmascara comentarios, PI y DOCTYPE, y deja la declaración <?xml', () => {
    const { out } = scrubbed('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE PEREZ><!-- JUAN 5512345678 --><?pi PEREZ?><a/>');
    expect(out).toBe('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!XXXXXXX XXXXX><!-- XXXX 9999999999 --><?XX XXXXX?><a/>');
  });

  it('Message y Banner se enmascaran; Code, Severity, Action y Service pasan solo con forma de código', () => {
    expect(scrubbed('<Message>NAME PEREZ/JUAN 5512345678</Message><Banner>JUAN</Banner>').out).toBe('<Message>XXXX XXXXX/XXXX 9999999999</Message><Banner>XXXX</Banner>');
    expect(scrubbed('<Code>ERR.SP.PROVIDER_ERROR</Code><Severity>MODERATE</Severity><eb:Action>GetReservationRQ</eb:Action><Action>CONFIRM-ALL</Action><eb:Service>UpdateReservationRQ</eb:Service>').out).toBe(
      '<Code>ERR.SP.PROVIDER_ERROR</Code><Severity>MODERATE</Severity><eb:Action>GetReservationRQ</eb:Action><Action>CONFIRM-ALL</Action><eb:Service>UpdateReservationRQ</eb:Service>',
    );
    expect(scrubbed('<Code>PEREZ JUAN</Code><Severity>ALTA 55</Severity>').out).toBe('<Code>XXXXX XXXX</Code><Severity>XXXX 99</Severity>');
  });

  it('un < suelto o un comentario sin cerrar se vuelven texto enmascarado', () => {
    expect(scrubbed('<a>1 < 2 JUAN</a>').out).toBe('<a>9 &lt; 9 XXXX</a>');
    expect(scrubbed('<a/><!-- PEREZ').out).toBe('<a/>&lt;!-- XXXXX');
  });

  it('decodifica referencias numéricas antes de enmascarar', () => {
    expect(scrubbed('<LastName>&#80;EREZ&#x4A;</LastName>').out).toBe('<LastName>XXXXXX</LastName>');
  });

  it('en JSON enmascara description y los números bajo claves que no son seguras', () => {
    const { scrub } = scrubberFor();
    const out = scrub.json({ description: 'PASSENGER PEREZ/JUAN', phone: 5512345678, flightNumber: 3309, numberOfSeats: 2, isPast: false, misc: null });
    expect(out).toEqual({ description: 'XXXXXXXXX XXXXX/XXXX', phone: 9999999999, flightNumber: 3309, numberOfSeats: 2, isPast: false, misc: null });
    expect(scrub.leaks('llamar al 5512345678')).toEqual(['phone']);
  });

  it('leaks busca cada palabra de los nombres del STL y de REST, sin mínimo de largo', () => {
    const { scrub } = scrubberFor();
    scrub.xml('<a><LastName>NG</LastName><FirstName>MARIA ANA DE LA CRUZ MRS</FirstName><MiddleName>J</MiddleName></a>');
    scrub.json({ travelers: [{ givenName: 'LUPE', surname: 'LI' }] });
    expect(scrub.leaks('la nota dice NG')).toEqual(['LastName']);
    expect(scrub.leaks('ANA')).toEqual(['FirstName']);
    expect(scrub.leaks('cruz')).toEqual(['FirstName']);
    expect(scrub.leaks('Li, Lupe')).toEqual(expect.arrayContaining(['surname', 'givenName']));
    // Ni las iniciales, ni las partículas, ni los títulos: `LA` es una aerolínea; `J` y `Y`, clases.
    expect(scrub.leaks('<MarketingAirlineCode>LA</MarketingAirlineCode> DE MRS J Y')).toEqual([]);
    // Dentro de otra palabra no cuenta: NG en ENGLISH, LI en LIMA.
    expect(scrub.leaks('ENGLISH LIMA XX XXXX')).toEqual([]);
  });

  it('leakDetails dice el campo y la palabra que quedaron', () => {
    const { scrub } = scrubberFor();
    scrub.xml('<a><LastName>GUTIÉRREZ</LastName><Number>5512345678</Number></a>');
    expect(scrub.leakDetails('nota: Gutiérrez, 5512345678')).toEqual(
      expect.arrayContaining([
        { field: 'LastName', value: 'GUTIÉRREZ' },
        { field: 'Number', value: '5512345678' },
      ]),
    );
    expect(scrub.leakDetails('XXXXXXXXX 9999999999')).toEqual([]);
  });

  it('addNames también se puede llamar a mano', () => {
    const { scrub } = scrubberFor();
    scrub.addNames(['O\'BRIEN', undefined], 'pax');
    expect(scrub.leaks("pasajero O'BRIEN")).toEqual(['pax']);
  });

  it('el sobre realista sigue limpio y los nombres quedan vigilados', () => {
    const { scrub } = scrubberFor();
    const out = scrub.xml(realistic);
    expect(scrub.leaks(out)).toEqual([]);
    expect(scrub.leaks(`${out} JOSÉ`)).toEqual(['FirstName']);
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
  it('sin Air@id, airId sale de Segment@id, como el SDK (M-4)', () => {
    const read = readStlReservation(tkUn.replace('<stl19:Air id="8" ', '<stl19:Air '));
    expect(read.segments[0]).toMatchObject({ segmentId: '8', airId: '8', airIdFromSegment: true });
    expect(read.segments[1]).toMatchObject({ airId: '10', airIdFromSegment: false });
  });

  it('scanRow arma la fila de la tabla del paso scan', () => {
    const pnr = readStlReservation(tkUn);
    expect(pnr).toMatchObject({ passengers: 1, numberInParty: '1', ticketing: { issued: false, children: ['FutureTicketing'] } });
    const row = scanRow(new Set([5, 6]), 'QWERTZ', pnr);
    expect(row).toMatchObject({ cola: '5,6', localizador: 'QWERTZ', aerolíneas: 'B6', HK: 1, otros: '—', boleto: 'desconocido (FutureTicketing)', marriage: 'no', pax: 1, errores: '—' });
    expect(row.viejos).toMatch(/^8 UN B6\d+ \w{3}-\w{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(row.nuevos).toMatch(/^10 TK B63309 JFK-FLL /);
  });

  it('scanRow: boleto, marriage con grupo y los otros estados de CONFIRM-ALL', () => {
    const segment = (airId: string, status: string, marriage?: { group: string }) => ({ airId, status, carrier: 'AM', flightNumber: '1', from: 'MEX', to: 'CUN', departure: '2026-12-01T10:00:00', marriage });
    const pnr = {
      segments: [segment('1', 'HX', { group: '2' }), segment('2', 'TK', { group: '2' }), segment('3', 'KK'), segment('4', 'KK'), segment('5', 'TL', { group: '0' })],
      passengers: 0,
      numberInParty: '3',
      ticketing: { issued: true, children: ['TicketDetails'] },
      errors: [{ code: 'WARN.X' }],
    };
    expect(scanRow([5], 'ABC123', pnr)).toMatchObject({ viejos: '1 HX AM1 MEX-CUN 2026-12-01 10:00', nuevos: '2 TK AM1 MEX-CUN 2026-12-01 10:00', otros: 'KK×2 TL×1', boleto: 'sí', marriage: 'sí (2)', pax: 3, errores: 'WARN.X' });
    expect(scanRow([5], 'ABC123', { ...pnr, ticketing: undefined }).boleto).toBe('desconocido (sin TicketingInfo)');
  });
});

// Q-143: el AAA de la sesión antes de leer o escribir (SABRE_SESSION_PCC).
describe('resolveSessionPcc', () => {
  it('sin la variable no hay PCC: no se manda ningún AAA', () => {
    expect(resolveSessionPcc({})).toEqual({});
    expect(resolveSessionPcc({ SABRE_SESSION_PCC: '' })).toEqual({});
    // SABRE_QUEUE_PCC y SABRE_TARGET_PCC solos no mandan un AAA.
    expect(resolveSessionPcc({ SABRE_QUEUE_PCC: 'target', SABRE_TARGET_PCC: 'P8AB' })).toEqual({});
    const plan = resolvePlan({ ...base, SABRE_QUEUE_PCC: 'target', SABRE_TARGET_PCC: 'P8AB' });
    expect(plan).toEqual({ step: 'read', environment: 'production', write: false, queues: [5, 6], scan: 5 });
    expect(plan).not.toHaveProperty('sessionPcc');
  });

  it('target toma SABRE_TARGET_PCC y cualquier otro valor es el PCC directo', () => {
    expect(resolveSessionPcc({ SABRE_SESSION_PCC: 'target', SABRE_TARGET_PCC: 'P8AB' })).toEqual({ pcc: 'P8AB', label: 'SABRE_TARGET_PCC' });
    expect(resolveSessionPcc({ SABRE_SESSION_PCC: 'P8A', SABRE_TARGET_PCC: 'ZZZZ' })).toEqual({ pcc: 'P8A', label: 'SABRE_SESSION_PCC' });
    expect(resolveSessionPcc({ SABRE_SESSION_PCC: 'target' }).error).toMatch(/pide SABRE_TARGET_PCC/);
    expect(resolveSessionPcc({ SABRE_SESSION_PCC: 'target', SABRE_TARGET_PCC: '' }).error).toMatch(/pide SABRE_TARGET_PCC/);
  });

  it('valida el PCC: alfanumérico, mayúsculas, 3 o 4 caracteres', () => {
    for (const ok of ['P8A', 'P8AB', '8AYC', 'H8GI', '123']) expect(isPcc(ok), ok).toBe(true);
    for (const bad of ['', 'P8', 'P8ABC', 'p8ab', 'P8 B', 'P8A¥', 'P8A\nI', 'P8A/B', 'AAAP8AB', 'P8AB ', undefined, 8]) {
      expect(isPcc(bad), String(bad)).toBe(false);
      if (typeof bad === 'string') expect(resolveSessionPcc({ SABRE_SESSION_PCC: bad === '' ? 'x' : bad }).error, bad).toMatch(/PCC de 3 o 4/);
    }
    expect(resolveSessionPcc({ SABRE_SESSION_PCC: 'target', SABRE_TARGET_PCC: 'P8+B' }).error).toMatch(/PCC de 3 o 4/);
    // El mensaje no repite un TARGET_PCC inválido (podría ser otra cosa); el directo sí lo muestra.
    expect(resolveSessionPcc({ SABRE_SESSION_PCC: 'target', SABRE_TARGET_PCC: 'P8+B' }).error).not.toContain('P8+B');
  });

  it('resolvePlan lo deja en el plan de los cuatro pasos y corta con un PCC inválido', () => {
    const session = { SABRE_SESSION_PCC: 'target', SABRE_TARGET_PCC: 'P8AB' };
    expect(resolvePlan({ ...base, ...session, SABRE_UPDATE_STEP: 'scan' })).toMatchObject({ sessionPcc: 'P8AB', sessionPccLabel: 'SABRE_TARGET_PCC' });
    expect(resolvePlan({ ...base, ...session })).toMatchObject({ step: 'read', sessionPcc: 'P8AB' });
    const confirm = { ...base, ...session, SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '8' };
    expect(resolvePlan(confirm)).toMatchObject({ step: 'confirm', sessionPcc: 'P8AB', write: false });
    expect(resolvePlan({ ...confirm, SABRE_UPDATE_RECEIVED_FROM: 'BX3' }, ['--write=confirm:ABC123:8'])).toMatchObject({ write: true, sessionPcc: 'P8AB' });
    expect(resolvePlan({ ...confirm, SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_SEGMENT_IDS: '8' })).toMatchObject({ step: 'remove', sessionPcc: 'P8AB' });
    expect(resolvePlan({ ...base, SABRE_SESSION_PCC: 'P8' }).error).toMatch(/SABRE_SESSION_PCC/);
    // El AAA no cambia el candado de escritura.
    expect(resolvePlan({ ...confirm, SABRE_UPDATE_RECEIVED_FROM: 'BX3' }, ['--write=confirm:ABC123:8,10']).error).toMatch(/candado no cuadra/);
  });
});

describe('aaaCommand', () => {
  it('arma AAA<PCC> y nada más', () => {
    expect(aaaCommand('P8AB')).toBe('AAAP8AB');
    expect(aaaCommand('8AYC')).toBe('AAA8AYC');
    expect(aaaCommand('H8G')).toBe('AAAH8G');
  });

  it('no arma un comando con un PCC que no lo es', () => {
    for (const bad of ['', 'P8', 'P8ABC', 'p8ab', 'P8AB¥SI9', 'P8AB\nI', 'P8 B', undefined, null, 1234]) {
      expect(() => aaaCommand(bad as string), String(bad)).toThrow(/PCC del AAA/);
    }
  });
});

describe('parseAaaScreen: sin ella el script aborta antes de leer o escribir', () => {
  it('confirma solo la línea <PCC>.<home>*<sine>.<duty> con el PCC pedido', () => {
    expect(parseAaaScreen('8AYC.H8GI*AWS.A\nNO MESSAGE..12NOV', '8AYC')).toEqual({ ok: true, reason: 'el host confirma el AAA 8AYC', activePcc: '8AYC', home: 'H8GI', sine: 'AWS' });
    expect(parseAaaScreen('  P8AB.BX3*AWS.A', 'P8AB').ok).toBe(true);
    expect(parseAaaScreen('\r\n8AYC.H8GI*AWS.A\r\n', '8AYC').ok).toBe(true);
  });

  it('no confirma si el host quedó en otro PCC', () => {
    const result = parseAaaScreen('H8GI.H8GI*AWS.A', 'P8AB');
    expect(result).toMatchObject({ ok: false, activePcc: 'H8GI', home: 'H8GI', sine: 'AWS' });
    expect(result.reason).toMatch(/quedó en H8GI, no en P8AB/);
  });

  it('no confirma una pantalla de error ni una vacía', () => {
    expect(parseAaaScreen('NOT AUTHORIZED FOR PCC', 'P8AB')).toMatchObject({ ok: false, reason: 'el host respondió un error: NOT AUTHORIZED' });
    expect(parseAaaScreen('INVALID PCC', 'P8AB').ok).toBe(false);
    expect(parseAaaScreen('FORMAT', 'P8AB').reason).toMatch(/FORMAT/);
    expect(parseAaaScreen('', 'P8AB')).toEqual({ ok: false, reason: 'la pantalla vino vacía' });
    expect(parseAaaScreen(undefined, 'P8AB').ok).toBe(false);
    expect(parseAaaScreen('   \n  ', 'P8AB').ok).toBe(false);
  });

  it('una pantalla que no se reconoce no cuenta como cambio, ni siquiera si menciona el PCC', () => {
    const result = parseAaaScreen('CHANGED TO P8AB', 'P8AB');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/primera línea/);
    // El PCC pedido en una línea de error no es una confirmación.
    expect(parseAaaScreen('INVALID P8AB.BX3*AWS.A', 'P8AB').ok).toBe(false);
    // Solo vale la primera línea: una segunda línea con la forma correcta no confirma.
    expect(parseAaaScreen('UNABLE\nP8AB.BX3*AWS.A', 'P8AB').ok).toBe(false);
  });
});

describe('anonymizeAaaScreen', () => {
  it('deja el PCC y el home en XXXX y la sine en AAA', () => {
    expect(anonymizeAaaScreen('8AYC.H8GI*AWS.A\nNO MESSAGE..12NOV', ['8AYC', 'H8GI'])).toBe('XXXX.XXXX*AAA.A\nNO MESSAGE..12NOV');
    // Un home que no está en los secretos también se tapa: sale de la forma de la línea.
    expect(anonymizeAaaScreen('P8AB.BX3*JDOE.9', [])).toBe('XXXX.XXXX*AAA.9');
  });

  it('tapa los PCC conocidos en cualquier línea de una pantalla de error', () => {
    expect(anonymizeAaaScreen('NOT AUTHORIZED FOR P8AB', ['P8AB'])).toBe('NOT AUTHORIZED FOR XXXX');
    expect(anonymizeAaaScreen('INVALID PCC', ['P8AB', undefined as unknown as string])).toBe('INVALID PCC');
  });

  it('tapa por forma toda línea <PCC>.<home>*<sine>.<duty>, no solo la primera (M-1)', () => {
    const screen = 'P8AB.H8GI*AWS.A\nNO MESSAGE..12NOV\nANTES H7QZ.K2LM*JDOE.B\nOTRA  Z9Y8.Q1W2*XY.C';
    // Ninguno de esos valores está en los secretos conocidos: salen de la forma.
    expect(anonymizeAaaScreen(screen, [])).toBe('XXXX.XXXX*AAA.A\nNO MESSAGE..12NOV\nANTES XXXX.XXXX*AAA.B\nOTRA  XXXX.XXXX*AAA.C');
    // Una pantalla de error que cita la forma tampoco deja el home ni la sine.
    expect(anonymizeAaaScreen('INVALID P8AB.BX3*AWS.A', [])).toBe('INVALID XXXX.XXXX*AAA.A');
  });

  it('la pantalla anonimizada no deja un PCC real', () => {
    const screen = anonymizeAaaScreen('P8AB.H8GI*AWS.A\nP8AB ACTIVE', ['P8AB', 'H8GI']);
    expect(screen).not.toMatch(/P8AB|H8GI|AWS/);
  });
});

describe('aaaScreenValues', () => {
  it('saca el PCC, el home y la sine de cada línea con la forma, no solo de la primera', () => {
    expect(aaaScreenValues('P8AB.H8GI*AWS.A\nNO MESSAGE..12NOV\nANTES H7QZ.K2LM*JDOE.B')).toEqual(['P8AB', 'H8GI', 'AWS', 'H7QZ', 'K2LM', 'JDOE']);
    expect(aaaScreenValues('NOT AUTHORIZED')).toEqual([]);
    expect(aaaScreenValues(undefined)).toEqual([]);
  });
});

describe('errorMentions (M-3)', () => {
  it('encuentra el código en code, message, thrown o los errores anidados', () => {
    expect(errorMentions({ name: 'SabreError', code: '700102' }, '700102')).toBe(true);
    expect(errorMentions({ message: 'ERR.700102 Viewership is restricted' }, '700102')).toBe(true);
    expect(errorMentions({ thrown: 'boom 700102' }, '700102')).toBe(true);
    expect(errorMentions({ message: 'otro', errors: [{ message: 'x', errors: [{ code: 700102 }] }] }, '700102')).toBe(true);
  });

  it('no lo da por visto donde no está', () => {
    expect(errorMentions(undefined, '700102')).toBe(false);
    expect(errorMentions({ code: '700101', message: 'otro' }, '700102')).toBe(false);
    expect(errorMentions({ message: 'x', errors: [] }, '700102')).toBe(false);
  });

  it('funciona con un Error cuyo message no es enumerable, donde JSON.stringify da {}', () => {
    const error = new Error('Viewership is restricted (700102)');
    Object.defineProperty(error, 'message', { value: 'Viewership is restricted (700102)', enumerable: false });
    expect(JSON.stringify(error)).toBe('{}');
    expect(errorMentions(error, '700102')).toBe(true);
    // Lo que el script guarda en `results`.
    expect(errorMentions(describeError(error), '700102')).toBe(true);
  });
});

describe('readAfterAaa', () => {
  const stl = (errors: Array<{ code?: string }>, hasReservation = false) => ({ errors, hasReservation });

  it('ok si la lectura trajo la reserva', () => {
    expect(readAfterAaa(stl([], true), undefined)).toBe('ok');
  });

  it('el código de error de GetReservationRS, p. ej. 700102', () => {
    expect(readAfterAaa(stl([{ code: '700102' }]), undefined)).toBe('700102');
    expect(readAfterAaa(stl([{ code: '700102' }, { code: 'X1' }]), undefined)).toBe('700102 X1');
  });

  it('sin GetReservationRS usa el código del error del paso, o dice que no hubo respuesta', () => {
    expect(readAfterAaa(undefined, { code: '700102' })).toBe('700102');
    expect(readAfterAaa(undefined, undefined)).toBe('sin respuesta');
    expect(readAfterAaa(stl([]), undefined)).toBe('sin reserva');
  });
});

describe('resolveSessionContext (SABRE_SESSION_CONTEXT)', () => {
  it('por defecto es aaa, con o sin PCC destino', () => {
    expect(resolveSessionContext({}, undefined)).toEqual({ context: 'aaa' });
    expect(resolveSessionContext({ SABRE_SESSION_CONTEXT: '' }, 'P8AB')).toEqual({ context: 'aaa' });
    expect(resolveSessionContext({ SABRE_SESSION_CONTEXT: 'aaa' }, undefined)).toEqual({ context: 'aaa' });
  });

  it('acepta las tres variantes con PCC destino', () => {
    for (const context of ['aaa', 'context-change', 'context-change-cpaid']) {
      expect(resolveSessionContext({ SABRE_SESSION_CONTEXT: context }, 'P8AB')).toEqual({ context });
    }
  });

  it('un valor desconocido es un error, no un aaa por omisión', () => {
    expect(resolveSessionContext({ SABRE_SESSION_CONTEXT: 'AAA' }, 'P8AB').error).toMatch(/aaa, context-change, context-change-cpaid/);
    expect(resolveSessionContext({ SABRE_SESSION_CONTEXT: 'cpaid' }, 'P8AB').error).toMatch(/recibido: cpaid/);
  });

  it('context-change y context-change-cpaid piden SABRE_SESSION_PCC', () => {
    for (const context of ['context-change', 'context-change-cpaid']) {
      expect(resolveSessionContext({ SABRE_SESSION_CONTEXT: context }, undefined).error).toMatch(/pide SABRE_SESSION_PCC/);
    }
  });

  it('resolvePlan lo deja en el plan de scan y read y corta si no es válido', () => {
    const session = { ...base, SABRE_SESSION_PCC: 'P8AB', SABRE_SESSION_CONTEXT: 'context-change-cpaid' };
    expect(resolvePlan({ ...session, SABRE_UPDATE_STEP: 'scan' })).toMatchObject({ step: 'scan', sessionPcc: 'P8AB', sessionContext: 'context-change-cpaid' });
    expect(resolvePlan({ ...session, SABRE_UPDATE_STEP: 'read', SABRE_UPDATE_LOCATOR: 'ABC123' })).toMatchObject({ step: 'read', sessionPcc: 'P8AB', sessionContext: 'context-change-cpaid' });
    // Sin la variable, la variante es aaa.
    expect(resolvePlan({ ...base, SABRE_SESSION_PCC: 'P8AB' })).toMatchObject({ sessionContext: 'aaa' });
    expect(resolvePlan({ ...base, SABRE_SESSION_CONTEXT: 'context-change' }).error).toMatch(/pide SABRE_SESSION_PCC/);
    expect(resolvePlan({ ...base, SABRE_SESSION_PCC: 'P8AB', SABRE_SESSION_CONTEXT: 'otro' }).error).toMatch(/SABRE_SESSION_CONTEXT debe ser/);
  });
});

describe('resolvePlan: SABRE_UPDATE_REST_CHECK', () => {
  it('solo acepta 1 y solo con scan', () => {
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'scan', SABRE_UPDATE_REST_CHECK: '1' })).toMatchObject({ step: 'scan', restCheck: true, write: false });
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'scan' })).not.toHaveProperty('restCheck');
    expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'scan', SABRE_UPDATE_REST_CHECK: '' })).not.toHaveProperty('restCheck');
    for (const bad of ['true', '0', 'yes', '2']) {
      expect(resolvePlan({ ...base, SABRE_UPDATE_STEP: 'scan', SABRE_UPDATE_REST_CHECK: bad }).error, bad).toMatch(/solo acepta 1/);
    }
    expect(resolvePlan({ ...base, SABRE_UPDATE_REST_CHECK: '1' }).error).toMatch(/solo va con SABRE_UPDATE_STEP=scan/);
  });
});

describe('contextChangePayload', () => {
  it('arma ContextChangeLLSRQ 2.0.3 con ChangeAAA hacia el PCC', () => {
    expect(contextChangePayload('P8AB')).toBe(
      '<ContextChangeRQ ReturnHostCommand="true" Version="2.0.3" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><ChangeAAA PseudoCityCode="P8AB"/></ContextChangeRQ>',
    );
    expect(contextChangePayload('P8A')).toContain('PseudoCityCode="P8A"');
  });

  it('rechaza lo que no es un PCC: nunca arma otra cosa', () => {
    for (const bad of ['', 'p8ab', 'P8"/><x', 'P8ABC', 'P8 B', undefined]) {
      expect(() => contextChangePayload(bad as string), String(bad)).toThrow(TypeError);
    }
  });
});

describe('parseContextChange', () => {
  const token = 'Shared/IDL:IceSess\\/SessMgr:1\\.0.IDL/Common/!ICESMS\\/STSB!1769772916289!4392!517!2';
  const ok = { ApplicationResults: { '@status': 'Complete' }, SecurityToken: { '@Updated': 'true', '#text': token }, Text: ['P8AB.H8GI*AWS.A', 'NO MESSAGE..30JAN'] };

  it('confirma con Complete y un Text que empieza con el PCC', () => {
    const result = parseContextChange(ok, 'P8AB');
    expect(result).toMatchObject({ ok: true, status: 'Complete', tokenUpdated: true, screen: 'P8AB.H8GI*AWS.A\nNO MESSAGE..30JAN' });
    expect(result.reason).toMatch(/confirma el cambio de contexto a P8AB/);
  });

  it('el token sale por result.token pero no es enumerable: no llega a JSON ni a un spread', () => {
    const result = parseContextChange(ok, 'P8AB');
    expect(result.token).toBe(token);
    expect(Object.keys(result)).not.toContain('token');
    expect(JSON.stringify(result)).not.toContain('IceSess');
    expect(JSON.stringify({ ...result })).not.toContain('IceSess');
  });

  it('sin Updated="true" o con el token vacío no hay token nuevo', () => {
    const none = parseContextChange({ ...ok, SecurityToken: undefined }, 'P8AB');
    expect(none).toMatchObject({ ok: true, tokenUpdated: false });
    expect(none.token).toBeUndefined();
    expect(parseContextChange({ ...ok, SecurityToken: { '@Updated': 'false', '#text': token } }, 'P8AB').tokenUpdated).toBe(false);
    expect(parseContextChange({ ...ok, SecurityToken: { '@Updated': 'true', '#text': '  ' } }, 'P8AB').tokenUpdated).toBe(false);
  });

  it('el Text puede ser un solo string', () => {
    expect(parseContextChange({ ...ok, Text: 'P8AB.H8GI*AWS.A' }, 'P8AB')).toMatchObject({ ok: true, screen: 'P8AB.H8GI*AWS.A' });
  });

  it('no confirma si el status no es Complete, falta o es de otro PCC', () => {
    expect(parseContextChange({ ...ok, ApplicationResults: { '@status': 'NotProcessed' } }, 'P8AB')).toMatchObject({ ok: false, status: 'NotProcessed' });
    expect(parseContextChange({ ...ok, ApplicationResults: undefined }, 'P8AB').reason).toMatch(/sin status/);
    expect(parseContextChange({ ...ok, Text: undefined }, 'P8AB').reason).toMatch(/no trae Text/);
    expect(parseContextChange({ ...ok, Text: ['', '  '] }, 'P8AB').reason).toMatch(/no trae Text/);
    expect(parseContextChange({ ...ok, Text: ['H8GI.H8GI*AWS.A'] }, 'P8AB').reason).toMatch(/no empieza con P8AB/);
    expect(parseContextChange(undefined, 'P8AB')).toMatchObject({ ok: false, tokenUpdated: false, screen: '' });
  });
});

describe('firstReadError y formatReadError', () => {
  const err = { name: 'SabreBusinessError', code: '700102', reason: 'x', message: 'sin acceso', errors: [{ name: 'Inner', message: 'detalle' }] };
  const results = [
    { step: 'cola 5', ok: true },
    { step: 'revisar 1', ok: true },
    { step: 'revisar 2', ok: false, error: err },
    { step: 'revisar 3', ok: false, error: { name: 'Otro', message: 'otro' } },
  ];

  it('devuelve el primer error de lectura, completo', () => {
    expect(firstReadError(results)).toEqual({ step: 'revisar 2', ...err });
    expect(firstReadError([{ step: 'cola 5', ok: false, error: { name: 'E' } }, { step: 'revisar 1', ok: true }])).toBeUndefined();
    expect(firstReadError([])).toBeUndefined();
  });

  it('formatReadError muestra nombre, código, reason, mensaje y los anidados', () => {
    const text = formatReadError(firstReadError(results));
    expect(text).toContain('SabreBusinessError [código 700102] (reason x): sin acceso');
    expect(text).toContain('↳ Inner: detalle');
    expect(formatReadError({ thrown: 'boom' })).toBe('Error: boom');
  });
});
