// Parser best-effort del párrafo de cola (un PNR en formato de host). Ver
// sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 3 y decisiones de la revisión).
import { referenceDay, resolveHostDate } from './host-date.js';

export interface QueueParagraphOptions {
  /**
   * Fecha contra la que se resuelve el año de las fechas sin año: un `'YYYY-MM-DD'` o un `Date`
   * (se toma el día en UTC). Es obligatoria. Ver `resolveHostDate`.
   */
  referenceDate: Date | string;
}

/** Aviso de cola del principio del párrafo: el código PIC y su descripción (`011  SEE REMARKS`). */
export interface QueueParagraphMessage {
  instructionCode: number;
  text: string;
}

/** Un nombre del PNR (`1.1TEST/SWS*FSG`). */
export interface QueueParagraphPassenger {
  /** Número de nombre, tal cual: `'1.1'`. */
  nameNumber: string;
  surname: string;
  givenName?: string;
  /** Lo que sigue al `*` del nombre. */
  nameRemark?: string;
  /** El nombre como llegó, sin el número: `'TEST/SWS*FSG'`. */
  text: string;
}

interface QueueParagraphSegmentBase {
  /** Número de segmento en el PNR. */
  number: number;
  /** Fecha ISO (`'2026-05-22'`), con el año resuelto con la regla `'nearest'`. */
  date?: string;
  /** Estado del segmento: `HK`, `HX`, `UN`, `GK`… */
  status: string;
  /** Cantidad que acompaña al estado (`HK1` → `1`). */
  quantity: number;
  /** La línea como llegó, sin espacios a los costados. */
  text: string;
}

/** Un segmento aéreo: ` 1 DL2151E 20MAR 5 MIALGA HK1  0700  1003  /DCDL*HTDHAT /E`. */
export interface QueueParagraphAirSegment extends QueueParagraphSegmentBase {
  kind: 'air';
  airlineCode: string;
  flightNumber: number;
  bookingClass: string;
  fromAirportCode: string;
  toAirportCode: string;
  /** Hora local de salida, en 24 horas (`'07:00'`). */
  departureTime?: string;
  /** Hora local de llegada, en 24 horas. Puede ser de otro día: el host no siempre lo marca. */
  arrivalTime?: string;
}

/** Un segmento no aéreo con fecha: `2  CAR ZE 22APR Q GK1  DFW/24APR/…`. */
export interface QueueParagraphOtherSegment extends QueueParagraphSegmentBase {
  kind: 'other';
  /** Tipo de segmento del host: `CAR`, `OTH`… */
  segmentType: string;
  vendorCode: string;
}

export type QueueParagraphSegment = QueueParagraphAirSegment | QueueParagraphOtherSegment;

/** Una entrada del campo de ticketing (`TKT/TIME LIMIT`). */
export interface QueueParagraphTicketingEntry {
  /** Número de la entrada: `1` en `1.T-13MAY-X6R3*N18`. */
  number: number;
  /** `'T-'`, `'TAW'` (o `TAC`, `TAM`, `TAT`, `TAX`), o `'TE'`/`'TK'` para una línea de boleto. */
  code: string;
  /** Fecha ISO de la entrada, con el año resuelto con la regla `'nearest'`. */
  date?: string;
  pseudoCityCode?: string;
  agentSine?: string;
  /** Número de boleto de una línea `TE` o `TK`. */
  ticketNumber?: string;
  /** La entrada como llegó, sin el número: `'T-13MAY-X6R3*N18'`. */
  text: string;
}

export interface QueueParagraphTicketing {
  entries: QueueParagraphTicketingEntry[];
  /** `true` si alguna entrada es una línea de boleto (`TE` o `TK`, con número). */
  issued: boolean;
}

/**
 * La línea `RECEIVED FROM - …` y la línea de firma del PNR
 * (`<PCC>.<PCC>*<agente> HHMM/DDMMMYY <localizador> H`). La firma es la de la última modificación.
 */
