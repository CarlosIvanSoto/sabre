#!/usr/bin/env node
// Sobres sintéticos de `GetReservationRS` y `UpdateReservationRS` (STL 1.19) para ADR-034 (#267).
// Salen de los ejemplos oficiales de Update Itinerary 1.19.22 en Developer Hub (sabre-wiki:
// raw/sources/update-itinerary-modify-air-segment.md, «Change Status», y
// raw/sources/update-itinerary-cancel-air-segments-and-add-remarks.md; los errores, de
// raw/sources/update-itinerary-errors.md), metidos en el sobre SOAP de
// una respuesta real ya anonimizada (test/fixtures/trip-search.sandbox-validate.json). No llama a
// Sabre: ninguno se vio en Sabre, y U.6 (#272) trae la primera respuesta real.
//
//   node scripts/synthetic-update-reservation.mjs
//
// Escribe test/fixtures/get-reservation.synthetic-guide.json y
// test/fixtures/update-reservation.synthetic-guide.json. Cada sobre lleva en `source` de qué
// ejemplo sale y qué se supuso.
//
// Anonimización: localizador `AAAAAA`, `PseudoCityCode` y `BookingSource` a `XXXX`, `AgentSine` y
// `CreationAgentID` a `AAA`, pasajero `PASAJERO/UNO`, teléfono `0000000`, `AirlineRefId` con
// alias. Los vuelos, horarios y ids son los del ejemplo (B6 3309 y 1908), con los cambios que dice
// cada `source`.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../test/fixtures/', import.meta.url).pathname;
const real = JSON.parse(readFileSync(`${root}trip-search.sandbox-validate.json`, 'utf8'));
const template = real.responses.find((r) => r.operation === 'reservation.searchByUpdateDate').body;

/** El sobre real con otro `eb:Service`/`eb:Action` y otro cuerpo. */
const envelope = (action, payload) =>
  template
    .replace(/(<eb:Service>)[^<]*(<\/eb:Service>)/, `$1${action}$2`)
    .replace(/(<eb:Action>)[^<]*(<\/eb:Action>)/, `$1${action}$2`)
    .replace(/<soap-env:Body>[\s\S]*<\/soap-env:Body>/, `<soap-env:Body>${payload}</soap-env:Body>`);

const NS =
  'xmlns:stl19="http://webservices.sabre.com/pnrbuilder/v1_19" xmlns:ns6="http://services.sabre.com/res/orr/v0" xmlns:or114="http://services.sabre.com/res/or/v1_14" xmlns:raw="http://tds.sabre.com/itinerary" xmlns:ns4="http://webservices.sabre.com/pnrconn/ReaccSearch"';

/** Los vuelos del ejemplo «Change Status» (MHTFNG), con su id STL. */
const FLIGHTS = {
  out: { id: 8, flight: '3309', from: 'JFK', to: 'FLL', dep: '2021-03-30T11:45:00', arr: '2021-03-30T13:00:00', dow: 2, equipment: '320', elapsed: ['01.15', 75] },
  back: { id: 9, flight: '1908', from: 'FLL', to: 'JFK', dep: '2021-04-15T12:00:00', arr: '2021-04-15T14:50:00', dow: 4, equipment: '32Q', elapsed: ['02.50', 170] },
};

