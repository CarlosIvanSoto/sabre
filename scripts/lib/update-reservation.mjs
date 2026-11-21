// Lo que usa scripts/validate-update-reservation.mjs (#272, U.6 de plan-v0-9) y se puede probar sin
// Sabre: los candados de escritura, la anonimización de `GetReservationRS`/`UpdateReservationRS` y
// de Get Booking, la lectura de los segmentos y la comparación de ids STL con `flights[].itemId`
// (Q-140). No importa `dist/`: los tests lo cargan directo (test/validate-update-reservation-script.test.ts).
//
// La anonimización es por lista blanca, no por lista negra: un PNR completo (`FULL`) trae nombres,
// teléfonos, correos, documentos, boletos, remarks y formas de pago en elementos que no conocemos
// todos. Se deja tal cual solo lo que describe los vuelos y la respuesta; todo lo demás se
// enmascara (letras a `X`, dígitos a `9`). Además se anotan los valores reales de los campos con
// datos de personas, para que `leaks` diga si alguno quedó en el texto.
import { XMLParser } from 'fast-xml-parser';

// ---------- Candados ----------

export const STEPS = ['read', 'confirm', 'remove'];
const LOCATOR = /^[A-Z0-9]{6}$/;
const SEGMENT_ID = /^\d+$/;
/** El default de `removeAirSegments`, que el script no deja ampliar. */
export const REMOVABLE_STATUSES = ['UN', 'HX'];

