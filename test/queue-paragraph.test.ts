import { describe, expect, it } from 'vitest';
import { parseQueueParagraph } from '../src/index.js';

// Párrafos sintéticos: la forma sigue el design de QueueAccessLLSRS 2.1.1 y los samples de Sabre,
// con nombres, localizadores, PCC y boletos inventados. Ningún dato es de un pasajero real.
const REFERENCE = '2026-11-01';

const FULL = [
  '035  NO PIC CODE',
  '011  SEE REMARKS',
  'X1Y2  200  DISPLAYX',
  '',
  ' 1.1PRUEBA/ANA MS  2.1PRUEBA/LUIS MR*ADT',
  '',
  ' 1 XX 123Y 15DEC 2 MEXCUN HK1  0700  0915  /DCXX*ABCDEF /E',
  ' 2 XX 124Y 03JAN 6 CUNMEX HX1  1120A  140P /E',
  ' 3  CAR ZZ 15DEC Q GK1  CUN/18DEC/ECAR/RG-USD35.00 UNL DY/CF-12',
  '45678-',
  '',
  'TKT/TIME LIMIT',
  '  1.TAW10DEC/',
  '  2.TE 9990000000001-AT PRUEBA/A Q1W2*AAA 1015/20OCT*',
  '',
  'PHONES',
  '  1.MEX555-000-0000-A',
  '',
  'REMARKS',
  '  1.ADTK BY 05DEC OR AUTO CXL',
  '',
  'RECEIVED FROM - ANA',
  'Q1W2.Q1W2*AAA 1015/20OCT26 ZXCVBN H',
];

