// Ciclo de vida de una reserva: Create → Get → (revisión) → Cancel → Get.
// Es la secuencia de prueba de sabre-wiki/wiki/sdk/gestion-de-reserva.md (pasos 4 a 7) con la
// política del piloto de producción de sabre-wiki/wiki/concepts/prevencion-de-adm.md (#47, #50).
// Solo usa la API pública del SDK y Web Standard APIs. Lo corre run-booking-lifecycle.mjs y lo
// cubren los tests con `fetch` mockeado; el lock, la confirmación y la espera llegan inyectados.
import { SabreBusinessError, SabreError, SabreGatewayError } from 'sabre-client';
import { airBookingFlow } from './air-booking-flow.mjs';

/** Umbral del piloto (#50): cualquier subida sobre el precio revalidado corta el Create. */
export const PILOT_PRICE_COMPARISON = { comparisonType: 'INCREASE_BY_AMOUNT', amount: '0' };

/** Tope de la ventana de revisión antes de cancelar solo. */
export const REVIEW_TIMEOUT_MS = 15 * 60_000;

/** Secciones del Get de verificación (paso 5). */
export const VERIFY_RETURN_ONLY = ['FLIGHTS', 'TRAVELERS', 'ALL_SEGMENTS'];

/** Vuelo directo a 60–90 días (precauciones 2 y 3 de prevencion-de-adm.md). */
export const PILOT_DEPARTURE_DAYS = { min: 60, max: 90 };

/** Llega con `category: WARNING` en Cancel: la confirmación quedó pendiente y hay que leer de nuevo. */
const END_TRANSACTION_PROBLEM = 'END_TRANSACTION_PROBLEM';

/** El piloto ya corrió (o quedó a medias): no se crea otro PNR. */
export class PilotLockedError extends Error {
  name = 'PilotLockedError';

  /** @param {PilotLock} lock */
  constructor(lock) {
    super(
      lock.confirmationId === null
        ? 'el piloto tiene un Create con resultado incierto: revisa en Sabre Red y borra el lock a mano'
        : `el piloto ya corrió (localizador ${lock.confirmationId}, estado ${lock.status}): no se crea otro PNR`,
    );
    this.lock = lock;
  }
}

/** El usuario interrumpió (Ctrl+C) o rechazó la confirmación antes de Create: no hay PNR. */
export class NotBookedError extends Error {
  name = 'NotBookedError';
}

/**
 * @typedef {{
 *   environment: string,
 *   confirmationId: string | null,
 *   status: 'created' | 'uncertain' | 'cancel-pending' | 'cancelled',
 *   flights: string,
 *   createdAt: string,
 *   updatedAt: string,
 * }} PilotLock
 * Estado persistido del piloto. Sin datos del pasajero.
 *
 * @typedef {{ read(): Promise<PilotLock | undefined>, write(lock: PilotLock): Promise<void> }} LockStore
 */

/**
 * Decide, sin red, qué puede hacer una corrida:
 *
 * - `resume`: hay un lock con localizador sin cancelar; solo se puede retomar la cancelación.
 * - `create`: no hay lock y se cumplen los opt-in. En producción hacen falta los dos:
 *   `SABRE_CREATE_BOOKING=1` y `SABRE_ALLOW_PRODUCTION_BOOKING` con la fecha de hoy (un opt-in
 *   viejo no sirve), y estar lejos de la ventana de mantenimiento.
 * - `refuse`: cualquier otro caso, con el motivo.
 *
 * @param {{
 *   environment: string,
 *   createBooking?: string,
 *   allowProductionBooking?: string,
 *   lock?: PilotLock,
 *   now: Date,
 * }} options
 * @returns {{ action: 'create' } | { action: 'resume', lock: PilotLock } | { action: 'refuse', reason: string }}
 */
export function preflight({ environment, createBooking, allowProductionBooking, lock, now }) {
  if (lock !== undefined) {
    if (lock.confirmationId === null) return { action: 'refuse', reason: new PilotLockedError(lock).message };
    if (lock.status === 'cancelled') {
      return {
        action: 'refuse',
        reason: `el piloto ya corrió y quedó cancelado (localizador ${lock.confirmationId}): otra corrida requiere una nueva decisión`,
      };
    }
    return { action: 'resume', lock };
  }
  if (createBooking !== '1') {
    return {
      action: 'refuse',
      reason:
        'falta SABRE_CREATE_BOOKING=1. Este script crea un PNR; para ensayar sin crearlo usa ' +
        'run-air-booking-flow.mjs con SABRE_PREVIEW_BOOKING=1',
    };
  }
  if (environment !== 'production') return { action: 'create' };
  const today = localDate(now);
  if (allowProductionBooking !== today) {
    return {
      action: 'refuse',
      reason: `no se crea un PNR en producción: SABRE_ALLOW_PRODUCTION_BOOKING debe ser la fecha de hoy (${today})`,
    };
  }
  if (inMaintenanceWindow(now)) {
    return { action: 'refuse', reason: 'estás cerca de la ventana de mantenimiento de Sabre (00:15–00:25 CT): corre más tarde' };
  }
  return { action: 'create' };
}

