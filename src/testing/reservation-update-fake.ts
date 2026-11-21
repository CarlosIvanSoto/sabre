// Las escrituras de ADR-034 en el fake (#270): `GetReservationRQ`, `UpdateReservationRQ` e
// `IgnoreTransactionLLSRQ` (STL 1.19) sobre PNR sembrados con sus segmentos aéreos, para probar
// `session.reservation.confirmAirSegments` y `removeAirSegments` sin red. El fake guarda el estado de cada PNR: lo que
// hace el SDK (`noop`, `SEGMENTS_CHANGED`, `SEGMENT_NOT_FOUND`, `SEGMENT_ID_MISMATCH`,
// `SEGMENT_STATUS_NOT_ALLOWED`, `UNEXPECTED_CHANGE`) sale de releerlo, igual que con Sabre. Ver
// sabre-wiki/wiki/proyectos/sabre-client/decisiones/confirmar-cambio-de-horario.md. Solo Web
// Standard APIs.

/** Un segmento aéreo sembrado, con los campos que el SDK lee de `Segment/Air` y `Segment/Product`. */
export interface QueueFakeAirSegment {
  /** `Air@id`: el que se pasa en `expectedSegmentIds` o `segmentIds`. Único dentro del PNR. */
  id: string;
  /**
   * `Product@id`: el que borra `ProductUpdate op="D"`. Por defecto, igual a `id`, como en los
   * ejemplos oficiales. Uno distinto, o `null` para omitir `Product`, sirve para forzar
   * `SEGMENT_ID_MISMATCH` (ADR-034, precisión 11). Único dentro del PNR.
   */
  productId?: string | null;
  /**
   * `Air@sequence`: el orden en el itinerario. Por defecto, la posición en la lista (1, 2…).
   * Después de una baja, los que quedan se renumeran de 1 en adelante, como en los ejemplos.
   */
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

/** Un PNR para las escrituras de ADR-034 (`confirmAirSegments` y `removeAirSegments`). */
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
 * - `'applied'`: escribe y responde `Success` con el PNR: `CONFIRM-ALL` pasa los `TK` a `HK`, y
 *   cada `ProductUpdate op="D"` borra su segmento.
 * - `'notApplied'`: responde `Success` con el PNR sin cambios; el SDK avisa `NOT_APPLIED`. Cada
 *   baja trae su `UpdateResult` con `Status="SUCCESS"`, como la fixture `delete-not-applied`.
 * - `{ notApplied: { status? } }`: igual, pero el `UpdateResult@Status` de cada baja es `status`
 *   (p. ej. `'FAILED'`), que también suma a `NOT_APPLIED` (ADR-034, precisión 13). Solo tiene
 *   efecto en `removeAirSegments`: `CONFIRM-ALL` no trae `UpdateResult`, así que en
 *   `confirmAirSegments` el `status` se ignora y es igual que `'notApplied'`.
 * - `{ sideEffects }`: escribe lo pedido y además cambia segmentos que nadie pidió, por `Air@id`:
 *   `null` lo borra y un `ActionCode` le pone ese status. Para forzar `UNEXPECTED_CHANGE`
 *   (precisión 13), en los dos métodos.
 * - `{ error, removed? }`: un `Errors/Error` de Sabre sin `Success`. Sin `removed`, no escribe;
 *   con `700432`, `700411`, `700408` y `500810`, el texto por defecto es el de las fuentes, y
 *   después el SDK manda `IgnoreTransactionLLSRQ`. `removed` (ids `Air@id` de bajas pedidas en
 *   ese Update) fuerza una baja parcial: esos segmentos sí se borran, y la respuesta trae el PNR
 *   sin ellos y su `UpdateResult` `SUCCESS`, para `PARTIALLY_APPLIED` (precisión 12).
 * - `{ uncertain, applied? }`: el SDK lanza `SabreUncertainOutcomeError` con esa `reason`.
 *   `applied` dice si el cambio queda guardado en el fake, para probar la relectura. Por
 *   defecto, sí con `END_TRANSACTION_PROBLEM` y no con las demás. Solo `END_TRANSACTION_PROBLEM`
 *   trae el PNR en la respuesta; con las demás, `applied: true` no deja evidencia en ella. Por
 *   ejemplo, `PREVIOUS_ENTRY_ACTIVE` responde solo `Errors`, así que el SDK da
 *   `PREVIOUS_ENTRY_ACTIVE` igual (no `PARTIALLY_APPLIED`). Lo revela el reintento en una sesión
 *   nueva: `noop` en `confirmAirSegments`, `SEGMENT_NOT_FOUND` en `removeAirSegments`.
 *
 * El fake no simula el AAA: un `700408` (`No PNR in AAA`) solo sale si se fuerza como `error`.
 */
export type QueueFakeReservationUpdateOutcome =
  | 'applied'
  | 'notApplied'
  | { notApplied: { status?: string } }
  | { sideEffects: Readonly<Record<string, string | null>> }
  | { error: { code: string; message?: string; severity?: string }; removed?: readonly string[] }
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
  /** `Product@id`, o `undefined` si el segmento no trae `Product`. */
  productId: string | undefined;
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
  const products = new Set<string>();
  const segments = value.segments.map((segment, index): Segment => {
    const at = `${label}.segments[${index}]`;
    if (typeof segment !== 'object' || segment === null) fail(`${at} debe ser un objeto`);
    if (typeof segment.id !== 'string' || segment.id.trim() === '') fail(`${at}.id debe ser un texto no vacío`);
    if (ids.has(segment.id)) fail(`${at}.id '${segment.id}' está repetido en el PNR`);
    ids.add(segment.id);
    if (segment.productId !== undefined && segment.productId !== null && (typeof segment.productId !== 'string' || segment.productId.trim() === '')) {
      fail(`${at}.productId debe ser un texto no vacío o null`);
    }
    const productId = segment.productId === null ? undefined : (segment.productId ?? segment.id);
    if (productId !== undefined) {
      if (products.has(productId)) fail(`${at}.productId '${productId}' está repetido en el PNR`);
      products.add(productId);
    }
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
    return { id: segment.id, productId, sequence, status: segment.status, fields };
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
      const { removed } = value as { removed?: unknown };
      if (removed !== undefined && (!Array.isArray(removed) || removed.length === 0 || !removed.every((id) => typeof id === 'string' && id !== ''))) {
        fail(`${label}.removed debe ser una lista no vacía de ids`);
      }
      return value as QueueFakeReservationUpdateOutcome;
    }
    if ('notApplied' in value) {
      const notApplied = node((value as { notApplied: unknown }).notApplied);
      if (notApplied === undefined) fail(`${label}.notApplied debe ser un objeto`);
      if (notApplied.status !== undefined && (typeof notApplied.status !== 'string' || notApplied.status === '')) fail(`${label}.notApplied.status debe ser un texto no vacío`);
      return value as QueueFakeReservationUpdateOutcome;
    }
    if ('sideEffects' in value) {
      const effects = node((value as { sideEffects: unknown }).sideEffects);
      if (effects === undefined || Object.keys(effects).length === 0) fail(`${label}.sideEffects debe ser un objeto con al menos un id`);
      for (const [id, status] of Object.entries(effects)) {
        if (status !== null && (typeof status !== 'string' || !STATUS.test(status))) fail(`${label}.sideEffects['${id}'] debe ser null o un ActionCode de dos letras mayúsculas`);
      }
      return value as QueueFakeReservationUpdateOutcome;
    }
    if ('uncertain' in value) {
      const { uncertain, applied } = value as { uncertain: unknown; applied?: unknown };
      if (!UNCERTAIN_REASONS.has(String(uncertain))) fail(`${label}.uncertain debe ser una de ${[...UNCERTAIN_REASONS].join(' | ')}`);
      if (applied !== undefined && typeof applied !== 'boolean') fail(`${label}.applied debe ser boolean`);
      return value as QueueFakeReservationUpdateOutcome;
    }
  }
  fail(`${label} debe ser 'applied', 'notApplied', { notApplied }, { sideEffects }, { error } o { uncertain }`);
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
    '</stl19:Air>',
    segment.productId === undefined ? '' : `<stl19:Product id="${escape(segment.productId)}"/>`,
    '</stl19:Segment>',
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
  /** `ProductUpdate op="D"`: borra el segmento con ese `Product@id`. */
  const remove = (productId: string) => (segments: readonly Segment[]) => segments.filter((segment) => segment.productId !== productId);
  /** Después de una baja, los que quedan se renumeran de 1 en adelante (como en los ejemplos de Delete). */
  const renumber = (segments: readonly Segment[]) =>
    [...segments].sort((a, b) => a.sequence - b.sequence).map((segment, index) => ({ ...segment, sequence: index + 1 }));

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

