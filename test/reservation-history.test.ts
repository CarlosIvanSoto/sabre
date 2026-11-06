// session.reservation.history (#164, B1 de ADR-027) contra el sample del design 2.4.0 y la
// respuesta grabada en CERT en F0.1 (#154, 2026-11-06, scripts/validate-activity.mjs history).
import { describe, expect, it, vi } from 'vitest';
import { SabreBusinessError, SabreGatewayError, SabreWarning } from '../src/index.js';
import { reservationHistoryPayload } from '../src/reservation/reservation-history.js';
import cert from './fixtures/activity.sandbox-history.json';
import inQueue from './fixtures/activity.sandbox-history-in-queue.json';
import { mockFetch } from './helpers.js';
import { entry, legacyClient, rejection, SESSION_TOKEN, sentBody, sentTag, sessionOpened, soap, success, xml } from './soap-helpers.js';

const STL = 'xmlns:stl="http://services.sabre.com/STL/v01"';
const NS = 'xmlns="http://webservices.sabre.com/sabreXML/2011/10"';

/** El sample de response del design 2.4.0 (raw/sources/TravelItineraryHistoryLLSRQ_v2.4.0_Sample_Payloads.xml), tal cual. */
const DOC_SAMPLE = `<TravelItineraryHistoryRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" Version="2.4.0" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:stl="http://services.sabre.com/STL/v01"><stl:ApplicationResults status="Complete"><stl:Success timeStamp="2026-04-24T15:25:37-06:00"/></stl:ApplicationResults><HistoricalInfo RPH="1"><ItineraryInfo><ReservationItems><Item RPH="1"><FlightSegment Action="XS" ArrivalDateTime="04-29T10:40" DepartureDateTime="04-29T06:00" eTicket="true" FlightNumber="2032" NumberInParty="02" ResBookDesigCode="Y" Status="HKNN"><DestinationLocation LocationCode="DFW"/><MarketingAirline Code="AA" FlightNumber="2032"/><OriginLocation LocationCode="LAS"/><SupplierRef ID="DCAA*DVDMYA"/></FlightSegment></Item></ReservationItems></ItineraryInfo><ItineraryRef><Source AAAPseudoCityCode="IH9A" CreateDateTime="2011-12-05T16:06" CreationAgent="W1" PseudoCityCode="IH9A" ReceivedFrom="P"/></ItineraryRef></HistoricalInfo><HistoricalInfo RPH="2"><ItineraryInfo><ReservationItems><Item RPH="3"><Vehicle Action="AS" Status="HK" Type="CAR"><ConfirmationNumber>SZZZ000A4D-</ConfirmationNumber><VehRentalCore PickUpDateTime="04-22T09:00" Quantity="01" ReturnDateTime="04-24T12:00"><LocationDetails LocationCode="DFW"/></VehRentalCore><VehVendorAvail><VehResCore><PricedEquip><Equipment EquipType="ECAR" Quantity="01"/></PricedEquip><RentalRate Changed="C" GuaranteedQuoted="G" RateCode="D3" STM_RatePlan="D3"><Vehicle><VehType>ECAR</VehType></Vehicle></RentalRate><VehicleCharges><VehicleCharge Amount="USD12.00 UNL DY XD30.00 UNL XH10.00 UNL"><ChargeDetails><ApproximateTotalCharge Amount="12.00" MileageAllowance="UNL" RateType="DAILY RATE"/><ApproximateTotalCharge Amount="10.00" MileageAllowance="UNL" RateType="EXTRA HOUR"/><ApproximateTotalCharge Amount="30.00" MileageAllowance="UNL" RateType="EXTRA DAY"/><ApproximateTotalCharge Amount="79.65" MileageAllowance="UNL" NumDays="3" NumHours="0" RateType="APPROXIMATE TOTAL PRICE" TotalMandatoryCharges="43.65"/></ChargeDetails><Commission Amount="4.32" Percent="12.000"/><Mileage CurrencyCode="USD"/></VehicleCharge></VehicleCharges></VehResCore><Vendor Code="EZ"/></VehVendorAvail></Vehicle></Item></ReservationItems></ItineraryInfo><ItineraryRef><Source AAAPseudoCityCode="IH9A" CreateDateTime="2011-12-05T15:56" CreationAgent="W1" PseudoCityCode="IH9A" ReceivedFrom="P"/></ItineraryRef></HistoricalInfo></TravelItineraryHistoryRS>`;

interface Fixture {
  responses: Array<{ operation: string; status: number; body: string }>;
}

const recorded = (fixture: Fixture) => {
  const response = fixture.responses.find((r) => r.operation === 'probe.itineraryHistory');
  if (response === undefined) throw new Error('la fixture no tiene probe.itineraryHistory');
  return xml(response.status, response.body);
};
const historyRS = (inner: string) => `<TravelItineraryHistoryRS ${NS} ${STL} Version="2.4.0">${inner}</TravelItineraryHistoryRS>`;
const complete = `<stl:ApplicationResults status="Complete">${success}</stl:ApplicationResults>`;