/** `AAAA-MM-DD` en la zona horaria local. */
export function localDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Mantenimiento semanal de Sabre: 00:15–00:25 CT. Se evita desde 20 minutos antes (la corrida
 * puede durar la ventana de revisión entera) hasta 5 minutos después.
 */
export function inMaintenanceWindow(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  const minutes = value('hour') * 60 + value('minute');
  return minutes >= 23 * 60 + 55 || minutes < 30;
}

/**
 * Si un Create que falló seguro no creó PNR. Sabre respondió con su catálogo
 * (`SabreBusinessError`), el gateway lo rechazó antes del proveedor (4xx) o la validación local
 * lo frenó (`TypeError`). Timeouts, errores de red, 5xx y respuestas raras son inciertos.
 */
export function createFailedWithoutBooking(error) {
  if (error instanceof SabreBusinessError || error instanceof TypeError) return true;
  return error instanceof SabreGatewayError && error.status !== undefined && error.status >= 400 && error.status < 500;
}

/**
 * Ventana de revisión: resuelve con lo que pase primero, Enter (`enter` se cumple), el tope de
 * tiempo o la interrupción (`signal`).
 *
 * @param {{ enter: Promise<unknown>, timeoutMs?: number, signal?: AbortSignal }} options
 * @returns {Promise<'enter' | 'timeout' | 'interrupt'>}
 */
export function reviewWindow({ enter, timeoutMs = REVIEW_TIMEOUT_MS, signal }) {
  if (signal?.aborted) return Promise.resolve('interrupt');
  return new Promise((resolve) => {
    const done = (reason) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(reason);
    };
    const onAbort = () => done('interrupt');
    const timer = setTimeout(() => done('timeout'), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    enter.then(
      () => done('enter'),
      () => done('interrupt'),
    );
  });
}

/**
 * Corre la secuencia completa sobre el primer itinerario que Revalidate acepte.
 *
 * - Antes de Create: si hay lock, se niega; si `confirm` no aprueba o llega `signal`, no crea.
 * - Create sin `payment`, con `FUTURE_TICKETING`, `priceComparisons` y `HALT_ON_ERROR` (default).
 *   Sin reintento. Si falla sin PNR, no escribe lock; si el resultado es incierto, escribe un
 *   lock sin localizador.
 * - Con localizador: lock, Get de verificación y ventana de revisión. Pase lo que pase, Cancel
 *   y Get final en un `finally`. Un fallo antes de la revisión la salta: se cancela enseguida.
 *
 * Devuelve un informe sin datos del pasajero. `ok` es `false` si algo falló.
 *
 * @param {import('sabre-client').Sabre} sabre
 * @param {{
 *   environment: string,
 *   search: import('sabre-client').BargainFinderMaxRequest,
 *   traveler: import('sabre-client').BookTraveler,
 *   contactInfo: import('sabre-client').BookContactInformation,
 *   lock?: LockStore,
 *   confirm: (preview: BookingPreview) => Promise<boolean>,
 *   review: (context: { confirmationId: string, signal?: AbortSignal }) => Promise<'enter' | 'timeout' | 'interrupt'>,
 *   signal?: AbortSignal,
 *   onStep?: (step: string, detail: Record<string, unknown>) => void,
 *   now?: () => Date,
 * }} options
 */