const ids = (text) =>
  String(text ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');

/**
 * Qué va a hacer una corrida, a partir de las variables de entorno. No llama a nada: devuelve
 * `{ error }` si falta algo o el candado no cuadra, o el plan. Una escritura (`write: true`) solo
 * sale con `SABRE_UPDATE_WRITE=<paso>:<localizador>`, el mismo paso y el mismo localizador, y en
 * producción. Sin `SABRE_UPDATE_WRITE`, `confirm` y `remove` son una corrida en seco.
 */
export function resolvePlan(env) {
  const environment = env.SABRE_ENVIRONMENT || 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') return { error: `SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})` };
  const step = env.SABRE_UPDATE_STEP || 'read';
  if (!STEPS.includes(step)) return { error: `SABRE_UPDATE_STEP debe ser ${STEPS.join(', ')} (recibido: ${step})` };
  const lock = env.SABRE_UPDATE_WRITE || undefined;
  const locatorText = env.SABRE_UPDATE_LOCATOR || undefined;
  const locator = locatorText?.trim().toUpperCase();
  if (locator !== undefined && !LOCATOR.test(locator)) return { error: `SABRE_UPDATE_LOCATOR debe tener 6 letras o dígitos (recibido: ${locatorText})` };

  if (step === 'read') {
    if (lock !== undefined) return { error: 'SABRE_UPDATE_WRITE no va con SABRE_UPDATE_STEP=read: la lectura no escribe' };
    const queues = ids(env.SABRE_UPDATE_QUEUES || '5,6');
    if (queues.length === 0 || queues.some((q) => !/^\d+$/.test(q))) return { error: 'SABRE_UPDATE_QUEUES debe ser una lista de colas numéricas, p. ej. 5,6' };
    const scan = Number(env.SABRE_UPDATE_SCAN ?? 5);
    if (!Number.isInteger(scan) || scan < 1 || scan > 20) return { error: 'SABRE_UPDATE_SCAN debe ser un entero de 1 a 20' };
    return { step, environment, write: false, ...(locator === undefined ? {} : { locator }), queues: queues.map(Number), scan };
  }

  if (locator === undefined) return { error: `falta SABRE_UPDATE_LOCATOR: ${step} trabaja sobre un PNR elegido en el paso read` };
  const variable = step === 'confirm' ? 'SABRE_UPDATE_EXPECTED_IDS' : 'SABRE_UPDATE_SEGMENT_IDS';
  const segmentIds = ids(env[variable]);
  if (segmentIds.length === 0) return { error: `falta ${variable}: los ids de segmento que imprimió el paso read, separados por comas` };
  if (segmentIds.some((id) => !SEGMENT_ID.test(id))) return { error: `${variable} debe traer ids numéricos (recibido: ${env[variable]})` };
  if (new Set(segmentIds).size !== segmentIds.length) return { error: `${variable} trae ids repetidos` };
  const receivedFrom = (env.SABRE_UPDATE_RECEIVED_FROM || 'SABRE CLIENT U6').trim();
  if (receivedFrom === '') return { error: 'SABRE_UPDATE_RECEIVED_FROM no puede ir vacío' };

  const plan = { step, environment, locator, segmentIds, receivedFrom, lock: `${step}:${locator}` };
  if (lock === undefined) return { ...plan, write: false };
  if (lock !== plan.lock) return { error: `el candado no cuadra: SABRE_UPDATE_WRITE debe ser exactamente ${plan.lock} (recibido: ${lock}); no se escribe nada` };
  if (environment !== 'production') return { error: 'las escrituras de ADR-034 solo se prueban en producción: en CERT no hay TK; no se escribe nada' };
  return { ...plan, write: true };
}

/** El sobre que mandaría el SDK, para la corrida en seco (la forma de `updateReservationPayload`). */
export function previewUpdate(plan) {
  const items =
    plan.step === 'confirm'
      ? ['<AirItineraryUpdate><Action>CONFIRM-ALL</Action></AirItineraryUpdate>']
      : plan.segmentIds.map((id) => `<ProductUpdate id="${id}" op="D"/>`);
  return [
    'GetReservationRQ Stateful del localizador, y después:',
    '<UpdateReservationRQ Version="1.19.0">',
    '  <RequestType commitTransaction="true">Stateful</RequestType>',
    '  <ReturnOptions RetrievePNR="true" IncludeUpdateDetails="true"><ViewName>Full</ViewName></ReturnOptions>',
    '  <ReservationUpdateList>',
    ...items.map((item, index) => `    <ReservationUpdateItem UpdateId="${index + 1}">${item}</ReservationUpdateItem>`),
    `    <ReceivedFrom><Name>${plan.receivedFrom}</Name></ReceivedFrom>`,
    '  </ReservationUpdateList>',
    '</UpdateReservationRQ>',
  ].join('\n');
}

// ---------- Requests de lectura ----------

const PNRBUILDER_NAMESPACE = 'http://webservices.sabre.com/pnrbuilder/v1_19';

/**
 * `GetReservationRQ` 1.19 `FULL`. Con `Stateful` es el mismo que manda el SDK antes de escribir
 * (`getReservationPayload` de src/reservation/stl-reservation.ts); con `Stateless` lee el PNR sin
 * dejarlo en el AAA, para revisar candidatos.
 */
export function getReservationPayload(locator, requestType = 'Stateful') {
  return [
    `<GetReservationRQ Version="1.19.0" xmlns="${PNRBUILDER_NAMESPACE}">`,
    `<Locator>${locator}</Locator>`,
    `<RequestType>${requestType}</RequestType>`,
    '<ReturnOptions><SubjectAreas><SubjectArea>FULL</SubjectArea></SubjectAreas></ReturnOptions>',
    '</GetReservationRQ>',
  ].join('');
}

// ---------- Lectura de segmentos ----------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});
const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const textOf = (value) => {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first === null) return undefined;
  const found = typeof first === 'object' ? first['#text'] : first;
  return found === undefined || String(found).trim() === '' ? undefined : String(found).trim();
};

/** El primer nodo con ese nombre en el árbol, a lo ancho. */
function find(tree, name) {
  const queue = [tree];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || typeof current !== 'object') continue;
    for (const [key, value] of Object.entries(current)) {
      if (key === name) return Array.isArray(value) ? value[0] : value;
      if (typeof value === 'object') queue.push(...list(value));
    }
  }
  return undefined;
}

/**
 * Lo que el script necesita de un `GetReservationRS` o `UpdateReservationRS`: el payload, si trae
 * `Success`, los `Errors/Error`, el localizador y los segmentos aéreos con los tres ids que importan
 * para Q-140 (`Segment@id`, `Air@id` y el primer `Product@id`). Más permisivo que el parser del SDK:
 * no lanza con un segmento raro, lo anota.
 */
