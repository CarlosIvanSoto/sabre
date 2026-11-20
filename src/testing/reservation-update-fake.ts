// Las escrituras de ADR-034 en el fake (#270): `GetReservationRQ`, `UpdateReservationRQ` e
// `IgnoreTransactionLLSRQ` (STL 1.19) sobre PNR sembrados con sus segmentos aéreos, para probar
// `session.reservation.confirmAirSegments` sin red. El fake guarda el estado de cada PNR: lo que
// hace el SDK (`noop`, `SEGMENTS_CHANGED`) sale de releerlo, igual que con Sabre. Ver
// sabre-wiki/wiki/proyectos/sabre-client/decisiones/confirmar-cambio-de-horario.md. Solo Web
// Standard APIs.

/** Un segmento aéreo sembrado, con los campos que el SDK lee de `Segment/Air`. */
export interface QueueFakeAirSegment {
  /** `Air@id`: el que se pasa en `expectedSegmentIds`. Único dentro del PNR. */
  id: string;
  /** `Air@sequence`: el orden en el itinerario. Por defecto, la posición en la lista (1, 2…). */
  sequence?: number;
  /** `ActionCode`: `TK`, `UN`, `HX`, `HK`, `KK`… */
  status: string;
  marketingCarrier?: string;
  flightNumber?: string;
  from?: string;
  to?: string;
  /** Hora local sin zona, como la manda Sabre (`'2021-03-30T11:45:00'`). */
  departure?: string;
  arrival?: string;
}

/** Un PNR para las escrituras de ADR-034. */
export interface QueueFakeReservation {
  /** Localizador de 6 caracteres alfanuméricos en mayúscula. */
  locator: string;
  /** Los segmentos aéreos, en el orden del PNR. */
  segments: readonly QueueFakeAirSegment[];
}

/** Las `reason` de `SabreUncertainOutcomeError` que el fake sabe producir en `UpdateReservationRQ`. */
export type QueueFakeReservationUpdateUncertainReason =
  | 'TRANSPORT'
  | 'GATEWAY_5XX'
  | 'UNPARSEABLE'
  | 'ABORTED'
  | 'END_TRANSACTION_PROBLEM'
  | 'PREVIOUS_ENTRY_ACTIVE';

/**
 * El desenlace de un `UpdateReservationRQ`. Sin forzar, `'applied'`.
 * - `'applied'`: escribe y responde `Success` con el PNR.
 * - `'notApplied'`: responde `Success` con el PNR sin cambios; el SDK avisa `NOT_APPLIED`.
 * - `{ error }`: un `Errors/Error` de Sabre sin `Success`, sin escribir. Con `700432`, `700411`,
 *   `700408` y `500810`, el texto por defecto es el de las fuentes. Después el SDK manda
 *   `IgnoreTransactionLLSRQ`.
 * - `{ uncertain, applied? }`: el SDK lanza `SabreUncertainOutcomeError` con esa `reason`.
 *   `applied` dice si el cambio queda guardado en el fake, para probar la relectura. Por
 *   defecto, sí con `END_TRANSACTION_PROBLEM` y no con las demás.
 *
 * El fake no simula el AAA: un `700408` (`No PNR in AAA`) solo sale si se fuerza como `error`.
 */
export type QueueFakeReservationUpdateOutcome =
  | 'applied'
  | 'notApplied'
  | { error: { code: string; message?: string; severity?: string } }
  | { uncertain: QueueFakeReservationUpdateUncertainReason; applied?: boolean };

export interface QueueFakeReservationUpdate {
  /** Los PNR que se pueden leer y modificar. Un localizador no sembrado da `700226` en la lectura. */
  reservations?: readonly QueueFakeReservation[];
  /**
   * Desenlaces forzados, en orden: cada `UpdateReservationRQ` que llega consume el primero que
   * queda. Un `noop` o un `SEGMENTS_CHANGED` no mandan Update, así que no consumen ninguno.
   */
  outcomes?: readonly QueueFakeReservationUpdateOutcome[];
}

/** Lo que el fake registra en `calls`. */
export type ReservationUpdateFakeCommand = 'getReservation' | 'updateReservation' | 'ignoreTransaction';

/**
 * La respuesta del manejador: el payload de un 200 SOAP, un SOAP fault (`status` 500), un 200 que
 * no es SOAP, o un fallo de `fetch` (`'transport'`, `'abort'`).
 */
export type ReservationUpdateReply =
  | { payload: string; action: string }
  | { fault: { code: string; text: string } }
  | { html: string }
  | 'transport'
  | 'abort';

type XmlNode = Record<string, unknown>;