/** Un `stl19:Segment` con su `Air` y su `Product`, como en el ejemplo oficial. */
function segment({ id, sequence, flight, from, to, dep, arr, dow, equipment, elapsed, status }) {
  const air = (p) =>
    [
      `<${p}:DepartureAirport>${from}</${p}:DepartureAirport>`,
      `<${p}:ArrivalAirport>${to}</${p}:ArrivalAirport>`,
      `<${p}:EquipmentType>${equipment}</${p}:EquipmentType>`,
      `<${p}:MarketingAirlineCode>B6</${p}:MarketingAirlineCode>`,
      `<${p}:MarketingFlightNumber>${flight}</${p}:MarketingFlightNumber>`,
      `<${p}:MarketingClassOfService>Y</${p}:MarketingClassOfService>`,
    ].join('');
  return [
    `<stl19:Segment sequence="${sequence}" id="${id}">`,
    `<stl19:Air id="${id}" sequence="${sequence}" segmentAssociationId="${id - 6}" isPast="false" DayOfWeekInd="${dow}" CodeShare="false" SpecialMeal="false" StopQuantity="00" SmokingAllowed="false" ResBookDesigCode="Y" Code="B6">`,
    `<stl19:DepartureAirport>${from}</stl19:DepartureAirport><stl19:DepartureAirportCodeContext>IATA</stl19:DepartureAirportCodeContext>`,
    `<stl19:ArrivalAirport>${to}</stl19:ArrivalAirport><stl19:ArrivalAirportCodeContext>IATA</stl19:ArrivalAirportCodeContext>`,
    `<stl19:OperatingAirlineCode>B6</stl19:OperatingAirlineCode><stl19:OperatingAirlineShortName>JETBLUE AIRWAYS</stl19:OperatingAirlineShortName>`,
    `<stl19:OperatingFlightNumber>${flight}</stl19:OperatingFlightNumber><stl19:EquipmentType>${equipment}</stl19:EquipmentType>`,
    `<stl19:MarketingAirlineCode>B6</stl19:MarketingAirlineCode><stl19:MarketingFlightNumber>${flight}</stl19:MarketingFlightNumber>`,
    '<stl19:OperatingClassOfService>Y</stl19:OperatingClassOfService><stl19:MarketingClassOfService>Y</stl19:MarketingClassOfService>',
    '<stl19:MarriageGrp><stl19:Ind>0</stl19:Ind><stl19:Group>0</stl19:Group><stl19:Sequence>0</stl19:Sequence></stl19:MarriageGrp><stl19:Seats/>',
    '<stl19:AirlineRefId>DCB6*AAAAAB</stl19:AirlineRefId><stl19:Eticket>true</stl19:Eticket>',
    `<stl19:DepartureDateTime>${dep}</stl19:DepartureDateTime><stl19:ArrivalDateTime>${arr}</stl19:ArrivalDateTime>`,
    `<stl19:FlightNumber>${flight}</stl19:FlightNumber><stl19:ClassOfService>Y</stl19:ClassOfService>`,
    `<stl19:ActionCode>${status}</stl19:ActionCode><stl19:NumberInParty>1</stl19:NumberInParty><stl19:SegmentSpecialRequests/>`,
    '<stl19:inboundConnection>false</stl19:inboundConnection><stl19:outboundConnection>false</stl19:outboundConnection>',
    '<stl19:ScheduleChangeIndicator>false</stl19:ScheduleChangeIndicator><stl19:SegmentBookedDate>2021-03-03T09:22:00</stl19:SegmentBookedDate>',
    `<stl19:ElapsedTime>${elapsed[0]}</stl19:ElapsedTime><stl19:AirMilesFlown>1069</stl19:AirMilesFlown>`,
    '<stl19:FunnelFlight>false</stl19:FunnelFlight><stl19:ChangeOfGauge>false</stl19:ChangeOfGauge>',
    '<stl19:Cabin Code="Y" SabreCode="Y" Name="ECONOMY" ShortName="ECONOMY" Lang="EN"/><stl19:Banner>MARKETED BY JETBLUE AIRWAYS</stl19:Banner><stl19:Informational>false</stl19:Informational>',
    '</stl19:Air>',
    `<stl19:Product id="${id}"><or114:ProductDetails productCategory="AIR"><or114:ProductName type="AIR"/><or114:Air sequence="${sequence}" segmentAssociationId="${id - 6}">`,
    air('or114'),
    '<or114:Cabin code="Y" sabreCode="Y" name="ECONOMY" shortName="ECONOMY" lang="EN"/>',
    `<or114:ElapsedTime>${elapsed[1]}</or114:ElapsedTime><or114:AirMilesFlown>1069</or114:AirMilesFlown>`,
    '<or114:FunnelFlight>false</or114:FunnelFlight><or114:ChangeOfGauge>false</or114:ChangeOfGauge>',
    '<or114:DisclosureCarrier Code="B6" DOT="false"><or114:Banner>JETBLUE AIRWAYS</or114:Banner></or114:DisclosureCarrier>',
    '<or114:AirlineRefId>DCB6*AAAAAB</or114:AirlineRefId><or114:Eticket>true</or114:Eticket>',
    `<or114:DepartureDateTime>${dep}</or114:DepartureDateTime><or114:ArrivalDateTime>${arr}</or114:ArrivalDateTime>`,
    `<or114:FlightNumber>${flight}</or114:FlightNumber><or114:ClassOfService>Y</or114:ClassOfService>`,
    `<or114:ActionCode>${status}</or114:ActionCode><or114:NumberInParty>1</or114:NumberInParty>`,
    '<or114:inboundConnection>false</or114:inboundConnection><or114:outboundConnection>false</or114:outboundConnection>',
    '<or114:ScheduleChangeIndicator>false</or114:ScheduleChangeIndicator><or114:SegmentBookedDate>2021-03-03T09:22:00</or114:SegmentBookedDate>',
    '</or114:Air></or114:ProductDetails></stl19:Product></stl19:Segment>',
  ].join('');
}