export function readStlReservation(xml) {
  const tree = parser.parse(String(xml));
  const body = find(tree, 'Body') ?? {};
  const payloadName = Object.keys(body).find((key) => !key.startsWith('@'));
  const payload = payloadName === undefined ? {} : (body[payloadName] ?? {});
  const reservation = typeof payload === 'object' ? payload.Reservation : undefined;
  const errors = list(payload?.Errors?.Error).map((error) => ({
    code: textOf(error?.Code) ?? error?.['@Code'],
    message: textOf(error?.Message) ?? error?.['@Message'],
    severity: textOf(error?.Severity) ?? error?.['@Severity'],
  }));
  const segments = [];
  for (const segment of list(reservation?.PassengerReservation?.Segments?.Segment)) {
    const air = Array.isArray(segment?.Air) ? segment.Air[0] : segment?.Air;
    if (air === undefined) continue;
    const marriage = air.MarriageGrp;
    segments.push({
      segmentId: segment['@id'],
      airId: air['@id'],
      productId: list(segment.Product)[0]?.['@id'],
      sequence: air['@sequence'] ?? segment['@sequence'],
      status: textOf(air.ActionCode),
      carrier: textOf(air.MarketingAirlineCode),
      flightNumber: textOf(air.MarketingFlightNumber) ?? textOf(air.FlightNumber),
      from: textOf(air.DepartureAirport),
      to: textOf(air.ArrivalAirport),
      departure: textOf(air.DepartureDateTime),
      arrival: textOf(air.ArrivalDateTime),
      scheduleChangeIndicator: textOf(air.ScheduleChangeIndicator),
      marriage: marriage === undefined ? undefined : { ind: textOf(marriage.Ind), group: textOf(marriage.Group), sequence: textOf(marriage.Sequence) },
    });
  }
  return {
    payloadName,
    success: typeof payload === 'object' && 'Success' in payload,
    errors,
    locator: textOf(reservation?.BookingDetails?.RecordLocator),
    hasReservation: reservation !== undefined,
    segments,
    updateResults: list(payload?.Results?.UpdateResult).map((result) => ({ updateId: result?.['@UpdateId'], status: result?.['@Status'] })),
    applicationResults: find(payload, 'ApplicationResults') === undefined ? undefined : 'presente',
  };
}

/** Cuántos segmentos hay en cada estado: `{ TK: 2, UN: 1 }`. */
export function statusCounts(segments) {
  const counts = {};
  for (const { status } of segments) counts[status ?? '?'] = (counts[status ?? '?'] ?? 0) + 1;
  return counts;
}

/**
 * Cómo viene `ReceivedFrom` en el PNR (Q-141): los elementos hijos y el largo de cada valor, sin el
 * valor. `undefined` si no viene.
 */
export function receivedFromShape(xml) {
  const match = /<(?:[\w-]+:)?ReceivedFrom\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?ReceivedFrom>/.exec(String(xml));
  if (match === null) return undefined;
  return [...match[1].matchAll(/<(?:[\w-]+:)?([\w-]+)\b[^>]*>([^<]*)</g)].map(([, element, value]) => ({ element, length: value.trim().length }));
}

/**
 * Q-140: une cada segmento STL con su vuelo de Get Booking por aerolínea, número, origen, destino,
 * fecha y hora de salida, y compara `flights[].itemId` con los tres ids STL.
 */
export function compareSegmentIds(segments, flights = []) {
  const pairs = segments.map((segment) => {
    const date = segment.departure?.slice(0, 10);
    const time = segment.departure?.slice(11, 16);
    const flight = flights.find(
      (f) =>
        f.airlineCode === segment.carrier &&
        Number(f.flightNumber) === Number(segment.flightNumber) &&
        f.fromAirportCode === segment.from &&
        f.toAirportCode === segment.to &&
        (date === undefined || f.departureDate === date) &&
        // El UN y el TK de un cambio de horario suelen ser el mismo vuelo el mismo día: la hora los separa.
        (time === undefined || time === '' || f.departureTime === undefined || f.departureTime.slice(0, 5) === time),
    );
    const base = { airId: segment.airId, segmentId: segment.segmentId, productId: segment.productId, status: segment.status };
    if (flight === undefined) return { ...base, matched: false };
    return {
      ...base,
      matched: true,
      itemId: flight.itemId,
      restStatus: flight.flightStatusCode,
      itemIdIsAirId: flight.itemId === segment.airId,
      itemIdIsProductId: flight.itemId === segment.productId,
      itemIdIsSegmentId: flight.itemId === segment.segmentId,
    };
  });
  const matched = pairs.filter((p) => p.matched);
  const all = (key) => (matched.length === 0 ? undefined : matched.every((p) => p[key]));
  const pairedItemIds = new Set(matched.map((p) => p.itemId));
  return {
    pairs,
    restFlights: flights.length,
    unmatchedStl: pairs.filter((p) => !p.matched).map((p) => p.airId),
    unmatchedRest: flights.filter((f) => !pairedItemIds.has(f.itemId)).map((f) => f.itemId),
    airIdEqualsProductId: segments.length === 0 ? undefined : segments.every((s) => s.airId === s.productId),
    airIdEqualsSegmentId: segments.length === 0 ? undefined : segments.every((s) => s.airId === s.segmentId),
    itemIdIsAirId: all('itemIdIsAirId'),
    itemIdIsProductId: all('itemIdIsProductId'),
    statusesAgree: matched.length === 0 ? undefined : matched.every((p) => p.restStatus === p.status),
  };
}