    const steps: ((segments: readonly Segment[]) => Segment[])[] = [];
    /** Las bajas pedidas, en orden: cada una lleva su `UpdateResult` en `Results`; `CONFIRM-ALL` no trae ninguno (como el ejemplo). */
    const deletes: { updateId: string; id: string; productId: string }[] = [];
    let items = 0;
    for (const item of nodes(list?.ReservationUpdateItem)) {
      items += 1;
      const updateId = text(item['@UpdateId']) ?? String(items);
      const product = node(item.ProductUpdate);
      if (text(node(item.AirItineraryUpdate)?.Action) === 'CONFIRM-ALL') {
        steps.push(confirmAll);
      } else if (product !== undefined && text(product['@op']) === 'D') {
        const productId = text(product['@id']) ?? '';
        const target = pnr.segments.find((segment) => segment.productId === productId);
        if (target === undefined) return notSimulated(`ProductUpdate op="D" de un segmento que no está en el PNR ('${productId}')`);
        steps.push(remove(productId));
        deletes.push({ updateId, id: target.id, productId });
      } else {
        return notSimulated('ese ReservationUpdateItem');
      }
    }
    if (steps.length === 0) return notSimulated('UpdateReservationRQ sin ReservationUpdateItem');

    const outcome = outcomes.shift() ?? 'applied';
    const save = (segments: Segment[], renumbered: boolean) => {
      pnr.segments = renumbered ? renumber(segments) : segments;
      pnr.sequence += 1;
    };
    const apply = () => save(steps.reduce<Segment[]>((current, step) => step(current), [...pnr.segments]), deletes.length > 0);
    const resultsXml = (statusOf: (remove: (typeof deletes)[number]) => string | undefined = () => 'SUCCESS') => {
      const results = deletes.flatMap((item) => {
        const status = statusOf(item);
        return status === undefined ? [] : [`<stl19:UpdateResult UpdateId="${escape(item.updateId)}" Status="${escape(status)}"><stl19:Item op="D"/></stl19:UpdateResult>`];
      });
      return results.length === 0 ? '<stl19:Results/>' : `<stl19:Results>${results.join('')}</stl19:Results>`;
    };
    const success = (inner = '', results = resultsXml()) => ({
      action: 'UpdateReservationRS',
      payload: root('UpdateReservationRS', `<stl19:Success>OK</stl19:Success>${inner}${reservationXml(pnr)}${results}`),
    });

