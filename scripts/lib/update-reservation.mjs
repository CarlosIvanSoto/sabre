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

export const STEPS = ['scan', 'read', 'confirm', 'remove'];
const LOCATOR = /^[A-Z0-9]{6}$/;
const SEGMENT_ID = /^\d+$/;
/** El default de `removeAirSegments`, que el script no deja ampliar. */
export const REMOVABLE_STATUSES = ['UN', 'HX'];
/** El `ReceivedFrom` que usará el usuario, para los ejemplos del seco (no es un default). */
export const RECEIVED_FROM_EXAMPLE = 'BX3';
/** Si un localizador (de la cola o del usuario) tiene la forma de un PNR. */
export const isLocator = (value) => typeof value === 'string' && LOCATOR.test(value);

const ids = (text) =>
  String(text ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');

/** `--write=<candado>` de la línea de comandos; cualquier otro argumento es un error. */
function writeArgument(argv) {
  let lock;
  for (const arg of argv) {
    if (arg.startsWith('--write=')) {
      if (lock !== undefined) return { error: '--write va una sola vez' };
      lock = arg.slice('--write='.length);
      continue;
    }
    if (arg === '--write') return { error: 'el candado va pegado: --write=<paso>:<localizador>:<ids>' };
    return { error: `argumento desconocido: ${arg} (el único es --write=<paso>:<localizador>:<ids>)` };
  }
  return { lock };
}

function queuesAndScan(env, maxScan) {
  const queues = ids(env.SABRE_UPDATE_QUEUES || '5,6');
  if (queues.length === 0 || queues.some((q) => !/^\d+$/.test(q))) return { error: 'SABRE_UPDATE_QUEUES debe ser una lista de colas numéricas, p. ej. 5,6' };
  const scan = Number(env.SABRE_UPDATE_SCAN ?? 5);
  if (!Number.isInteger(scan) || scan < 1 || scan > maxScan) return { error: `SABRE_UPDATE_SCAN debe ser un entero de 1 a ${maxScan}` };
  return { queues: queues.map(Number), scan };
}

/**
 * Qué va a hacer una corrida, a partir de las variables de entorno y de `argv` (sin `node` ni el
 * script). No llama a nada: devuelve `{ error }` si falta algo o el candado no cuadra, o el plan.
 *
 * El candado de escritura sale **solo** de `argv` (`--write=<paso>:<localizador>:<ids>`), nunca del
 * entorno: un `export` o una línea de `.env.production` no deben poder convertir en escritura un
 * comando de lectura. `SABRE_UPDATE_WRITE` (el candado de antes) es un error. El candado repite el
 * paso, el localizador y los ids en el mismo orden que la variable (`confirm:ABC123:8,10`). Sin
 * candado, `confirm` y `remove` son una corrida en seco. Con candado hacen falta producción y
 * `SABRE_UPDATE_RECEIVED_FROM`, sin default.
 *
 * @param {Record<string, string | undefined>} env
 * @param {ReadonlyArray<string>} [argv]
 * @returns {{ error?: string, step?: string, environment?: string, sessionPcc?: string, sessionPccLabel?: string, write?: boolean, locator?: string, segmentIds?: string[], receivedFrom?: string, lock?: string, queues?: number[], scan?: number }}
 */
export function resolvePlan(env, argv = []) {
  if (env.SABRE_UPDATE_WRITE !== undefined) return { error: 'SABRE_UPDATE_WRITE ya no se acepta: el candado va en la línea de comandos (--write=<paso>:<localizador>:<ids>); quítala del entorno y de .env.production. No se escribe nada' };
  const argument = writeArgument(argv);
  if (argument.error !== undefined) return { error: argument.error };
  const { lock } = argument;
  const environment = env.SABRE_ENVIRONMENT || 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') return { error: `SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})` };
  const step = env.SABRE_UPDATE_STEP || 'read';
  if (!STEPS.includes(step)) return { error: `SABRE_UPDATE_STEP debe ser ${STEPS.join(', ')} (recibido: ${step})` };
  const locatorText = env.SABRE_UPDATE_LOCATOR || undefined;
  const locator = locatorText?.trim().toUpperCase();
  if (locator !== undefined && !isLocator(locator)) return { error: `SABRE_UPDATE_LOCATOR debe tener 6 letras o dígitos (recibido: ${locatorText})` };
  const session = resolveSessionPcc(env);
  if (session.error !== undefined) return { error: session.error };
  const sessionPart = session.pcc === undefined ? {} : { sessionPcc: session.pcc, sessionPccLabel: session.label };

  if (step === 'scan' || step === 'read') {
    if (lock !== undefined) return { error: `--write no va con SABRE_UPDATE_STEP=${step}: ${step} no escribe` };
    if (step === 'scan') {
      if (locator !== undefined) return { error: 'scan no usa SABRE_UPDATE_LOCATOR: para leer un PNR concreto, SABRE_UPDATE_STEP=read' };
      const found = queuesAndScan(env, 20);
      return found.error === undefined ? { step, environment, write: false, ...sessionPart, ...found } : found;
    }
    const found = queuesAndScan(env, 20);
    if (found.error !== undefined) return found;
    return { step, environment, write: false, ...sessionPart, ...(locator === undefined ? {} : { locator }), ...found };
  }

  if (locator === undefined) return { error: `falta SABRE_UPDATE_LOCATOR: ${step} trabaja sobre un PNR elegido en el paso scan o read` };
  const variable = step === 'confirm' ? 'SABRE_UPDATE_EXPECTED_IDS' : 'SABRE_UPDATE_SEGMENT_IDS';
  const segmentIds = ids(env[variable]);
  if (segmentIds.length === 0) return { error: `falta ${variable}: los ids de segmento que imprimió el paso read, separados por comas` };
  if (segmentIds.some((id) => !SEGMENT_ID.test(id))) return { error: `${variable} debe traer ids numéricos (recibido: ${env[variable]})` };
  if (new Set(segmentIds).size !== segmentIds.length) return { error: `${variable} trae ids repetidos` };
  const receivedFromText = env.SABRE_UPDATE_RECEIVED_FROM;
  if (receivedFromText !== undefined && receivedFromText.trim() === '') return { error: 'SABRE_UPDATE_RECEIVED_FROM no puede ir vacío' };
  const receivedFrom = receivedFromText?.trim();

  const plan = { step, environment, ...sessionPart, locator, segmentIds, ...(receivedFrom === undefined ? {} : { receivedFrom }), lock: `${step}:${locator}:${segmentIds.join(',')}` };
  if (lock === undefined) return { ...plan, write: false };
  if (lock !== plan.lock) return { error: `el candado no cuadra: debe ser exactamente --write=${plan.lock} (recibido: --write=${lock}); no se escribe nada` };
  if (environment !== 'production') return { error: 'las escrituras de ADR-034 solo se prueban en producción: en CERT no hay TK; no se escribe nada' };
  if (receivedFrom === undefined) return { error: `falta SABRE_UPDATE_RECEIVED_FROM: la escritura no tiene default (p. ej. SABRE_UPDATE_RECEIVED_FROM=${RECEIVED_FROM_EXAMPLE}); no se escribe nada` };
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
    `    <ReceivedFrom><Name>${plan.receivedFrom ?? RECEIVED_FROM_EXAMPLE}</Name></ReceivedFrom>`,
    '  </ReservationUpdateList>',
    '</UpdateReservationRQ>',
  ].join('\n');
}