/**
 * Los segmentos de cada PNR: `[vuelo, id, estado, cambios]`. `sequence` sale del orden. Un `UN`
 * o `HX` es el vuelo viejo y el `TK` el nuevo, una hora más tarde (supuesto: el ejemplo oficial
 * solo tiene `TK`).
 */
const later = { dep: '2021-03-30T12:45:00', arr: '2021-03-30T14:00:00' };
const latest = { dep: '2021-03-30T13:45:00', arr: '2021-03-30T15:00:00' };
const PNRS = {
  official: [['out', 8, 'TK'], ['back', 9, 'TK']],
  'tk-un': [['out', 8, 'UN'], ['out', 10, 'TK', later], ['back', 9, 'HK']],
  'tk-hx': [['out', 8, 'HX'], ['out', 10, 'TK', later], ['back', 9, 'HK']],
  'tk-un-hx': [['out', 8, 'UN'], ['out', 10, 'HX', later], ['out', 12, 'TK', latest], ['back', 9, 'HK']],
  'hk-only': [['out', 8, 'HK'], ['back', 9, 'HK']],
  'tk-kk': [['out', 8, 'TK'], ['back', 9, 'KK']],
};
const segmentsOf = (rows) =>
  rows.map(([flight, id, status, change], index) => segment({ ...FLIGHTS[flight], ...change, id, sequence: index + 1, status })).join('');

/** El `stl19:Reservation` del ejemplo, con los segmentos dados. */
const reservation = (rows, { sequence = 2, updated = '2021-03-03T09:26:33', token = '43cc55510fc2e415315614135ebe16414be7c6466eacd575', receivedFrom = 'TEST' } = {}) =>
  [
    '<stl19:Reservation numberInParty="1" numberOfInfants="0" NumberInSegment="1">',
    '<stl19:BookingDetails><stl19:RecordLocator>AAAAAA</stl19:RecordLocator>',
    '<stl19:CreationTimestamp>2021-03-03T09:22:00</stl19:CreationTimestamp><stl19:SystemCreationTimestamp>2021-03-03T09:22:00</stl19:SystemCreationTimestamp>',
    `<stl19:CreationAgentID>AAA</stl19:CreationAgentID><stl19:UpdateTimestamp>${updated}</stl19:UpdateTimestamp><stl19:PNRSequence>${sequence}</stl19:PNRSequence>`,
    '<stl19:FlightsRange Start="2021-03-30T11:45:00" End="2021-04-15T14:50:00"/><stl19:DivideSplitDetails/>',
    `<stl19:EstimatedPurgeTimestamp>2021-04-15T00:00:00</stl19:EstimatedPurgeTimestamp><stl19:UpdateToken>${token}</stl19:UpdateToken></stl19:BookingDetails>`,
    '<stl19:POS AirExtras="false" InhibitCode="U"><stl19:Source BookingSource="XXXX" AgentSine="AAA" PseudoCityCode="XXXX" ISOCountry="US" AgentDutyCode="*" AirlineVendorID="AA" HomePseudoCityCode="XXXX" PrimeHostID="1S"/></stl19:POS>',
    '<stl19:PassengerReservation><stl19:Passengers><stl19:Passenger id="3" nameType="S" passengerType="ADT" nameId="01.01" nameAssocId="1" elementId="pnr-3.1">',
    '<stl19:LastName>PASAJERO</stl19:LastName><stl19:FirstName>UNO</stl19:FirstName><stl19:Seats/></stl19:Passenger></stl19:Passengers>',
    rows.length === 0 ? '<stl19:Segments/>' : `<stl19:Segments><stl19:Poc><stl19:Airport>JFK</stl19:Airport><stl19:Departure>2021-03-30T11:45:00</stl19:Departure></stl19:Poc>${segmentsOf(rows)}</stl19:Segments>`,
    '<stl19:TicketingInfo><stl19:FutureTicketing id="5" index="1" elementId="pnr-5"><stl19:Code>TAW</stl19:Code></stl19:FutureTicketing></stl19:TicketingInfo><stl19:ItineraryPricing/>',
    '</stl19:PassengerReservation>',
    `<stl19:ReceivedFrom><stl19:Name>${receivedFrom}</stl19:Name></stl19:ReceivedFrom>`,
    '<stl19:PhoneNumbers><stl19:PhoneNumber id="11" index="1" elementId="pnr-11"><stl19:CityCode>DFW</stl19:CityCode><stl19:Number>0000000</stl19:Number></stl19:PhoneNumber></stl19:PhoneNumbers>',
    '<stl19:Remarks><stl19:Remark index="1" id="6" type="REG" elementId="pnr-6"><stl19:RemarkLines><stl19:RemarkLine><stl19:Text>12354</stl19:Text></stl19:RemarkLine></stl19:RemarkLines></stl19:Remark></stl19:Remarks>',
    '<stl19:EmailAddresses/></stl19:Reservation>',
  ].join('');