    if (outcome === 'applied') {
      apply();
      return success();
    }
    if (outcome === 'notApplied') return success();
    if ('notApplied' in outcome) {
      const status = outcome.notApplied.status ?? 'SUCCESS';
      return success('', resultsXml(() => status));
    }
    if ('sideEffects' in outcome) {
      const effects = Object.entries(outcome.sideEffects);
      const missing = effects.find(([id]) => !pnr.segments.some((segment) => segment.id === id));
      if (missing !== undefined) return notSimulated(`sideEffects de un segmento que no está en el PNR ('${missing[0]}')`);
      const requested = steps.reduce<Segment[]>((current, step) => step(current), [...pnr.segments]);
      const effect = new Map(effects);
      const changed = requested.flatMap((segment) => {
        const status = effect.get(segment.id);
        if (status === undefined) return [segment];
        return status === null ? [] : [{ ...segment, status }];
      });
      save(changed, deletes.length > 0 || effects.some(([, status]) => status === null));
      return success();
    }
    if ('error' in outcome) {
      const { code, message, severity } = outcome.error;
      const errors = errorXml(code, message ?? KNOWN_ERRORS[code] ?? 'sabre-client/testing: error forzado', severity ?? 'MODERATE');
      if (outcome.removed === undefined) return { action: 'UpdateReservationRS', payload: root('UpdateReservationRS', errors) };
      // Baja parcial (precisión 12): solo las bajas de `removed` quedan guardadas.
      const removed = new Set(outcome.removed);
      const outside = [...removed].find((id) => !deletes.some((item) => item.id === id));
      if (outside !== undefined) return notSimulated(`removed con un id que no es una baja de ese Update ('${outside}')`);
      save(pnr.segments.filter((segment) => !removed.has(segment.id)), true);
      return {
        action: 'UpdateReservationRS',
        payload: root('UpdateReservationRS', `${errors}${reservationXml(pnr)}${resultsXml((item) => (removed.has(item.id) ? 'SUCCESS' : undefined))}`),
      };
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
    stored.get(locator)?.segments.map((segment) => ({
      id: segment.id,
      ...(segment.productId === segment.id ? {} : { productId: segment.productId ?? null }),
      sequence: segment.sequence,
      status: segment.status,
      ...segment.fields,
    }));

  return { get, update, ignore, segments, forget: (session: string) => read.delete(session) };
}