// ---------- Contexto de la sesión (Q-143) ----------

/** Un PCC: 3 o 4 letras mayúsculas o dígitos. Es lo único que se deja entrar a `AAA<PCC>`. */
const PCC = /^[A-Z0-9]{3,4}$/;
export const isPcc = (value) => typeof value === 'string' && PCC.test(value);

/**
 * El PCC al que el script cambia el AAA de la sesión: `SABRE_SESSION_PCC`, o `SABRE_TARGET_PCC` si
 * vale `target` (igual que SABRE_QUEUE_PCC). Sin la variable no hay `pcc` y el script no manda
 * ningún `AAA`. Un valor que no es un PCC es un error: nunca llega al comando.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ pcc?: string, label?: string, error?: string }}
 */
export function resolveSessionPcc(env) {
  const raw = env.SABRE_SESSION_PCC;
  if (raw === undefined || raw === '') return {};
  const viaTarget = raw === 'target';
  const value = viaTarget ? env.SABRE_TARGET_PCC : raw;
  const variable = viaTarget ? 'SABRE_TARGET_PCC (por SABRE_SESSION_PCC=target)' : 'SABRE_SESSION_PCC';
  if (value === undefined || value === '') return { error: 'SABRE_SESSION_PCC=target pide SABRE_TARGET_PCC, y no está definida' };
  if (!isPcc(value)) return { error: `${variable} debe ser un PCC de 3 o 4 letras mayúsculas o dígitos (recibido: ${viaTarget ? 'un valor que no lo es' : value})` };
  return { pcc: value, label: viaTarget ? 'SABRE_TARGET_PCC' : 'SABRE_SESSION_PCC' };
}