// ---------- Anonimización ----------

/** Elementos cuyo texto queda tal cual: describen el vuelo o la respuesta, no a una persona. */
const SAFE_TEXT = new Set([
  // Vuelo
  'ActionCode', 'AirMilesFlown', 'ArrivalAirport', 'ArrivalAirportCodeContext', 'ArrivalDateTime', 'Banner',
  'ChangeOfGauge', 'ClassOfService', 'DepartureAirport', 'DepartureAirportCodeContext', 'DepartureDateTime',
  'ElapsedTime', 'EquipmentType', 'Eticket', 'FlightNumber', 'FunnelFlight', 'Airport', 'Departure',
  'Informational', 'MarketingAirlineCode', 'MarketingClassOfService', 'MarketingFlightNumber', 'NumberInParty',
  'OperatingAirlineCode', 'OperatingAirlineShortName', 'OperatingClassOfService', 'OperatingFlightNumber',
  'ScheduleChangeIndicator', 'SegmentBookedDate', 'StopQuantity', 'inboundConnection', 'outboundConnection',
  'isPast', 'CodeShare', 'ProductName', 'ResBookDesigCode',
  // Respuesta y sobre
  'Action', 'Service', 'Timestamp', 'Code', 'Message', 'Severity', 'Success', 'RequestType', 'SubjectArea',
  'ViewName', 'CreationTimestamp', 'UpdateTimestamp', 'SystemCreationTimestamp', 'EstimatedPurgeTimestamp',
  'PNRSequence',
]);
/** Texto que queda tal cual solo si es un número (`MarriageGrp`); `Group` puede ser el nombre de un grupo. */
const NUMERIC_TEXT = new Set(['Ind', 'Group', 'Sequence']);
/** Texto que es un localizador del PNR: pasa a su alias. */
const LOCATOR_TEXT = new Set(['RecordLocator', 'Locator']);
/** Texto que es un PCC: pasa a `XXXX`. */
const PCC_TEXT = new Set(['CPAId', 'PseudoCityCode', 'HomePseudoCityCode', 'AAAPseudoCityCode', 'PrimeHostID', 'BookingSource', 'CreationPCC', 'OwnerPCC']);
/** Texto que es una firma de agente: pasa a `AAA`. */
const SINE_TEXT = new Set(['CreationAgentID', 'UpdateAgentID', 'AgentSine', 'AgentID', 'CreationAgent']);
/** Elementos con datos de personas: además de enmascararse, se vigila que su valor no quede (`leaks`). */
const PERSON_TEXT = new Set([
  'LastName', 'FirstName', 'MiddleName', 'Surname', 'GivenName', 'PassengerName', 'FullName', 'Name', 'AgentName',
  'Number', 'PhoneNumber', 'Phone', 'Address', 'Email', 'EmailAddress', 'TicketNumber', 'DocumentNumber', 'FreeText',
  'Text', 'Comment', 'DateOfBirth',
]);
/** Atributos que quedan tal cual. */
const SAFE_ATTRS = new Set([
  'id', 'sequence', 'op', 'segmentAssociationId', 'isPast', 'DayOfWeekInd', 'CodeShare', 'SpecialMeal', 'StopQuantity',
  'SmokingAllowed', 'ResBookDesigCode', 'Code', 'code', 'SabreCode', 'sabreCode', 'ShortName', 'shortName', 'Lang', 'lang',
  'Version', 'version', 'productCategory', 'type', 'UpdateId', 'Status', 'status', 'nameType', 'passengerType', 'nameId',
  'nameAssocId', 'elementId', 'index', 'valueType', 'DOT', 'IncludeUpdateDetails', 'RetrievePNR', 'commitTransaction',
  'EncodingType', 'eb:version', 'eb:type', 'soap-env:mustUnderstand', 'numberInParty', 'numberOfInfants', 'NumberInSegment',
  'InhibitCode', 'AirExtras', 'Start', 'End', 'ISOCountry', 'encoding',
]);
/** El `Name` de `Cabin` (`ECONOMY`) es del vuelo; en otros elementos puede ser una persona. */
const SAFE_NAME_ATTR_ELEMENTS = new Set(['Cabin', 'ProductName']);
const PCC_ATTRS = new Set(['PseudoCityCode', 'HomePseudoCityCode', 'AAAPseudoCityCode', 'PrimeHostID', 'BookingSource']);
const SINE_ATTRS = new Set(['AgentSine', 'AgentDutyCode']);