async function openWith(...responses: Array<Response | Error>) {
  const fetch = mockFetch(sessionOpened(), ...responses);
  const session = await legacyClient(fetch).client.openSession();
  return { fetch, session };
}

describe('reservation.history: request', () => {
  it('manda TravelItineraryHistoryRQ 2.4.0 con el localizador y el token de la sesión', async () => {
    const { fetch, session } = await openWith(xml(200, soap(DOC_SAMPLE)));
    await session.reservation.history('ABC123');

    const envelope = sentBody(fetch, 1);
    expect(sentTag(envelope, 'eb:Action')).toBe('TravelItineraryHistoryLLSRQ');
    expect(envelope).toContain(
      '<soap-env:Body><TravelItineraryHistoryRQ Version="2.4.0" xmlns="http://webservices.sabre.com/sabreXML/2011/10"><UniqueID ID="ABC123"/></TravelItineraryHistoryRQ></soap-env:Body>',
    );
    expect(envelope).toContain(`>${SESSION_TOKEN}</wsse:BinarySecurityToken>`);
    expect(reservationHistoryPayload('ABC123')).toContain('<UniqueID ID="ABC123"/>');
  });

  it.each([['abc123'], ['ABC12'], ['ABC1234'], ['ABC 12'], [''], [undefined], [123456]])(
    'un localizador inválido (%j) lanza TypeError sin red',
    async (locator) => {
      const { fetch, session } = await openWith();
      const error = await rejection(session.reservation.history(locator as string));
      expect(error).toEqual(new TypeError('sabre-client: reservation.history necesita un localizador de 6 caracteres alfanuméricos en mayúscula'));
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('es idempotente: se reintenta ante un fallo de red', async () => {
    const { fetch, session } = await openWith(new TypeError('fetch failed'), xml(200, soap(DOC_SAMPLE)));
    const result = await session.reservation.history('ABC123', { retry: { maxRetries: 1, baseDelayMs: 0 } });
    expect(result.transactions).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('entrega la respuesta cruda como reservation.history, con el token redactado', async () => {
    const onRawResponse = vi.fn();
    const { session } = await openWith(xml(200, soap(DOC_SAMPLE)));
    await session.reservation.history('ABC123', { onRawResponse });
    expect(onRawResponse.mock.calls[0]?.[0]).toMatchObject({ operation: 'reservation.history', protocol: 'soap', status: 200 });
    expect(onRawResponse.mock.calls[0]?.[0].body).not.toContain(SESSION_TOKEN);
  });

  it('no toca el estado de cola de la sesión', async () => {
    const { session } = await openWith(xml(200, soap(DOC_SAMPLE)));
    await session.reservation.history('ABC123');
    expect(session.queue.state).toBe('outside');
  });
});

describe('reservation.history: respuestas', () => {
  it('lee el sample del design: segmento XS con su estado, AAAPseudoCityCode sin guion bajo', async () => {
    const { session } = await openWith(xml(200, soap(DOC_SAMPLE)));
    const { transactions, warnings } = await session.reservation.history('ABC123');

    expect(warnings).toEqual([]);
    expect(transactions[0]).toEqual({
      rph: 1,
      createdAt: '2011-12-05T16:06',
      agent: 'W1',
      pcc: 'IH9A',
      aaaPcc: 'IH9A',
      receivedFrom: 'P',
      flightSegments: [
        {
          action: 'XS',
          status: 'HKNN',
          marketingAirline: 'AA',
          flightNumber: '2032',
          bookingClass: 'Y',
          origin: 'LAS',
          destination: 'DFW',
          departureDateTime: '04-29T06:00',
          arrivalDateTime: '04-29T10:40',
          numberInParty: 2,
          supplierRef: 'DCAA*DVDMYA',
        },
      ],
      generalInfo: [],
      remarks: [],
      accounting: [],
    });
    // El auto del RPH 2 no se tipa: queda en la respuesta cruda.
    expect(transactions[1]).toMatchObject({ rph: 2, createdAt: '2011-12-05T15:56', flightSegments: [], generalInfo: [] });
  });

  it('lee la forma de CERT: AAA_PseudoCityCode, GeneralInfo con Action y duty code', async () => {
    const { session } = await openWith(recorded(cert));
    const { transactions } = await session.reservation.history('ABC123');

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      createdAt: '2026-11-04T17:15',
      aaaPcc: 'XXX',
      agentDutyCode: 'X',
      agentFunctionCode: 'X',
      generalInfo: [{ action: 'A4S', text: 'XXX XXXX 9X XX99 XX XXXX XXXXXX XX XX XXX XX 9999 99XXX XXX' }],
    });
    expect(transactions[1]!.generalInfo.map((info) => info.action)).toEqual(['A9', 'A9', 'AN', 'A7', 'APE', 'APE', 'ADT']);
    expect(transactions[1]!.flightSegments).toEqual([
      expect.objectContaining({ action: 'AS', departureDateTime: '12-19T13:10', origin: 'XXX', numberInParty: 99 }),
    ]);
    expect(transactions[1]).toMatchObject({ agentDutyCode: '*', createdAt: '2026-11-04T16:26' });
  });

  it('lee remarks y contabilidad, y junta varias líneas de Text', async () => {
    const payload = historyRS(
      `${complete}<HistoricalInfo RPH="3"><AccountingInfo Action="HK" LinkCode="1" Type="R"/><GeneralInfo Action="XX"><Text>LINEA 1</Text><Text>LINEA 2</Text></GeneralInfo><RemarkInfo><Remark Action="H"><Text>UN REMARK</Text></Remark></RemarkInfo></HistoricalInfo>`,
    );
    const { session } = await openWith(xml(200, soap(payload)));
    const [transaction] = (await session.reservation.history('ABC123')).transactions;
    expect(transaction).toEqual({
      rph: 3,
      flightSegments: [],
      generalInfo: [{ action: 'XX', text: 'LINEA 1\nLINEA 2' }],
      remarks: [{ action: 'H', text: 'UN REMARK' }],
      accounting: [{ action: 'HK', type: 'R', linkCode: '1' }],
    });
  });

  it('sin HistoricalInfo devuelve una lista vacía', async () => {
    const { session } = await openWith(xml(200, soap(historyRS(complete))));
    expect((await session.reservation.history('ABC123')).transactions).toEqual([]);
  });

  it('los stl:Warning no lanzan', async () => {
    const payload = historyRS(`<stl:ApplicationResults status="Complete">${success}${entry('Warning', 'WARN.SWS.HOST.WARNING_RETURNED', 'ALGO')}</stl:ApplicationResults>`);
    const { session } = await openWith(xml(200, soap(payload)));
    const { warnings } = await session.reservation.history('ABC123');
    expect(warnings[0]).toBeInstanceOf(SabreWarning);
    expect(warnings[0]).toMatchObject({ service: 'itineraryHistory' });
  });

  it('un stl:Error (un PNR que no existe) es un SabreBusinessError de itineraryHistory', async () => {
    const payload = historyRS(`<stl:ApplicationResults status="NotProcessed">${entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'NO RECORD LOCATOR FOUND')}</stl:ApplicationResults>`);
    const { session } = await openWith(xml(200, soap(payload)));
    const error = await rejection(session.reservation.history('ABC123'));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'itineraryHistory', retryable: false });
  });

  it.each([
    ['un GeneralInfo sin Action', '<GeneralInfo><Text>X</Text></GeneralInfo>'],
    ['un Remark sin Action', '<RemarkInfo><Remark><Text>X</Text></Remark></RemarkInfo>'],
    ['un FlightSegment sin Action', '<ItineraryInfo><ReservationItems><Item><FlightSegment Status="HK"/></Item></ReservationItems></ItineraryInfo>'],
  ])('%s es un SabreGatewayError con el sobre en raw', async (_name, inner) => {
    const payload = historyRS(`${complete}<HistoricalInfo RPH="1">${inner}</HistoricalInfo>`);
    const { session } = await openWith(xml(200, soap(payload)));
    const error = await rejection(session.reservation.history('ABC123'));
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as Error).message).toMatch(/^itineraryHistory: respuesta no reconocida/);
    expect((error as SabreGatewayError).raw).toContain('<TravelItineraryHistoryRS');
  });
});

describe('reservation.history dentro de una cola (CERT, 2026-11-06, Q-102)', () => {
  const one = (operation: string) => {
    const response = (inQueue as Fixture).responses.find((r) => r.operation === operation);
    if (response === undefined) throw new Error(`la fixture no tiene ${operation}`);
    return xml(response.status, response.body);
  };

  it('Sabre lo rechaza con NAK6, la sesión sigue en la cola y ignore pasa al PNR siguiente', async () => {
    const fetch = mockFetch(one('openSession'), one('queue.access'), one('reservation.history'), one('queue.ignore'));
    const session = await legacyClient(fetch).client.openSession();
    const first = await session.queue.access({ queue: 50 });

    const error = await rejection(session.reservation.history('ABC123'));
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ service: 'itineraryHistory', retryable: false });
    expect(session.queue.state).toBe('inside');

    const next = await session.queue.ignore();
    expect(first).toMatchObject({ done: false, kind: 'pnr', item: { locator: 'AAAAAB' } });
    expect(next).toMatchObject({ done: false, kind: 'pnr', item: { locator: 'AAAAAC' } });
  });
});