/** El comando de host que cambia el AAA de la sesión. Lanza si `pcc` no es un PCC: nunca arma otra cosa. */
export function aaaCommand(pcc) {
  if (!isPcc(pcc)) throw new TypeError('el PCC del AAA debe ser de 3 o 4 letras mayúsculas o dígitos');
  return `AAA${pcc}`;
}

/** Palabras con las que el host rechaza un `AAA` (pantallas de error, no de cambio). */
const AAA_ERROR = /\b(NOT AUTHORIZED|INVALID|UNABLE|RESTRICTED|FORMAT|ERROR|NO ACCESS|NOT ALLOWED|REJECT|DENIED|UNKNOWN|NOT FOUND)\b|\bNO\s+(?:AUTH|ACCESS)/i;

/** La forma de una línea de cambio de AAA: `<PCC>.<home>*<sine>.<duty>` (`8AYC.H8GI*AWS.A`). */
const AAA_SHAPE = '(?<![A-Z0-9])([A-Z0-9]{3,4})\\.([A-Z0-9]{3,4})\\*([A-Z0-9]{2,4})\\.([A-Z0-9])';

/**
 * Lee la pantalla de `AAA<PCC>`. El host contesta, en la primera línea, `<PCC nuevo>.<home>*<sine>.<duty>`
 * (`8AYC.H8GI*AWS.A` al pasar a 8AYC, comandos-de-host y emision-de-boletos). Solo cuenta como cambio
 * esa línea con el PCC pedido: cualquier otra pantalla (un error, una línea con otro PCC, una
 * pantalla vacía) no lo confirma. Pura: no llama a nada.
 *
 * @param {string | undefined} screen
 * @param {string} pcc el PCC pedido
 * @returns {{ ok: boolean, reason: string, activePcc?: string, home?: string, sine?: string }}
 */
export function parseAaaScreen(screen, pcc) {
  const lines = String(screen ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0) return { ok: false, reason: 'la pantalla vino vacía' };
  const first = new RegExp(`^${AAA_SHAPE}`).exec(lines[0]);
  if (first !== null) {
    const found = { activePcc: first[1], home: first[2], sine: first[3] };
    return first[1] === pcc
      ? { ok: true, reason: `el host confirma el AAA ${pcc}`, ...found }
      : { ok: false, reason: `el host quedó en ${first[1]}, no en ${pcc}`, ...found };
  }
  const error = AAA_ERROR.exec(lines.join(' '));
  return { ok: false, reason: error === null ? 'la primera línea no tiene la forma <PCC>.<home>*<sine>.<duty>' : `el host respondió un error: ${error[0].toUpperCase()}` };
}

/**
 * El PCC, el home y la sine de cada línea de la pantalla con la forma `<PCC>.<home>*<sine>.<duty>`, no
 * solo la primera: son los valores reales que la fixture no debe traer (el chequeo de fugas los vigila).
 */
export function aaaScreenValues(screen) {
  const values = new Set();
  for (const line of String(screen ?? '').split(/\r?\n/)) {
    for (const m of line.matchAll(new RegExp(AAA_SHAPE, 'g'))) for (const value of [m[1], m[2], m[3]]) values.add(value);
  }
  return [...values];
}

/**
 * La pantalla del AAA para la fixture: toda línea con la forma `<PCC>.<home>*<sine>.<duty>` pasa a
 * `XXXX.XXXX*AAA.<duty>`, y en todo el texto los `secrets` (PCC conocidos) pasan a XXXX. Lo que no
 * se reconoce no se adivina: la fixture la vuelve a revisar el chequeo de fugas.
 */