const getRS = (rows) => envelope('GetReservationRQ', `<stl19:GetReservationRS ${NS} Version="1.19.0">${reservation(rows)}</stl19:GetReservationRS>`);
const AFTER = { sequence: 3, updated: '2021-03-03T09:28:49', token: 'db38e3509cf0cea43dfc0e179f7696163b198cbde1e965f', receivedFrom: 'SWS TEST' };
const updateRS = (rows, results) =>
  envelope('UpdateReservationRQ', `<stl19:UpdateReservationRS ${NS} Version="1.19.0"><stl19:Success>OK</stl19:Success>${reservation(rows, AFTER)}${results}</stl19:UpdateReservationRS>`);
const deleted = (ids) => `<stl19:Results>${ids.map((_, index) => `<stl19:UpdateResult UpdateId="${index + 1}" Status="SUCCESS"><stl19:Item op="D"/></stl19:UpdateResult>`).join('')}</stl19:Results>`;

/** Un error STL: `Errors/Error` con `Code`, `Message` y `Severity` como elementos (Sample Error Responses). */
const stlError = (root, code, message, severity = 'MODERATE') =>
  envelope(root.replace(/RS$/, 'RQ'), `<stl19:${root} ${NS} Version="1.19.0"><stl19:Errors><stl19:Error><stl19:Code>${code}</stl19:Code><stl19:Message>${message}</stl19:Message><stl19:Severity>${severity}</stl19:Severity></stl19:Error></stl19:Errors></stl19:${root}>`);
const ERRORS = 'Update Itinerary 1.19.22, Errors: la forma es la de Sample Error Responses (GetReservationRS, Code/Message/Severity como elementos, sin Success)';
const SAME = 'No hay ejemplo oficial de UpdateReservationRS con error: se supone la misma forma, con el prefijo stl19 de los ejemplos de éxito.';

const MODIFY = 'Update Itinerary 1.19.22, Modify an Air Segment, «Change Status» (MHTFNG)';
const CANCEL = 'Update Itinerary 1.19.22, Cancel Air Segments and Add Remarks (TSGZJC)';
const PAIR = 'El vuelo viejo y el TK nuevo (una hora más tarde) son supuestos: el ejemplo oficial solo tiene TK.';