export interface QueueParagraphReceivedFrom {
  /** Lo que sigue a `RECEIVED FROM - `. */
  name?: string;
  /** El primer PCC de la firma. */
  pseudoCityCode?: string;
  /** La firma del agente, lo que sigue al `*`. */
  agentSine?: string;
  /** Fecha y hora de la firma, `'YYYY-MM-DDTHH:mm'`. Sin año, se resuelve hacia atrás. */
  receivedAt?: string;
  locator?: string;
}

export interface QueueParagraph {
  messages: QueueParagraphMessage[];
  passengers: QueueParagraphPassenger[];
  segments: QueueParagraphSegment[];
  /** El campo de ticketing, si el párrafo trae la sección `TKT/TIME LIMIT`. */
  ticketing?: QueueParagraphTicketing;
  /** La línea de recibido y la firma, si llega alguna de las dos. */
  receivedFrom?: QueueParagraphReceivedFrom;
  /** Las líneas que no se reconocieron, tal cual y en orden. Las líneas vacías no se incluyen. */
  unparsed: string[];
}

const MESSAGE = /^\s*(\d{3})\s{2,}(\S.*?)\s*$/;
const PASSENGER_LINE = /^\s*\d+\.\d+[A-Z]/;
const PASSENGER_SPLIT = /\s+(?=\d+\.\d+[A-Z])/;
const PASSENGER = /^(\d+\.\d+)([^/*]+?)\s*(?:\/([^*]*?))?\s*(?:\*(.*?))?\s*$/;
const AIR_SEGMENT =
  /^\s*(\d{1,2})\s+([A-Z0-9]{2})\s*(\d{1,4})([A-Z])\s+(\d{2}[A-Z]{3})\s+[A-Z0-9]\s+([A-Z]{3})([A-Z]{3})\s+([A-Z]{2})(\d{1,3})(?=\s|$)(.*)$/;
const SEGMENT_TIMES = /^\s+(\d{3,4}[APNM]?)\s+(\d{3,4}[APNM]?)(?=\s|$)/;
const OTHER_SEGMENT =
  /^\s*(\d{1,2})\s+([A-Z]{3})\s+([A-Z0-9]{2})\s+(\d{2}[A-Z]{3})\s+[A-Z0-9]\s+([A-Z]{2})(\d{1,3})(?=\s|$)/;
const NO_ITINERARY = /^\s*NO ITIN\s*$/;
const TICKETING_HEADER = /^\s*TKT\/TIME LIMIT\s*$/;
const TICKETING_ENTRY = /^\s*(\d+)\.(.*?)\s*$/;
const TICKETED = /^T-(\d{2}[A-Z]{3})?(?:-([A-Z0-9]{3,4})\*([A-Z0-9]+))?(?:\/.*)?$/;
const ARRANGEMENT = /^(TA[WCMTX])([A-Z0-9]{3,4})?(\d{2}[A-Z]{3})?\d{0,3}\/.*$/;
const TICKET = /^(TE|TK)\s+(\d{13})\b/;
const RECEIVED = /^\s*RECEIVED FROM -\s?(.*?)\s*$/;
const SIGNATURE = /^\s*([A-Z0-9]{3,4})\.(\S+)\s+(\d{2})(\d{2})\/(\d{2}[A-Z]{3}\d{2})\s+([A-Z0-9]{6})\s+H\s*$/;

/** En qué parte del párrafo va el parser: cada sección solo se reconoce hasta que empieza la siguiente. */
const Phase = { Messages: 0, Passengers: 1, Segments: 2, Body: 3 } as const;
type Phase = (typeof Phase)[keyof typeof Phase];

/**
 * Lee un párrafo de cola (`QueueItem.paragraph`) y extrae las secciones estándar de un PNR en
 * formato de host: los avisos de cola, los nombres, los segmentos con su estado, el campo de
 * ticketing y la línea de recibido con la firma.
 *
 * **Es best-effort**: el formato de host no tiene contrato. Una línea que no reconoce va a
 * `unparsed` y nunca lanza por el contenido del párrafo. Solo lanza `TypeError` si `lines` no es
 * un array o si `referenceDate` falta o no es válida.
 *
 * **No extrae** los plazos escritos en texto libre por la aerolínea (`ADTK BY`, `BEFORE` en
 * remarks, SSR u OSI): su formato lo pone cada aerolínea. Esas líneas van a `unparsed`.
 *
 * Las fechas salen como strings ISO sin zona horaria. Los segmentos y el ticketing toman la fecha
 * más cercana a `referenceDate` dentro de ±6 meses, y la firma se resuelve hacia atrás.
 *
 * **Versionado**: que una línea pase de `unparsed` a un campo nuevo es un cambio minor. Que cambie
 * la forma de un campo existente es major.
 */
export function parseQueueParagraph(lines: readonly string[], options: QueueParagraphOptions): QueueParagraph {
  if (!Array.isArray(lines)) throw new TypeError('sabre-client: lines debe ser un array de strings');
  if (typeof options !== 'object' || options === null) {
    throw new TypeError("sabre-client: referenceDate es obligatoria, como 'YYYY-MM-DD' o un Date válido");
  }
  const { referenceDate } = options;
  referenceDay(referenceDate);

  const result: QueueParagraph = { messages: [], passengers: [], segments: [], unparsed: [] };
  const signatureIndex = lastSignatureIndex(lines);
  let phase: Phase = Phase.Messages;
  let inTicketing = false;

  lines.forEach((value, index) => {
    const line = typeof value === 'string' ? value : '';
    if (line.trim() === '') return;

    if (index === signatureIndex) {
      result.receivedFrom = { ...result.receivedFrom, ...parseSignature(line, referenceDate) };
      return;
    }

    if (inTicketing) {
      const entry = TICKETING_ENTRY.exec(line);
      if (entry !== null) {
        const parsed = parseTicketingEntry(Number(entry[1]), entry[2]!, referenceDate);
        if (parsed === undefined) result.unparsed.push(line);
        else result.ticketing!.entries.push(parsed);
        return;
      }
      inTicketing = false;
    }

    if (TICKETING_HEADER.test(line)) {
      phase = Phase.Body;
      inTicketing = true;
      result.ticketing ??= { entries: [], issued: false };
      return;
    }

    const received = RECEIVED.exec(line);
    if (received !== null) {
      phase = Phase.Body;
      result.receivedFrom = { ...result.receivedFrom, ...(received[1] !== '' && { name: received[1]! }) };
      return;
    }

    if (phase === Phase.Messages) {
      const message = MESSAGE.exec(line);
      if (message !== null) {
        result.messages.push({ instructionCode: Number(message[1]), text: message[2]! });
        return;
      }
    }

    if (phase <= Phase.Passengers && PASSENGER_LINE.test(line)) {
      const passengers = parsePassengers(line);
      if (passengers !== undefined) {
        phase = Phase.Passengers;
        result.passengers.push(...passengers);
        return;
      }
    }

    if (phase <= Phase.Segments) {
      if (NO_ITINERARY.test(line)) {
        phase = Phase.Segments;
        return;
      }
      const segment = parseSegment(line, referenceDate);
      if (segment !== undefined) {
        phase = Phase.Segments;
        result.segments.push(segment);
        return;
      }
    }

    result.unparsed.push(line);
  });

  if (result.ticketing !== undefined) {
    result.ticketing.issued = result.ticketing.entries.some((entry) => entry.ticketNumber !== undefined);
  }
  return result;
}

function parsePassengers(line: string): QueueParagraphPassenger[] | undefined {
  const passengers: QueueParagraphPassenger[] = [];
  for (const part of line.trim().split(PASSENGER_SPLIT)) {
    const match = PASSENGER.exec(part);
    if (match === null) return undefined;
    const [, nameNumber, surname, givenName, nameRemark] = match;
    passengers.push({
      nameNumber: nameNumber!,
      surname: surname!.trim(),
      ...(givenName !== undefined && givenName !== '' && { givenName }),
      ...(nameRemark !== undefined && nameRemark !== '' && { nameRemark }),
      text: part.slice(nameNumber!.length).trim(),
    });
  }
  return passengers;
}

function parseSegment(line: string, referenceDate: Date | string): QueueParagraphSegment | undefined {
  const air = AIR_SEGMENT.exec(line);
  if (air !== null) {
    const [, number, airlineCode, flightNumber, bookingClass, date, from, to, status, quantity, rest] = air;
    const times = SEGMENT_TIMES.exec(rest!);
    const departureTime = times === null ? undefined : hostTime(times[1]!);
    const arrivalTime = times === null ? undefined : hostTime(times[2]!);
    return {
      kind: 'air',
      number: Number(number),
      ...withDate(date!, referenceDate),
      status: status!,
      quantity: Number(quantity),
      airlineCode: airlineCode!,
      flightNumber: Number(flightNumber),
      bookingClass: bookingClass!,
      fromAirportCode: from!,
      toAirportCode: to!,
      ...(departureTime !== undefined && { departureTime }),
      ...(arrivalTime !== undefined && { arrivalTime }),
      text: line.trim(),
    };
  }

  const other = OTHER_SEGMENT.exec(line);
  if (other === null) return undefined;
  const [, number, segmentType, vendorCode, date, status, quantity] = other;
  return {
    kind: 'other',
    number: Number(number),
    ...withDate(date!, referenceDate),
    status: status!,
    quantity: Number(quantity),
    segmentType: segmentType!,
    vendorCode: vendorCode!,
    text: line.trim(),
  };
}

function parseTicketingEntry(
  number: number,
  text: string,
  referenceDate: Date | string,
): QueueParagraphTicketingEntry | undefined {
  const ticketed = TICKETED.exec(text);
  if (ticketed !== null) {
    const [, date, pseudoCityCode, agentSine] = ticketed;
    return {
      number,
      code: 'T-',
      ...(date !== undefined && withDate(date, referenceDate)),
      ...(pseudoCityCode !== undefined && { pseudoCityCode }),
      ...(agentSine !== undefined && { agentSine }),
      text,
    };
  }

  const arrangement = ARRANGEMENT.exec(text);
  if (arrangement !== null) {
    const [, code, pseudoCityCode, date] = arrangement;
    return {
      number,
      code: code!,
      ...(date !== undefined && withDate(date, referenceDate)),
      ...(pseudoCityCode !== undefined && { pseudoCityCode }),
      text,
    };
  }

  const ticket = TICKET.exec(text);
  if (ticket !== null) return { number, code: ticket[1]!, ticketNumber: ticket[2]!, text };
  return undefined;
}

/** La firma, si hay una, es la última línea con ese formato. Las anteriores van a `unparsed`. */
function lastSignatureIndex(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (typeof line === 'string' && SIGNATURE.test(line)) return index;
  }
  return -1;
}

function parseSignature(line: string, referenceDate: Date | string): QueueParagraphReceivedFrom {
  const [, pseudoCityCode, sign, hours, minutes, date, locator] = SIGNATURE.exec(line)!;
  const agentSine = /\*([A-Z0-9]+)$/.exec(sign!)?.[1];
  const day = Number(hours) <= 23 && Number(minutes) <= 59 ? resolveHostDate(date!, referenceDate) : undefined;
  return {
    pseudoCityCode: pseudoCityCode!,
    ...(agentSine !== undefined && { agentSine }),
    ...(day !== undefined && { receivedAt: `${day}T${hours}:${minutes}` }),
    locator: locator!,
  };
}

function withDate(text: string, referenceDate: Date | string): { date?: string } {
  const date = resolveHostDate(text, referenceDate, { direction: 'nearest' });
  return date === undefined ? {} : { date };
}

/**
 * Hora del host en 24 horas: `0700` y `1003` tal cual, y con sufijo `A` (a. m.), `P` (p. m.),
 * `N` (mediodía) o `M` (medianoche): `740P` → `19:40`, `1200N` → `12:00`.
 */
function hostTime(text: string): string | undefined {
  const match = /^(\d{1,2})(\d{2})([APNM])?$/.exec(text);
  if (match === null) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3];
  if (minutes > 59) return undefined;
  if (suffix === undefined) {
    if (hours > 23) return undefined;
  } else {
    if (hours < 1 || hours > 12) return undefined;
    if (suffix === 'A' || suffix === 'M') hours %= 12;
    else if (suffix === 'P') hours = (hours % 12) + 12;
    else if (hours !== 12) return undefined;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