/** Claves de Get Booking que quedan tal cual: describen vuelos o estados. */
const SAFE_JSON_KEYS = new Set([
  'itemId', 'flightNumber', 'airlineCode', 'airlineName', 'operatingFlightNumber', 'operatingAirlineCode', 'operatingAirlineName',
  'fromAirportCode', 'toAirportCode', 'departureDate', 'departureTime', 'arrivalDate', 'arrivalTime', 'flightStatusCode',
  'flightStatusName', 'bookingClass', 'cabinTypeName', 'cabinTypeCode', 'sourceType', 'isPast', 'numberOfSeats',
  'departureTerminalName', 'arrivalTerminalName', 'aircraftTypeCode', 'aircraftTypeName', 'durationInMinutes', 'distanceInMiles',
  'firstAirportCode', 'lastAirportCode', 'numberOfFlights', 'originAirportCode', 'destinationAirportCode', 'timestamp',
  'category', 'type', 'code', 'description', 'fieldName', 'isChangeable', 'isCancelable', 'isRefundable', 'segmentCount',
]);
/** Claves de Get Booking con un localizador (del PNR o de la aerolínea): pasan a su alias. */
const LOCATOR_JSON_KEYS = new Set(['confirmationId', 'bookingId']);
const PCC_JSON_KEYS = new Set(['targetPcc', 'userWorkPcc', 'userHomePcc', 'ticketingPcc', 'bookingPcc', 'pcc', 'pseudoCityCode', 'agencyPcc', 'creationPcc', 'owningPcc']);
const PERSON_JSON_KEYS = new Set([
  'givenName', 'middleName', 'surname', 'name', 'fullName', 'emails', 'email', 'number', 'phones', 'phone', 'address', 'street',
  'birthDate', 'documentNumber', 'text', 'freeText', 'receivedFrom', 'agentName', 'cardNumber', 'membershipId',
]);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ENTITIES[entity] ?? '');
const encode = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Letras a `X`, dígitos a `9`: conserva la forma. */
export const mask = (text) => String(text).replace(/\p{L}/gu, 'X').replace(/\p{N}/gu, '9');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Un anonimizador con memoria para una corrida. `aliasOf` es el de `createAnonymizer` (así sus
 * `leaks` ven los localizadores); `secrets`, los valores que pasan a `XXXX` donde aparezcan.
 * - `xml(body)`: un sobre STL o de colas. Lista blanca de elementos y atributos; `RecordLocator`
 *   y `Locator` al alias; `AirlineRefId` (`DCB6*ABC123`) conserva el prefijo y da alias al
 *   localizador de la aerolínea; PCC a `XXXX`; firmas a `AAA`; lo demás, enmascarado.
 * - `json(value)`: un body de Get Booking, ya parseado. Misma regla por clave.
 * - `text(value)`: cualquier otro texto (mensajes de error, eventos del logger): solo alias y secretos.
 * - `leaks(text)`: los valores de personas que siguen en el texto (con su campo), sin repetir.
 *
 * @param {{ aliasOf: (locator: string) => string, secrets?: ReadonlyArray<string | undefined> }} options
 */