const LOCATOR = /^[A-Z0-9]{6}$/;
const STATUS = /^[A-Z]{2}$/;
const NAMESPACE = 'http://webservices.sabre.com/pnrbuilder/v1_19';
const SABRE_XML_NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';
const UNCERTAIN_REASONS: ReadonlySet<string> = new Set<QueueFakeReservationUpdateUncertainReason>([
  'TRANSPORT',
  'GATEWAY_5XX',
  'UNPARSEABLE',
  'ABORTED',
  'END_TRANSACTION_PROBLEM',
  'PREVIOUS_ENTRY_ACTIVE',
]);

/** Los textos de las fuentes (fixtures sintéticas de #267) para los códigos conocidos. */
const KNOWN_ERRORS: Readonly<Record<string, string>> = {
  '700226': 'PNR not found, caused by [PNR not found, code: 100123, severity: MODERATE]',
  '700432': 'Reservation Orchestration Error Caused by: [Unable to cancel segment : Host return not valid response: UNABLE TO CANCEL - AIRLINE DENIES CANCELLATION]',
  '700411': 'The PNR in the AAA has been modified',
  '700408': 'No PNR in AAA',
  '500810': 'UNABLE TO MODIFY - PLEASE IGNORE OR COMMIT CURRENT TRANSACTION',
};