export function anonymizeAaaScreen(screen, secrets = []) {
  const known = secrets.filter((s) => typeof s === 'string' && s.length >= 3).sort((a, b) => b.length - a.length);
  const hide = (line) => known.reduce((acc, secret) => acc.split(secret).join('XXXX'), line);
  return String(screen ?? '')
    .split(/\r?\n/)
    .map((line) => hide(line.replace(new RegExp(AAA_SHAPE, 'g'), 'XXXX.XXXX*AAA.$4')))
    .join('\n');
}

/**
 * Qué dio la lectura después del AAA: `ok`, o los códigos de error de `GetReservationRS`
 * (`700102`), o `sin respuesta` si Sabre no contestó con un `GetReservationRS` que se pueda leer.
 */
export function readAfterAaa(stateful, stepError) {
  if (stateful === undefined) return stepError?.code === undefined ? 'sin respuesta' : String(stepError.code);
  const codes = stateful.errors.map((e) => e.code).filter((c) => c !== undefined);
  if (codes.length > 0) return codes.join(' ');
  return stateful.hasReservation ? 'ok' : 'sin reserva';
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

const TICKET_ELEMENTS = new Set(['TicketDetails', 'ETicketNumber', 'TicketNumber']);

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
      // Como el SDK (stl-reservation.ts): `Air@id`, y si falta, `Segment@id`.
      airId: air['@id'] ?? segment['@id'],
      airIdFromSegment: air['@id'] === undefined,
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
  const ticketingInfo = reservation?.PassengerReservation?.TicketingInfo;
  const ticketingChildren = ticketingInfo !== null && typeof ticketingInfo === 'object' ? Object.keys(ticketingInfo).filter((key) => !key.startsWith('@') && key !== '#text') : [];
  return {
    payloadName,
    success: typeof payload === 'object' && 'Success' in payload,
    passengers: list(reservation?.PassengerReservation?.Passengers?.Passenger).length,
    numberInParty: reservation?.['@numberInParty'],
    // El wiki no documenta cómo trae STL un boleto emitido: `issued` solo es `true` si `TicketingInfo`
    // trae uno de estos elementos; `children` deja ver qué trae (p. ej. `FutureTicketing`, el TAW).
    ticketing: ticketingInfo === undefined ? undefined : { issued: ticketingChildren.some((key) => TICKET_ELEMENTS.has(key)), children: ticketingChildren },
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

/** Estados que no son de un segmento viejo: el TK nuevo, el HK y los que tocaría CONFIRM-ALL (Q-139). */
const CURRENT_STATUSES = new Set(['TK', 'HK', 'KK', 'KL', 'TL', 'TN']);
export const OTHER_CONFIRMABLE = ['KK', 'KL', 'TL', 'TN'];
const segmentLabel = (s) => `${s.airId ?? '?'} ${s.status ?? '?'} ${s.carrier ?? '?'}${s.flightNumber ?? '?'} ${s.from ?? '?'}-${s.to ?? '?'} ${(s.departure ?? '?').slice(0, 16).replace('T', ' ')}`;

/**
 * Una fila de la tabla del paso `scan`, para que las agentes elijan un PNR: sus colas, las
 * aerolíneas, los segmentos viejos (UN, HX y cualquier otro que no sea TK, HK, KK, KL, TL ni TN) y
 * los nuevos (TK), cada uno con id, estado, vuelo, ruta y salida; si trae boleto emitido, si hay
 * `MarriageGrp` con grupo, los pasajeros y los otros estados que tocaría CONFIRM-ALL.
 */
export function scanRow(queues, locator, pnr) {
  const married = pnr.segments.filter((s) => s.marriage !== undefined && s.marriage.group !== undefined && s.marriage.group !== '0');
  const counts = statusCounts(pnr.segments);
  const others = OTHER_CONFIRMABLE.filter((status) => counts[status] !== undefined).map((status) => `${status}×${counts[status]}`);
  // Sin TicketDetails, ETicketNumber ni TicketNumber no se sabe si hay boleto (duda de diseño 1): no es un «no».
  const ticket = pnr.ticketing === undefined ? 'desconocido (sin TicketingInfo)' : pnr.ticketing.issued ? 'sí' : `desconocido (${pnr.ticketing.children.join(', ') || 'vacío'})`;
  return {
    cola: [...queues].join(','),
    localizador: locator,
    aerolíneas: [...new Set(pnr.segments.map((s) => s.carrier).filter(Boolean))].join(',') || '—',
    viejos: pnr.segments.filter((s) => !CURRENT_STATUSES.has(s.status)).map(segmentLabel).join(' · ') || '—',
    nuevos: pnr.segments.filter((s) => s.status === 'TK').map(segmentLabel).join(' · ') || '—',
    HK: counts.HK ?? 0,
    otros: others.join(' ') || '—',
    boleto: ticket,
    marriage: married.length === 0 ? 'no' : `sí (${[...new Set(married.map((s) => s.marriage.group))].join(',')})`,
    pax: pnr.passengers || Number(pnr.numberInParty ?? 0),
    errores: pnr.errors.map((e) => e.code).join(' ') || '—',
  };
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
  'ActionCode', 'AirMilesFlown', 'ArrivalAirport', 'ArrivalAirportCodeContext', 'ArrivalDateTime',
  'ChangeOfGauge', 'ClassOfService', 'DepartureAirport', 'DepartureAirportCodeContext', 'DepartureDateTime',
  'ElapsedTime', 'EquipmentType', 'Eticket', 'FlightNumber', 'FunnelFlight', 'Airport', 'Departure',
  'Informational', 'MarketingAirlineCode', 'MarketingClassOfService', 'MarketingFlightNumber', 'NumberInParty',
  'OperatingAirlineCode', 'OperatingAirlineShortName', 'OperatingClassOfService', 'OperatingFlightNumber',
  'ScheduleChangeIndicator', 'SegmentBookedDate', 'StopQuantity', 'inboundConnection', 'outboundConnection',
  'isPast', 'CodeShare', 'ProductName', 'ResBookDesigCode',
  // Respuesta y sobre
  'Timestamp', 'Success', 'RequestType', 'SubjectArea', 'ViewName', 'CreationTimestamp', 'UpdateTimestamp',
  'SystemCreationTimestamp', 'EstimatedPurgeTimestamp', 'PNRSequence',
]);
/**
 * Texto que queda tal cual solo si tiene forma de código corto, sin espacios (`MODERATE`,
 * `ERR.SP.PROVIDER_ERROR`, `CONFIRM-ALL`, `GetReservationRQ`); si no, se enmascara. `Message` y
 * `Banner` ya no pasan: un mensaje de Sabre puede repetir el nombre o el teléfono del PNR.
 */
const CODE_TEXT = new Set(['Code', 'Severity', 'Action', 'Service']);
const SHORT_CODE = /^[A-Za-z0-9][\w.:-]{0,63}$/;
/** Elementos (o atributos) con un nombre de persona: cada palabra se vigila en `leaks` (`addNames`). */
const NAME_TEXT = new Set(['LastName', 'FirstName', 'MiddleName', 'Surname', 'GivenName', 'PassengerName']);
const NAME_JSON_KEYS = new Set(['givenName', 'middleName', 'surname']);
/**
 * Palabras de un nombre que no se vigilan: las iniciales de una letra, partículas y títulos. Son
 * comunes en el resto del sobre (`LA` es una aerolínea; `Y`, una clase) y no identifican a nadie.
 */
const NAME_WORDS_IGNORED = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'DA', 'DO', 'DOS', 'DAS', 'DI', 'DU', 'LE', 'VAN', 'VON', 'MR', 'MRS', 'MS', 'MISS', 'MSTR', 'DR', 'CHD', 'INF']);
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
  'InhibitCode', 'AirExtras', 'Start', 'End', 'ISOCountry', 'encoding', 'standalone',
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
  'category', 'type', 'code', 'fieldName', 'isChangeable', 'isCancelable', 'isRefundable', 'segmentCount',
]);
/** Claves de Get Booking con un localizador (del PNR o de la aerolínea): pasan a su alias. */
const LOCATOR_JSON_KEYS = new Set(['confirmationId', 'bookingId']);
const PCC_JSON_KEYS = new Set(['targetPcc', 'userWorkPcc', 'userHomePcc', 'ticketingPcc', 'bookingPcc', 'pcc', 'pseudoCityCode', 'agencyPcc', 'creationPcc', 'owningPcc']);
const PERSON_JSON_KEYS = new Set([
  'givenName', 'middleName', 'surname', 'name', 'fullName', 'emails', 'email', 'number', 'phones', 'phone', 'address', 'street',
  'birthDate', 'documentNumber', 'text', 'freeText', 'receivedFrom', 'agentName', 'cardNumber', 'membershipId',
]);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const codePoint = (number) => (Number.isInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '');
const decode = (text) =>
  text.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g, (_, entity, decimal, hex) =>
    entity !== undefined ? ENTITIES[entity] : codePoint(decimal !== undefined ? Number(decimal) : Number.parseInt(hex, 16)),
  );