describe('parseQueueParagraph', () => {
  it('extrae las secciones estándar de un PNR', () => {
    const parsed = parseQueueParagraph(FULL, { referenceDate: REFERENCE });

    expect(parsed.messages).toEqual([
      { instructionCode: 35, text: 'NO PIC CODE' },
      { instructionCode: 11, text: 'SEE REMARKS' },
    ]);
    expect(parsed.passengers).toEqual([
      { nameNumber: '1.1', surname: 'PRUEBA', givenName: 'ANA MS', text: 'PRUEBA/ANA MS' },
      { nameNumber: '2.1', surname: 'PRUEBA', givenName: 'LUIS MR', nameRemark: 'ADT', text: 'PRUEBA/LUIS MR*ADT' },
    ]);
    expect(parsed.segments).toEqual([
      {
        kind: 'air',
        number: 1,
        date: '2026-12-15',
        status: 'HK',
        quantity: 1,
        airlineCode: 'XX',
        flightNumber: 123,
        bookingClass: 'Y',
        fromAirportCode: 'MEX',
        toAirportCode: 'CUN',
        departureTime: '07:00',
        arrivalTime: '09:15',
        text: '1 XX 123Y 15DEC 2 MEXCUN HK1  0700  0915  /DCXX*ABCDEF /E',
      },
      expect.objectContaining({
        kind: 'air',
        number: 2,
        date: '2027-01-03',
        status: 'HX',
        departureTime: '11:20',
        arrivalTime: '13:40',
      }),
      {
        kind: 'other',
        number: 3,
        date: '2026-12-15',
        status: 'GK',
        quantity: 1,
        segmentType: 'CAR',
        vendorCode: 'ZZ',
        text: '3  CAR ZZ 15DEC Q GK1  CUN/18DEC/ECAR/RG-USD35.00 UNL DY/CF-12',
      },
    ]);
    expect(parsed.ticketing).toEqual({
      entries: [
        { number: 1, code: 'TAW', date: '2026-12-10', text: 'TAW10DEC/' },
        {
          number: 2,
          code: 'TE',
          ticketNumber: '9990000000001',
          text: 'TE 9990000000001-AT PRUEBA/A Q1W2*AAA 1015/20OCT*',
        },
      ],
      issued: true,
    });
    expect(parsed.receivedFrom).toEqual({
      name: 'ANA',
      pseudoCityCode: 'Q1W2',
      agentSine: 'AAA',
      receivedAt: '2026-10-20T10:15',
      locator: 'ZXCVBN',
    });
  });

  it('manda a unparsed lo que no reconoce, tal cual y en orden, sin las líneas vacías', () => {
    const { unparsed } = parseQueueParagraph(FULL, { referenceDate: REFERENCE });
    expect(unparsed).toEqual([
      'X1Y2  200  DISPLAYX',
      '45678-',
      'PHONES',
      '  1.MEX555-000-0000-A',
      'REMARKS',
      '  1.ADTK BY 05DEC OR AUTO CXL',
    ]);
  });

  it('no extrae plazos en texto libre de la aerolínea', () => {
    const parsed = parseQueueParagraph(
      ['1.1PRUEBA/ANA', ' 1 XX 123Y 15DEC 2 MEXCUN HK1', 'GENERAL FACTS', ' 1.SSR ADTK 1S TKT BY 10DEC BEFORE 1200'],
      { referenceDate: REFERENCE },
    );
    expect(parsed.ticketing).toBeUndefined();
    expect(parsed.unparsed).toEqual(['GENERAL FACTS', ' 1.SSR ADTK 1S TKT BY 10DEC BEFORE 1200']);
  });

  describe('fechas', () => {
    it('resuelve segmentos y ticketing con la fecha más cercana, cruzando el año', () => {
      const parsed = parseQueueParagraph(
        [' 1 XX 123Y 05JAN 2 MEXCUN HK1', ' 2 XX 124Y 20DEC 6 CUNMEX HK1', 'TKT/TIME LIMIT', '  1.T-28DEC-Q1W2*AAA'],
        { referenceDate: '2026-12-30' },
      );
      expect(parsed.segments.map((segment) => segment.date)).toEqual(['2027-01-05', '2026-12-20']);
      expect(parsed.ticketing?.entries[0]).toEqual({
        number: 1,
        code: 'T-',
        date: '2026-12-28',
        pseudoCityCode: 'Q1W2',
        agentSine: 'AAA',
        text: 'T-28DEC-Q1W2*AAA',
      });
    });

    it('usa el año de la firma si lo trae, aunque sea futuro respecto de la referencia', () => {
      const { receivedFrom } = parseQueueParagraph(['Q1W2.Q1W2*AAA 2359/31DEC26 ZXCVBN H'], {
        referenceDate: '2027-01-01',
      });
      expect(receivedFrom?.receivedAt).toBe('2026-12-31T23:59');
    });

    it('acepta un Date como referencia', () => {
      const parsed = parseQueueParagraph([' 1 XX 123Y 29FEB 4 MEXCUN HK1'], {
        referenceDate: new Date('2027-12-01T12:00:00Z'),
      });
      expect(parsed.segments[0]?.date).toBe('2028-02-29');
    });

    it('deja el segmento sin date si el año no se puede resolver', () => {
      const parsed = parseQueueParagraph([' 1 XX 123Y 29FEB 4 MEXCUN HK1'], { referenceDate: REFERENCE });
      expect(parsed.segments).toHaveLength(1);
      expect(parsed.segments[0]).not.toHaveProperty('date');
    });
  });

  describe('avisos de cola', () => {
    it('solo los reconoce al principio del párrafo', () => {
      const parsed = parseQueueParagraph(['011  SEE REMARKS', '1.1PRUEBA/ANA', '035  NO PIC CODE'], {
        referenceDate: REFERENCE,
      });
      expect(parsed.messages).toEqual([{ instructionCode: 11, text: 'SEE REMARKS' }]);
      expect(parsed.unparsed).toEqual(['035  NO PIC CODE']);
    });
  });

  describe('nombres', () => {
    it('acepta un nombre sin nombre de pila y uno con espacios en el apellido', () => {
      const { passengers } = parseQueueParagraph(['1.1PRUEBA  2.1DE LA PRUEBA/ANA'], { referenceDate: REFERENCE });
      expect(passengers).toEqual([
        { nameNumber: '1.1', surname: 'PRUEBA', text: 'PRUEBA' },
        { nameNumber: '2.1', surname: 'DE LA PRUEBA', givenName: 'ANA', text: 'DE LA PRUEBA/ANA' },
      ]);
    });

    it('no los busca después de los segmentos', () => {
      const parsed = parseQueueParagraph([' 1 XX 123Y 15DEC 2 MEXCUN HK1', '2.1PRUEBA/ANA'], {
        referenceDate: REFERENCE,
      });
      expect(parsed.passengers).toEqual([]);
      expect(parsed.unparsed).toEqual(['2.1PRUEBA/ANA']);
    });
  });

  describe('segmentos', () => {
    it('reconoce NO ITIN como un itinerario vacío', () => {
      const parsed = parseQueueParagraph(['1.1PRUEBA/ANA', 'NO ITIN'], { referenceDate: REFERENCE });
      expect(parsed.segments).toEqual([]);
      expect(parsed.unparsed).toEqual([]);
    });

    it('lee las horas de 12 horas, mediodía y medianoche', () => {
      const parsed = parseQueueParagraph(
        [
          ' 1 XX   7Y 15DEC 2 MEXCUN UN1  1200N  1200M',
          ' 2 XX  77Y 15DEC 2 MEXCUN UN1   940A 1211P',
          ' 3 XX 777Y 15DEC 2 MEXCUN UN1  1230A 2500',
        ],
        { referenceDate: REFERENCE },
      );
      expect(parsed.segments.map((segment) => segment.kind === 'air' && [segment.departureTime, segment.arrivalTime])).toEqual([
        ['12:00', '00:00'],
        ['09:40', '12:11'],
        ['00:30', undefined],
      ]);
    });

    it('acepta un segmento sin horas', () => {
      const [segment] = parseQueueParagraph([' 1 XX 123Y 15DEC 2 MEXCUN HK2'], { referenceDate: REFERENCE }).segments;
      expect(segment).toEqual(expect.objectContaining({ quantity: 2 }));
      expect(segment).not.toHaveProperty('departureTime');
    });
  });

  describe('ticketing', () => {
    it('lee T- sin fecha y un TAW con PCC y cola, sin marcar emitido', () => {
      const { ticketing } = parseQueueParagraph(['TKT/TIME LIMIT', '1.T-/', '2.TAWQ1W210DEC009/'], {
        referenceDate: REFERENCE,
      });
      expect(ticketing).toEqual({
        entries: [
          { number: 1, code: 'T-', text: 'T-/' },
          { number: 2, code: 'TAW', date: '2026-12-10', pseudoCityCode: 'Q1W2', text: 'TAWQ1W210DEC009/' },
        ],
        issued: false,
      });
    });

    it('manda a unparsed una entrada que no reconoce, y sigue en la sección', () => {
      const parsed = parseQueueParagraph(['TKT/TIME LIMIT', '1.ZZZ', '2.TK 9990000000002 PRUEBA/A'], {
        referenceDate: REFERENCE,
      });
      expect(parsed.unparsed).toEqual(['1.ZZZ']);
      expect(parsed.ticketing?.entries).toEqual([
        { number: 2, code: 'TK', ticketNumber: '9990000000002', text: 'TK 9990000000002 PRUEBA/A' },
      ]);
      expect(parsed.ticketing?.issued).toBe(true);
    });
  });

  describe('recibido y firma', () => {
    it('toma la última línea de firma y deja las anteriores en unparsed', () => {
      const parsed = parseQueueParagraph(
        ['Q1W2.Q1W2*AAA 0900/01OCT26 AAAAAA H', 'RECEIVED FROM - PRUEBA', 'Q1W2.Q1W2*BBB 1000/02OCT26 BBBBBB H'],
        { referenceDate: REFERENCE },
      );
      expect(parsed.receivedFrom).toEqual({
        name: 'PRUEBA',
        pseudoCityCode: 'Q1W2',
        agentSine: 'BBB',
        receivedAt: '2026-10-02T10:00',
        locator: 'BBBBBB',
      });
      expect(parsed.unparsed).toEqual(['Q1W2.Q1W2*AAA 0900/01OCT26 AAAAAA H']);
    });

    it('lee una firma sin * y sin RECEIVED FROM', () => {
      const { receivedFrom } = parseQueueParagraph(['Q1W.Q1W8ABC1 1119/18JUL24 ZXCVBN H'], { referenceDate: REFERENCE });
      expect(receivedFrom).toEqual({ pseudoCityCode: 'Q1W', receivedAt: '2024-07-18T11:19', locator: 'ZXCVBN' });
    });

    it('acepta un RECEIVED FROM vacío', () => {
      const { receivedFrom } = parseQueueParagraph(['RECEIVED FROM -'], { referenceDate: REFERENCE });
      expect(receivedFrom).toEqual({});
    });
  });

  describe('entrada', () => {
    it('devuelve todo vacío con un párrafo vacío', () => {
      expect(parseQueueParagraph([], { referenceDate: REFERENCE })).toEqual({
        messages: [],
        passengers: [],
        segments: [],
        unparsed: [],
      });
    });

    it('no lanza con líneas raras', () => {
      const lines = ['', '   ', '1.', '1.1', '1.1/', 'TKT/TIME LIMIT', '1.', 'RECEIVED FROM', ' 99 ', '‡'];
      expect(() => parseQueueParagraph(lines, { referenceDate: REFERENCE })).not.toThrow();
      expect(() => parseQueueParagraph([1, null] as unknown as string[], { referenceDate: REFERENCE })).not.toThrow();
    });

    it('lanza TypeError si falta referenceDate o lines no es un array', () => {
      expect(() => parseQueueParagraph([], {} as never)).toThrow(TypeError);
      expect(() => parseQueueParagraph([], undefined as never)).toThrow(TypeError);
      expect(() => parseQueueParagraph([], { referenceDate: 'mañana' })).toThrow(TypeError);
      expect(() => parseQueueParagraph('011  SEE REMARKS' as never, { referenceDate: REFERENCE })).toThrow(TypeError);
    });
  });
});