export function createScrubber({ aliasOf, secrets = [] }) {
  const realSecrets = secrets.filter((s) => typeof s === 'string' && s.length >= 3).sort((a, b) => b.length - a.length);
  const locators = new Set();
  const watched = new Map();

  const alias = (value) => {
    const trimmed = value.trim();
    if (trimmed === '') return value;
    locators.add(trimmed);
    return aliasOf(trimmed);
  };
  /** Vigila un valor real que se enmascaró, si parece de una persona. */
  const watch = (field, value, isPerson) => {
    const trimmed = value.trim();
    if (trimmed.length < 3 || /^[X9\W_]*$/.test(trimmed)) return;
    if (isPerson || /@/.test(trimmed) || /\d{7,}/.test(trimmed)) watched.set(trimmed, field);
  };
  const airlineRef = (value) => {
    const star = value.lastIndexOf('*');
    return star === -1 ? alias(value) : `${value.slice(0, star + 1)}${alias(value.slice(star + 1))}`;
  };
  const finish = (text) => {
    let result = text;
    for (const locator of [...locators].sort((a, b) => b.length - a.length)) result = result.split(locator).join(aliasOf(locator));
    for (const secret of realSecrets) result = result.split(secret).join('XXXX');
    return result;
  };

  function attributes(element, attrs) {
    const rewritten = attrs.replace(/(\s+)([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, space, name, double, single) => {
      const value = decode(double ?? single);
      let result;
      if (name.startsWith('xmlns') || SAFE_ATTRS.has(name)) result = value;
      else if (name === 'Name' && SAFE_NAME_ATTR_ELEMENTS.has(element)) result = value;
      else if (name === 'ID' && element === 'UniqueID') result = alias(value);
      else if (PCC_ATTRS.has(name)) result = value === '' ? '' : 'XXXX';
      else if (SINE_ATTRS.has(name)) result = value === '' || value === 'SABRE' ? value : 'AAA';
      else {
        watch(`${element}@${name}`, value, name === 'Name' || name === 'LNIATA');
        result = mask(value);
      }
      return `${space}${name}="${encode(result)}"`;
    });
    // Lo que no tenga forma de atributo (no debería haber nada) no pasa tal cual.
    return rewritten.replace(/("[^"]*")|([^"\s=]+)/g, (whole, quoted) => (quoted === undefined ? (/^[\w:.-]+$/.test(whole) ? whole : mask(whole)) : whole));
  }

  function leafText(element, raw) {
    const value = decode(raw);
    if (value.trim() === '' || value === '[REDACTED]' || SAFE_TEXT.has(element)) return raw;
    if (NUMERIC_TEXT.has(element) && /^\s*\d+\s*$/.test(value)) return raw;
    if (LOCATOR_TEXT.has(element)) return encode(alias(value));
    if (element === 'AirlineRefId') return encode(airlineRef(value));
    if (PCC_TEXT.has(element)) return 'XXXX';
    if (SINE_TEXT.has(element)) return 'AAA';
    watch(element, value, PERSON_TEXT.has(element));
    return encode(mask(value));
  }

  function xml(body) {
    const withAttributes = String(body).replace(/<([\w-]+:)?([\w-]+)(\s[^<>]*?)?(\/?)>/g, (_, prefix = '', element, attrs = '', end) =>
      `<${prefix}${element}${attributes(element, attrs)}${end}>`,
    );
    const withText = withAttributes.replace(/(<([\w-]+:)?([\w-]+)(?:\s[^<>]*)?>)([^<]*)(<\/\2?\3>)/g, (whole, open, _prefix, element, raw, close) =>
      open.endsWith('/>') ? whole : `${open}${leafText(element, raw)}${close}`,
    );
    return finish(withText);
  }

  function walk(value, key) {
    if (Array.isArray(value)) return value.map((item) => walk(item, key));
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    if (typeof value !== 'string' || value === '') return value;
    if (key !== undefined && SAFE_JSON_KEYS.has(key)) return value;
    if (key !== undefined && LOCATOR_JSON_KEYS.has(key)) return airlineRef(value);
    if (key !== undefined && PCC_JSON_KEYS.has(key)) return 'XXXX';
    watch(key ?? '(json)', value, key !== undefined && PERSON_JSON_KEYS.has(key));
    return mask(value);
  }
  const json = (value) => JSON.parse(finish(JSON.stringify(walk(value, undefined))));

  function leaks(text) {
    const found = new Set();
    for (const [value, field] of watched) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, 'u');
      if (pattern.test(text)) found.add(field);
    }
    return [...found];
  }

  return { xml, json, text: finish, alias, leaks };
}

// ---------- Errores ----------

/** Lo que se graba de un error: sin `raw` (trae el sobre sin anonimizar). */
export function describeError(error) {
  if (!(error instanceof Error)) return { thrown: String(error) };
  const fields = ['code', 'reason', 'retryable', 'status', 'service', 'operation', 'confirmationId', 'severity', 'kind'];
  const described = { name: error.name, message: error.message };
  for (const field of fields) if (error[field] !== undefined) described[field] = error[field];
  for (const field of ['expectedSegments', 'actualSegments']) if (Array.isArray(error[field]) && error[field].length > 0) described[field] = [...error[field]];
  if (Array.isArray(error.errors) && error.errors.length > 0) described.errors = error.errors.map(describeError);
  return described;
}