function fail(message: string): never {
  throw new TypeError(`sabre-client/testing: ${message}`);
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function node(value: unknown): XmlNode | undefined {
  if (Array.isArray(value)) return node(value[0]);
  return typeof value === 'object' && value !== null ? (value as XmlNode) : undefined;
}

function nodes(value: unknown): XmlNode[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(node).filter((item): item is XmlNode => item !== undefined);
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim();
  const inner = node(value)?.['#text'];
  return typeof inner === 'string' ? inner.trim() : undefined;
}

interface Segment {
  id: string;
  sequence: number;
  status: string;
  fields: Omit<QueueFakeAirSegment, 'id' | 'sequence' | 'status'>;
}

interface Stored {
  locator: string;
  segments: Segment[];
  /** `PNRSequence`: sube con cada escritura guardada. */
  sequence: number;
}

const FIELDS = ['marketingCarrier', 'flightNumber', 'from', 'to', 'departure', 'arrival'] as const;

function toReservation(value: QueueFakeReservation, label: string): Stored {
  if (typeof value !== 'object' || value === null) fail(`${label} debe ser un objeto`);
  if (typeof value.locator !== 'string' || !LOCATOR.test(value.locator)) fail(`${label}.locator debe tener 6 caracteres alfanuméricos en mayúscula`);
  if (!Array.isArray(value.segments)) fail(`${label}.segments debe ser una lista`);
  const ids = new Set<string>();
  const segments = value.segments.map((segment, index): Segment => {
    const at = `${label}.segments[${index}]`;
    if (typeof segment !== 'object' || segment === null) fail(`${at} debe ser un objeto`);
    if (typeof segment.id !== 'string' || segment.id.trim() === '') fail(`${at}.id debe ser un texto no vacío`);
    if (ids.has(segment.id)) fail(`${at}.id '${segment.id}' está repetido en el PNR`);
    ids.add(segment.id);
    if (typeof segment.status !== 'string' || !STATUS.test(segment.status)) fail(`${at}.status debe ser un ActionCode de dos letras mayúsculas (TK, HK…)`);
    const sequence = segment.sequence ?? index + 1;
    if (!Number.isInteger(sequence) || sequence < 1) fail(`${at}.sequence debe ser un entero ≥ 1`);
    const fields: Segment['fields'] = {};
    for (const key of FIELDS) {
      const found = segment[key];
      if (found === undefined) continue;
      if (typeof found !== 'string' || found === '') fail(`${at}.${key} debe ser un texto no vacío`);
      fields[key] = found;
    }
    return { id: segment.id, sequence, status: segment.status, fields };
  });
  return { locator: value.locator, segments, sequence: 1 };
}

function toOutcome(value: unknown, label: string): QueueFakeReservationUpdateOutcome {
  if (value === 'applied' || value === 'notApplied') return value;
  if (typeof value === 'object' && value !== null) {
    if ('error' in value) {
      const error = node((value as { error: unknown }).error);
      if (error === undefined || typeof error.code !== 'string' || error.code === '') fail(`${label}.error necesita un code`);
      if (error.message !== undefined && typeof error.message !== 'string') fail(`${label}.error.message debe ser un texto`);
      if (error.severity !== undefined && typeof error.severity !== 'string') fail(`${label}.error.severity debe ser un texto`);
      return value as QueueFakeReservationUpdateOutcome;
    }
    if ('uncertain' in value) {
      const { uncertain, applied } = value as { uncertain: unknown; applied?: unknown };
      if (!UNCERTAIN_REASONS.has(String(uncertain))) fail(`${label}.uncertain debe ser una de ${[...UNCERTAIN_REASONS].join(' | ')}`);
      if (applied !== undefined && typeof applied !== 'boolean') fail(`${label}.applied debe ser boolean`);
      return value as QueueFakeReservationUpdateOutcome;
    }
  }
  fail(`${label} debe ser 'applied', 'notApplied', { error } o { uncertain }`);
}

const segmentXml = (segment: Segment): string => {
  const { fields } = segment;
  const element = (name: string, value: string | undefined) => (value === undefined ? '' : `<stl19:${name}>${escape(value)}</stl19:${name}>`);
  return [
    `<stl19:Segment sequence="${segment.sequence}" id="${escape(segment.id)}">`,
    `<stl19:Air id="${escape(segment.id)}" sequence="${segment.sequence}">`,
    element('DepartureAirport', fields.from),
    element('ArrivalAirport', fields.to),
    element('MarketingAirlineCode', fields.marketingCarrier),
    element('MarketingFlightNumber', fields.flightNumber),
    element('DepartureDateTime', fields.departure),
    element('ArrivalDateTime', fields.arrival),
    element('FlightNumber', fields.flightNumber),
    element('ActionCode', segment.status),
    '</stl19:Air></stl19:Segment>',
  ].join('');
};

const reservationXml = (pnr: Stored, segments: readonly Segment[] = pnr.segments): string =>
  [
    '<stl19:Reservation numberInParty="1" numberOfInfants="0" NumberInSegment="1">',
    `<stl19:BookingDetails><stl19:RecordLocator>${pnr.locator}</stl19:RecordLocator><stl19:PNRSequence>${pnr.sequence}</stl19:PNRSequence>`,
    `<stl19:UpdateToken>sabre-client-testing-${pnr.locator}-${pnr.sequence}</stl19:UpdateToken></stl19:BookingDetails>`,
    '<stl19:PassengerReservation>',
    segments.length === 0 ? '<stl19:Segments/>' : `<stl19:Segments>${segments.map(segmentXml).join('')}</stl19:Segments>`,
    '</stl19:PassengerReservation></stl19:Reservation>',
  ].join('');

const errorXml = (code: string, message: string, severity: string) =>
  `<stl19:Errors><stl19:Error><stl19:Code>${escape(code)}</stl19:Code><stl19:Message>${escape(message)}</stl19:Message><stl19:Severity>${escape(severity)}</stl19:Severity></stl19:Error></stl19:Errors>`;

const root = (name: 'GetReservationRS' | 'UpdateReservationRS', inner: string) =>
  `<stl19:${name} xmlns:stl19="${NAMESPACE}" Version="1.19.0">${inner}</stl19:${name}>`;

const notSimulated = (detail: string): ReservationUpdateReply => ({ fault: { code: 'soap-env:Client.InvalidAction', text: `sabre-client/testing: ${detail} no está simulado` } });

/**
 * El manejador de las escrituras de ADR-034: valida la siembra al crearse. `session` es la clave
 * de la sesión SOAP: el PNR que leyó cada sesión es el que modifica su `UpdateReservationRQ`.
 */
export function createReservationUpdateHandler(
  options: QueueFakeReservationUpdate | undefined,
  record: (call: { command: ReservationUpdateFakeCommand; locator?: string; receivedFrom?: string }) => void,
) {
  if (options !== undefined && (typeof options !== 'object' || options === null)) fail('reservationUpdate debe ser un objeto');
  const stored = new Map<string, Stored>();
  for (const [index, value] of (options?.reservations ?? []).entries()) {
    const label = `reservationUpdate.reservations[${index}]`;
    const pnr = toReservation(value, label);
    if (stored.has(pnr.locator)) fail(`${label}: el PNR ${pnr.locator} está sembrado dos veces`);
    stored.set(pnr.locator, pnr);
  }
  const outcomes = (options?.outcomes ?? []).map((outcome, index) => toOutcome(outcome, `reservationUpdate.outcomes[${index}]`));
  /** El PNR que leyó cada sesión (lo que Sabre tendría en el AAA). */
  const read = new Map<string, string>();

  /** `CONFIRM-ALL`: los `TK` pasan a `HK`. */
  const confirmAll = (segments: readonly Segment[]) => segments.map((segment) => (segment.status === 'TK' ? { ...segment, status: 'HK' } : segment));

  const get = (session: string, rq: XmlNode): ReservationUpdateReply => {
    const locator = text(rq.Locator) ?? '';
    record({ command: 'getReservation', ...(locator === '' ? {} : { locator }) });
    const pnr = stored.get(locator);
    if (pnr === undefined) {
      read.delete(session);
      return { action: 'GetReservationRS', payload: root('GetReservationRS', errorXml('700226', KNOWN_ERRORS['700226']!, 'MODERATE')) };
    }
    read.set(session, locator);
    return { action: 'GetReservationRS', payload: root('GetReservationRS', reservationXml(pnr)) };
  };

  const update = (session: string, rq: XmlNode): ReservationUpdateReply => {
    const list = node(rq.ReservationUpdateList);
    const from = node(list?.ReceivedFrom);
    const receivedFrom = text(from?.Name) ?? text(from?.AgentName);
    const locator = read.get(session);
    record({ command: 'updateReservation', ...(locator === undefined ? {} : { locator }), ...(receivedFrom === undefined ? {} : { receivedFrom }) });
    const pnr = locator === undefined ? undefined : stored.get(locator);
    if (pnr === undefined) return notSimulated('UpdateReservationRQ sin un GetReservationRQ previo en la sesión');
    if (text(node(rq.RequestType)?.['@commitTransaction']) !== 'true') return notSimulated('UpdateReservationRQ sin commitTransaction="true"');

    let change = (segments: readonly Segment[]): Segment[] => [...segments];
    for (const item of nodes(list?.ReservationUpdateItem)) {
      const action = text(node(item.AirItineraryUpdate)?.Action);
      if (action !== 'CONFIRM-ALL') return notSimulated('ese ReservationUpdateItem');
      const before = change;
      change = (segments) => confirmAll(before(segments));
    }

    const outcome = outcomes.shift() ?? 'applied';
    const apply = () => {
      pnr.segments = change(pnr.segments);
      pnr.sequence += 1;
    };
    const success = (inner = '') => ({ action: 'UpdateReservationRS', payload: root('UpdateReservationRS', `<stl19:Success>OK</stl19:Success>${inner}${reservationXml(pnr)}<stl19:Results/>`) });

    if (outcome === 'applied') {
      apply();
      return success();
    }
    if (outcome === 'notApplied') return success();
    if ('error' in outcome) {
      const { code, message, severity } = outcome.error;
      return { action: 'UpdateReservationRS', payload: root('UpdateReservationRS', errorXml(code, message ?? KNOWN_ERRORS[code] ?? 'sabre-client/testing: error forzado', severity ?? 'MODERATE')) };
    }
    const { uncertain: reason } = outcome;
    if (outcome.applied ?? reason === 'END_TRANSACTION_PROBLEM') apply();
    switch (reason) {
      case 'TRANSPORT':
        return 'transport';
      case 'ABORTED':
        return 'abort';
      case 'GATEWAY_5XX':
        return { fault: { code: 'soap-env:Server.SystemError', text: 'sabre-client/testing: 500 forzado' } };
      case 'UNPARSEABLE':
        return { html: '<html>sabre-client/testing: cuerpo ilegible forzado</html>' };
      case 'END_TRANSACTION_PROBLEM':
        // Supuesto del fake: no hay fuente del texto de un `Success` con `Errors` (precisión 3).
        return success(errorXml('END_TRANSACTION_PROBLEM', 'sabre-client/testing: Success con Errors forzado', 'MODERATE'));
      case 'PREVIOUS_ENTRY_ACTIVE':
        return { action: 'UpdateReservationRS', payload: root('UpdateReservationRS', errorXml('PREVIOUS_ENTRY_ACTIVE', 'PREVIOUS ENTRY ACTIVE', 'MODERATE')) };
    }
  };

  const ignore = (session: string): ReservationUpdateReply => {
    record({ command: 'ignoreTransaction' });
    read.delete(session);
    return {
      action: 'IgnoreTransactionRS',
      payload: `<IgnoreTransactionRS xmlns="${SABRE_XML_NAMESPACE}" xmlns:stl="http://services.sabre.com/STL/v01" Version="2.0.0"><stl:ApplicationResults status="Complete"><stl:Success/></stl:ApplicationResults></IgnoreTransactionRS>`,
    };
  };

  /** Los segmentos aéreos actuales de un PNR sembrado, o `undefined` si no está. */
  const segments = (locator: string): QueueFakeAirSegment[] | undefined =>
    stored.get(locator)?.segments.map((segment) => ({ id: segment.id, sequence: segment.sequence, status: segment.status, ...segment.fields }));

  return { get, update, ignore, segments, forget: (session: string) => read.delete(session) };
}