const get = [
  ['official-tk', PNRS.official, `${MODIFY}: el GetReservationRS tal cual, con dos segmentos en TK (ids 8 y 9).`],
  ['tk-un', PNRS['tk-un'], `${MODIFY}, armado: cambio de horario con el vuelo viejo en UN (id 8), el nuevo en TK (id 10) y la vuelta en HK (id 9). ${PAIR} El id 10 sigue la numeración del ejemplo (supuesto).`],
  ['tk-hx', PNRS['tk-hx'], `${MODIFY}, armado: como tk-un, con el vuelo viejo en HX. ${PAIR}`],
  ['tk-un-hx', PNRS['tk-un-hx'], `${MODIFY}, armado: dos cambios de horario seguidos, con el primer vuelo en UN (id 8), el segundo en HX (id 10), el vigente en TK (id 12) y la vuelta en HK (id 9). ${PAIR}`],
  ['hk-only', PNRS['hk-only'], `${MODIFY}, armado: los dos segmentos en HK y ningún TK (para noop).`],
  ['error-pnr-not-found', null, `${ERRORS}: «Invalid Locator in RQ message» tal cual (700226, MODERATE), con el prefijo stl19 de los ejemplos de éxito en vez de ns3.`],
  ['tk-kk', PNRS['tk-kk'], `${MODIFY}, armado: un TK (id 8) y un KK (id 9). Qué hace CONFIRM-ALL con un KK no está documentado (Q-139).`],
];
const update = [
  ['confirm-all-official', updateRS([['out', 8, 'HK'], ['back', 9, 'HK']], '<stl19:Results/>'), `${MODIFY}: el UpdateReservationRS tal cual, los dos segmentos en HK. Results vacío aunque el request lleva IncludeUpdateDetails="true": CONFIRM-ALL no trae UpdateResult en el ejemplo.`],
  ['confirm-all-tk-un', updateRS([['out', 8, 'UN'], ['out', 10, 'HK', later], ['back', 9, 'HK']], '<stl19:Results/>'), `${MODIFY}, armado sobre get tk-un: el TK (id 10) pasa a HK y el UN sigue. Supuesto: CONFIRM-ALL no toca el UN (Q-139). Results vacío como en el ejemplo.`],
  ['confirm-all-not-applied', updateRS([['out', 8, 'UN'], ['out', 10, 'TK', later], ['back', 9, 'HK']], '<stl19:Results/>'), `${MODIFY}, armado sobre get tk-un: Success OK pero el id 10 sigue en TK, para NOT_APPLIED. Nunca se vio así en Sabre.`],
  ['delete-un', updateRS([['out', 10, 'TK', later], ['back', 9, 'HK']], deleted([8])), `${CANCEL}, armado sobre get tk-un: ProductUpdate id="8" op="D" borra el UN y queda un UpdateResult SUCCESS con Item op="D", como en el ejemplo. Supuesto: op="D" borra un UN igual que el HK del ejemplo (Q-140).`],
  ['delete-hx', updateRS([['out', 10, 'TK', later], ['back', 9, 'HK']], deleted([8])), `${CANCEL}, armado sobre get tk-hx: borra el HX (id 8), con un UpdateResult SUCCESS. Supuesto: op="D" borra un HX igual que un HK (Q-140).`],
  ['delete-un-hx', updateRS([['out', 12, 'TK', latest], ['back', 9, 'HK']], deleted([8, 10])), `${CANCEL}, armado sobre get tk-un-hx: dos ProductUpdate op="D" (ids 8 y 10, UpdateId 1 y 2) en un solo request, con un UpdateResult SUCCESS por cada uno, como el borrado y el remark del ejemplo. Supuesto (Q-140).`],
  ['error-orchestration-cancel', stlError('UpdateReservationRS', '700432', 'Reservation Orchestration Error Caused by: [Unable to cancel segment : Host return not valid response: UNABLE TO CANCEL - AIRLINE DENIES CANCELLATION]'), `${ERRORS}. Código y texto de Fault Errors (700432, el ejemplo oficial es una baja rechazada). Severity supuesta (MODERATE, como en los ejemplos). ${SAME}`],
  ['error-aaa-modified', stlError('UpdateReservationRS', '700411', 'The PNR in the AAA has been modified'), `${ERRORS}. Código y texto de Fault Errors (700411). Severity supuesta. ${SAME}`],
  ['error-no-pnr-in-aaa', stlError('UpdateReservationRS', '700408', 'No PNR in AAA'), `${ERRORS}. Código y texto de Fault Errors (700408: un Update Stateful sin Get previo). Severity supuesta. ${SAME}`],
  ['error-ignore-or-commit', stlError('UpdateReservationRS', '500810', 'UNABLE TO MODIFY - PLEASE IGNORE OR COMMIT CURRENT TRANSACTION'), `${ERRORS}. Código y texto de Error Messages (500810, tabla de lodging; se supone que también sale con un segmento aéreo). Severity supuesta. ${SAME}`],
  ['delete-not-applied', updateRS([['out', 8, 'UN'], ['out', 10, 'TK', later], ['back', 9, 'HK']], deleted([8])), `${CANCEL}, armado sobre get tk-un: Success y UpdateResult SUCCESS pero el id 8 sigue en el PNR, para NOT_APPLIED. Nunca se vio así en Sabre.`],
];

const write = (name, operation, cases, source) => {
  const fixture = {
    recordedAt: '2026-11-19',
    environment: 'synthetic',
    scenario: 'guide',
    source,
    responses: cases.map(([label, body, from]) => ({ operation, label, source: from, status: 200, body })),
  };
  writeFileSync(`${root}${name}.synthetic-guide.json`, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${name}: ${cases.length} sobres`);
};
const BASE = 'Sobres armados para ADR-034 (#267) a partir de los ejemplos oficiales de Update Itinerary 1.19.22, en el sobre SOAP de trip-search.sandbox-validate.json. Ninguno se vio en Sabre (ver source de cada uno).';
const getBody = (label, rows) => (rows === null ? stlError('GetReservationRS', '700226', 'PNR not found, caused by [PNR not found, code: 100123, severity: MODERATE]') : getRS(rows));
write('get-reservation', 'reservation.getReservation', get.map(([label, rows, from]) => [label, getBody(label, rows), from]), BASE);
write('update-reservation', 'reservation.updateReservation', update, BASE);