export async function bookingLifecycle(sabre, options) {
  const { environment, search, traveler, contactInfo, lock, confirm, review, signal, onStep = () => {}, now = () => new Date() } =
    options;
  const existing = await lock?.read();
  if (existing !== undefined) throw new PilotLockedError(existing);

  const summary = await airBookingFlow(sabre, { search, preview: true, priceComparison: PILOT_PRICE_COMPARISON, onStep });
  /** @type {import('sabre-client').CreateBookingRequest} */
  const request = {
    ...summary.bookingPreview,
    agency: { ticketingPolicy: 'FUTURE_TICKETING' },
    travelers: [traveler],
    contactInfo,
  };
  const requested = request.flightDetails?.flights ?? [];

  /** @type {BookingPreview} */
  const preview = {
    flights: requested.map((f) => ({
      flight: `${f.airlineCode}${f.flightNumber} ${f.fromAirportCode}→${f.toAirportCode}`,
      departure: `${f.departureDate} ${f.departureTime}`,
      bookingClass: f.bookingClass,
    })),
    price: summary.revalidatedPrice,
    searchPrice: summary.searchPrice,
    traveler: `${traveler.surname}/${traveler.givenName} (${traveler.passengerCode})`,
    ticketingPolicy: 'FUTURE_TICKETING',
  };
  if (signal?.aborted) throw new NotBookedError('interrumpido antes de Create: no se creó ningún PNR');
  if (!(await confirm(preview))) throw new NotBookedError('Create no confirmado: no se creó ningún PNR');
  if (signal?.aborted) throw new NotBookedError('interrumpido antes de Create: no se creó ningún PNR');

  const flights = summary.flights;
  const stamp = () => now().toISOString();
  const createdAt = stamp();
  const timings = {};
  const timed = async (name, run) => {
    const start = Date.now();
    try {
      return await run();
    } finally {
      timings[name] = Date.now() - start;
    }
  };

  // Create va sin `signal`: abortar una escritura en vuelo dejaría el resultado incierto.
  let booking;
  try {
    booking = await timed('createMs', () => sabre.booking.create(request));
  } catch (error) {
    if (!createFailedWithoutBooking(error)) {
      await lock?.write({ environment, confirmationId: null, status: 'uncertain', flights, createdAt, updatedAt: stamp() });
    }
    throw error;
  }
  const { confirmationId } = booking;

  /** @type {BookingReport} */
  const report = {
    confirmationId,
    flights,
    price: summary.revalidatedPrice,
    create: { warnings: codes(booking.warnings), errors: codes(booking.errors) },
    verification: undefined,
    review: 'skipped',
    failure: undefined,
    cancel: undefined,
    final: undefined,
    timings,
    ok: false,
  };
  onStep('createBooking', { confirmationId, ...report.create });

  try {
    await lock?.write({ environment, confirmationId, status: 'created', flights, createdAt, updatedAt: stamp() });
    if (signal?.aborted) throw new Error('interrumpido con Ctrl+C');
    report.verification = await timed('verifyMs', () => verifyBooking(sabre, { confirmationId, requested, signal }));
    onStep('getBooking', report.verification);
    if (!report.verification.ok) throw new Error(`la reserva no coincide con lo pedido: ${report.verification.problems.join('; ')}`);
    report.review = await timed('reviewMs', () => review({ confirmationId, ...(signal === undefined ? {} : { signal }) }));
    onStep('review', { reason: report.review });
  } catch (error) {
    report.failure = describeError(error);
    onStep('failure', report.failure);
  } finally {
    await cancelAndVerify(sabre, { confirmationId, report, onStep });
    await lock?.write({
      environment,
      confirmationId,
      status: report.final?.ok ? 'cancelled' : 'cancel-pending',
      flights,
      createdAt,
      updatedAt: stamp(),
    });
  }
  report.ok =
    report.failure === undefined && report.verification?.ok === true && report.cancel?.ok === true && report.final?.ok === true;
  return report;
}

/**
 * Retoma la cancelación de un PNR que quedó en el lock: Get, Cancel solo si quedan vuelos, y
 * Get final. No crea nada.
 *
 * @param {import('sabre-client').Sabre} sabre
 * @param {{ lock: LockStore, onStep?: (step: string, detail: Record<string, unknown>) => void, now?: () => Date }} options
 */
export async function resumeCancellation(sabre, { lock, onStep = () => {}, now = () => new Date() }) {
  const existing = await lock.read();
  if (existing === undefined || existing.confirmationId === null) {
    throw new TypeError('no hay un localizador que cancelar en el lock');
  }
  const { confirmationId } = existing;
  const before = await sabre.booking.get({ confirmationId, returnOnly: ['FLIGHTS'] });
  const live = flightsOf(before).length;
  onStep('getBooking', { flights: live });

  /** @type {Pick<BookingReport, 'cancel' | 'final' | 'timings'>} */
  const report = { cancel: undefined, final: undefined, timings: {} };
  if (live === 0) {
    report.cancel = { ok: true, skipped: true, warnings: [] };
    report.final = { ok: true, flights: 0 };
  } else {
    await cancelAndVerify(sabre, { confirmationId, report, onStep });
  }
  await lock.write({
    ...existing,
    status: report.final?.ok ? 'cancelled' : 'cancel-pending',
    updatedAt: now().toISOString(),
  });
  return { confirmationId, ...report, ok: report.cancel?.ok === true && report.final?.ok === true };
}