const encode = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Letras a `X`, dígitos a `9`: conserva la forma. */
export const mask = (text) => String(text).replace(/\p{L}/gu, 'X').replace(/\p{N}/gu, '9');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const localName = (name) => name.slice(name.indexOf(':') + 1);

const TAG_NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
const CLOSE_TAG = /\/([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*>/y;
const ATTRIBUTE = /(\s+)([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

/**
 * El marcado que empieza en `at` (`<` ya visto), o `undefined` si ese `<` no abre nada (queda como
 * texto, que se enmascara). Un comentario, CDATA o PI sin cerrar se come el resto del sobre como texto.
 */
function markupAt(body, at) {
  const delimited = (type, open, close) => {
    const stop = body.indexOf(close, at + open.length);
    if (stop === -1) return { type: 'text', raw: body.slice(at), end: body.length };
    return { type, inner: body.slice(at + open.length, stop), end: stop + close.length };
  };
  if (body.startsWith('<!--', at)) return delimited('comment', '<!--', '-->');
  if (body.startsWith('<![CDATA[', at)) return delimited('cdata', '<![CDATA[', ']]>');
  if (body.startsWith('<?', at)) return delimited('pi', '<?', '?>');
  if (body.startsWith('<!', at)) return delimited('doctype', '<!', '>');
  CLOSE_TAG.lastIndex = at + 1;
  const close = CLOSE_TAG.exec(body);
  if (close !== null) return { type: 'close', name: close[1], end: CLOSE_TAG.lastIndex };
  TAG_NAME.lastIndex = at + 1;
  const name = TAG_NAME.exec(body);
  if (name === null) return undefined;
  const nameEnd = TAG_NAME.lastIndex;
  if (nameEnd < body.length && !/[\s/>]/.test(body[nameEnd])) return undefined;
  // Hasta el `>` que no esté entre comillas: `Name="PEREZ>JUAN"` es un solo atributo.
  let quote;
  let index = nameEnd;
  for (; index < body.length; index += 1) {
    const char = body[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') break;
    else if (char === '<') return undefined;
  }
  if (index >= body.length) return undefined;
  let attrs = body.slice(nameEnd, index);
  const selfClosing = attrs.endsWith('/');
  if (selfClosing) attrs = attrs.slice(0, -1);
  return { type: 'open', name: name[0], attrs, selfClosing, end: index + 1 };
}

function tokenize(body) {
  const tokens = [];
  let textStart = 0;
  let at = body.indexOf('<');
  while (at !== -1) {
    const token = markupAt(body, at);
    if (token === undefined) {
      at = body.indexOf('<', at + 1);
      continue;
    }
    if (at > textStart) tokens.push({ type: 'text', raw: body.slice(textStart, at) });
    tokens.push(token);
    textStart = token.end;
    at = body.indexOf('<', textStart);
  }
  if (textStart < body.length) tokens.push({ type: 'text', raw: body.slice(textStart) });
  return tokens;
}

/**
 * Un anonimizador con memoria para una corrida. `aliasOf` es el de `createAnonymizer` (así sus
 * `leaks` ven los localizadores); `secrets`, los valores que pasan a `XXXX` donde aparezcan.
 * - `xml(body)`: un sobre STL o de colas, recorrido como tokens. Lista blanca de elementos y
 *   atributos; `RecordLocator` y `Locator` al alias; `AirlineRefId` (`DCB6*ABC123`) conserva el
 *   prefijo y da alias al localizador de la aerolínea; PCC a `XXXX`; firmas a `AAA`; lo demás,
 *   enmascarado. Solo el texto de un elemento hoja pasa por la lista blanca: el contenido mixto, los
 *   CDATA, los comentarios, las PI (salvo la declaración `<?xml`), el DOCTYPE y lo que en una
 *   etiqueta no tenga forma `nombre="valor"` se enmascaran siempre.
 * - `json(value)`: un body de Get Booking, ya parseado. Misma regla por clave, también para los números.
 * - `text(value)`: cualquier otro texto (mensajes de error, eventos del logger): solo alias y secretos.
 * - `addNames(names, field?)`: nombres de personas que `leaks` debe buscar palabra por palabra.
 *   `xml` y `json` ya agregan los de `LastName`, `FirstName`, `surname` y los demás de `NAME_TEXT`.
 * - `leaks(text)`: los campos cuyos valores de personas siguen en el texto, sin repetir.
 * - `leakDetails(text)`: los mismos, como `{ field, value }` con el valor real (solo para la consola).
 *
 * @param {{ aliasOf: (locator: string) => string, secrets?: ReadonlyArray<string | undefined> }} options
 */
export function createScrubber({ aliasOf, secrets = [] }) {
  const realSecrets = secrets.filter((s) => typeof s === 'string' && s.length >= 3).sort((a, b) => b.length - a.length);
  const locators = new Set();
  const watched = new Map();
  const names = new Map();

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
  /** Cada palabra de un nombre, sin mínimo de largo salvo las de `NAME_WORDS_IGNORED`. */
  const addNames = (values, field = 'nombre') => {
    for (const value of [values].flat()) {
      if (typeof value !== 'string') continue;
      for (const word of value.split(/[^\p{L}\p{N}'’]+/u)) {
        if (word.length < 2 || NAME_WORDS_IGNORED.has(word.toUpperCase()) || /^[X9]+$/.test(word)) continue;
        if (!names.has(word.toUpperCase())) names.set(word.toUpperCase(), field);
      }
    }
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
    let rewritten = '';
    let position = 0;
    for (;;) {
      ATTRIBUTE.lastIndex = position;
      const match = ATTRIBUTE.exec(attrs);
      if (match === null) break;
      position = ATTRIBUTE.lastIndex;
      const [, space, name, double, single] = match;
      const value = decode(double ?? single);
      let result;
      if (name.startsWith('xmlns') || SAFE_ATTRS.has(name)) result = value;
      else if (name === 'Name' && SAFE_NAME_ATTR_ELEMENTS.has(element)) result = value;
      else if (name === 'ID' && element === 'UniqueID') result = alias(value);
      else if (PCC_ATTRS.has(name)) result = value === '' ? '' : 'XXXX';
      else if (SINE_ATTRS.has(name)) result = value === '' || value === 'SABRE' ? value : 'AAA';
      else {
        if (NAME_TEXT.has(name)) addNames(value, `${element}@${name}`);
        watch(`${element}@${name}`, value, name === 'Name' || name === 'LNIATA' || NAME_TEXT.has(name));
        result = mask(value);
      }
      rewritten += `${space}${name}="${encode(result)}"`;
    }
    // Lo que no tenga forma `nombre="valor"` (no debería haber nada) se enmascara entero.
    const rest = attrs.slice(position);
    return rewritten + (rest.trim() === '' ? rest : mask(rest));
  }

  function leafText(element, raw) {
    const value = decode(raw);
    if (value.trim() === '' || value === '[REDACTED]' || SAFE_TEXT.has(element)) return raw;
    if (CODE_TEXT.has(element) && SHORT_CODE.test(value.trim())) return raw;
    if (NUMERIC_TEXT.has(element) && /^\s*\d+\s*$/.test(value)) return raw;
    if (LOCATOR_TEXT.has(element)) return encode(alias(value));
    if (element === 'AirlineRefId') return encode(airlineRef(value));
    if (PCC_TEXT.has(element)) return 'XXXX';
    if (SINE_TEXT.has(element)) return 'AAA';
    if (NAME_TEXT.has(element)) addNames(value, element);
    watch(element, value, PERSON_TEXT.has(element));
    return encode(mask(value));
  }

  /** Texto que no es el de un elemento hoja (contenido mixto, CDATA): siempre enmascarado. */
  const looseText = (parent, value) => {
    watch(parent ?? '(texto)', value, parent !== undefined && PERSON_TEXT.has(parent));
    if (parent !== undefined && NAME_TEXT.has(parent)) addNames(value, parent);
    return mask(value);
  };

  function xml(body) {
    const tokens = tokenize(String(body));
    const open = [];
    const out = tokens.map((token, index) => {
      const parent = open.at(-1);
      switch (token.type) {
        case 'open':
          if (!token.selfClosing) open.push(localName(token.name));
          return `<${token.name}${attributes(localName(token.name), token.attrs)}${token.selfClosing ? '/' : ''}>`;
        case 'close':
          open.pop();
          return `</${token.name}>`;
        case 'text': {
          const before = tokens[index - 1];
          const after = tokens[index + 1];
          const leaf = before?.type === 'open' && !before.selfClosing && after?.type === 'close' && after.name === before.name;
          if (leaf) return leafText(localName(before.name), token.raw);
          return token.raw.trim() === '' ? token.raw : encode(looseText(parent, decode(token.raw)));
        }
        case 'cdata':
          return `<![CDATA[${looseText(parent, token.inner)}]]>`;
        case 'comment':
          return `<!--${mask(token.inner)}-->`;
        case 'pi':
          return /^xml(\s|$)/.test(token.inner) ? `<?xml${attributes('?xml', token.inner.slice(3))}?>` : `<?${mask(token.inner)}?>`;
        default:
          return `<!${mask(token.inner)}>`;
      }
    });
    return finish(out.join(''));
  }

  function walk(value, key) {
    if (Array.isArray(value)) return value.map((item) => walk(item, key));
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    if (typeof value === 'number') {
      if (key !== undefined && SAFE_JSON_KEYS.has(key)) return value;
      watch(key ?? '(json)', String(value), key !== undefined && PERSON_JSON_KEYS.has(key));
      return Number(mask(String(value)));
    }
    if (typeof value !== 'string' || value === '') return value;
    if (key !== undefined && SAFE_JSON_KEYS.has(key)) return value;
    if (key !== undefined && LOCATOR_JSON_KEYS.has(key)) return airlineRef(value);
    if (key !== undefined && PCC_JSON_KEYS.has(key)) return 'XXXX';
    if (key !== undefined && NAME_JSON_KEYS.has(key)) addNames(value, key);
    watch(key ?? '(json)', value, key !== undefined && PERSON_JSON_KEYS.has(key));
    return mask(value);
  }
  const json = (value) => JSON.parse(finish(JSON.stringify(walk(value, undefined))));

  const bounded = (value, flags) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, flags);
  /** Cada valor real que siguió en el texto, con su campo: para la consola, nunca para la fixture. */
  function leakDetails(text) {
    const found = [];
    for (const [value, field] of watched) if (bounded(value, 'u').test(text)) found.push({ field, value });
    for (const [word, field] of names) if (bounded(word, 'iu').test(text)) found.push({ field, value: word });
    return found;
  }
  const leaks = (text) => [...new Set(leakDetails(text).map((leak) => leak.field))];

  return { xml, json, text: finish, alias, addNames, leaks, leakDetails };
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

/**
 * Si el error trae `code` en el código, el mensaje o alguno de sus errores anidados. Lee los campos
 * explícitos (`code`, `message`, `thrown`, `errors`), sirve con un `Error` o con lo que devuelve
 * `describeError`, y no depende de que los campos sean enumerables (a diferencia de `JSON.stringify`).
 */
export function errorMentions(error, code) {
  if (error === undefined || error === null) return false;
  if (typeof error !== 'object') return String(error).includes(code);
  const { code: own, message, thrown, errors } = error;
  if (own !== undefined && String(own) === code) return true;
  if (typeof message === 'string' && message.includes(code)) return true;
  if (typeof thrown === 'string' && thrown.includes(code)) return true;
  return Array.isArray(errors) && errors.some((nested) => errorMentions(nested, code));
}