/** Paso 5: vuelos en `HK` iguales a los pedidos, y un único pasajero `ADT`. */
export async function verifyBooking(sabre, { confirmationId, requested, signal }) {
  const booking = await sabre.booking.get(
    { confirmationId, returnOnly: VERIFY_RETURN_ONLY },
    ...(signal === undefined ? [] : [{ signal }]),
  );
  const flights = flightsOf(booking);
  const travelers = Array.isArray(booking.travelers) ? booking.travelers : [];
  const problems = [];

  if (flights.length !== requested.length) problems.push(`${flights.length} vuelos en el PNR, ${requested.length} pedidos`);
  requested.forEach((want, i) => {
    const got = flights[i];
    if (got === undefined) return;
    const fields = ['airlineCode', 'flightNumber', 'fromAirportCode', 'toAirportCode', 'departureDate', 'bookingClass'];
    for (const field of fields) {
      if (got[field] !== want[field]) problems.push(`vuelo ${i + 1}: ${field} ${got[field]} ≠ ${want[field]}`);
    }
    const time = typeof got.departureTime === 'string' ? got.departureTime.slice(0, 5) : got.departureTime;
    if (time !== want.departureTime) problems.push(`vuelo ${i + 1}: departureTime ${time} ≠ ${want.departureTime}`);
    if (got.flightStatusCode !== 'HK') problems.push(`vuelo ${i + 1}: flightStatusCode ${got.flightStatusCode} ≠ HK`);
  });
  const passengerCodes = travelers.map((t) => t?.passengerCode);
  if (passengerCodes.length !== 1 || passengerCodes[0] !== 'ADT') {
    problems.push(`pasajeros ${JSON.stringify(passengerCodes)}, se esperaba ["ADT"]`);
  }
  return {
    ok: problems.length === 0,
    problems,
    flights: flights.map((f) => ({
      flight: `${f.airlineCode}${f.flightNumber} ${f.fromAirportCode}→${f.toAirportCode}`,
      bookingClass: f.bookingClass,
      status: f.flightStatusCode,
    })),
    passengerCodes,
    warnings: codes(booking.warnings),
    errors: codes(booking.errors),
  };
}

/** Pasos 6 y 7: Cancel `cancelAll` y Get final. Nunca lanza: el resultado queda en `report`. */
async function cancelAndVerify(sabre, { confirmationId, report, onStep }) {
  const start = Date.now();
  try {
    const cancelled = await sabre.booking.cancel({ confirmationId, cancelAll: true });
    const warnings = codes(cancelled.warnings);
    report.cancel = { ok: true, warnings, ...(warnings.includes(END_TRANSACTION_PROBLEM) ? { pendingConfirmation: true } : {}) };
  } catch (error) {
    // NO_ITEMS_CANCELLED llega aquí como SabreBusinessError: cuenta como fallo.
    report.cancel = { ok: false, error: describeError(error) };
  }
  report.timings.cancelMs = Date.now() - start;
  onStep('cancelBooking', report.cancel);

  const finalStart = Date.now();
  try {
    const after = await sabre.booking.get({ confirmationId, returnOnly: ['FLIGHTS'] });
    const left = flightsOf(after).length;
    report.final = { ok: left === 0, flights: left };
  } catch (error) {
    report.final = { ok: false, error: describeError(error) };
  }
  report.timings.finalMs = Date.now() - finalStart;
  onStep('getBookingFinal', report.final);
}

function flightsOf(booking) {
  return Array.isArray(booking.flights) ? booking.flights : [];
}

function codes(list) {
  return list.map((item) => item.code);
}

/** Sin `raw`, que puede traer datos del pasajero. */
export function describeError(error) {
  if (error instanceof SabreError) {
    return {
      name: error.name,
      message: error.message,
      ...('code' in error && error.code !== undefined ? { code: error.code } : {}),
      ...('status' in error && error.status !== undefined ? { status: error.status } : {}),
      ...(error instanceof SabreBusinessError && error.warnings.length > 0 ? { warnings: codes(error.warnings) } : {}),
      ...(error instanceof SabreBusinessError && error.errors.length > 0 ? { errors: codes(error.errors) } : {}),
    };
  }
  return { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) };
}

/**
 * @typedef {{
 *   flights: Array<{ flight: string, departure: string, bookingClass: string }>,
 *   price: string | undefined,
 *   searchPrice: string | undefined,
 *   traveler: string,
 *   ticketingPolicy: 'FUTURE_TICKETING',
 * }} BookingPreview
 * Lo que se muestra en la confirmación antes de Create. Lleva el nombre del pasajero: solo va
 * a la pantalla, nunca al logger ni al informe.
 *
 * @typedef {{
 *   confirmationId: string,
 *   flights: string,
 *   price: string | undefined,
 *   create: { warnings: string[], errors: string[] },
 *   verification: Awaited<ReturnType<typeof verifyBooking>> | undefined,
 *   review: 'enter' | 'timeout' | 'interrupt' | 'skipped',
 *   failure: ReturnType<typeof describeError> | undefined,
 *   cancel: Record<string, unknown> & { ok: boolean } | undefined,
 *   final: Record<string, unknown> & { ok: boolean } | undefined,
 *   timings: Record<string, number>,
 *   ok: boolean,
 * }} BookingReport
 */
