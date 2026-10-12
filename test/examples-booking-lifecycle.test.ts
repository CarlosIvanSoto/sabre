// El ciclo Create → Get → revisión → Cancel → Get de examples/, con `fetch` mockeado (sin red).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { oneWaySearch } from '../examples/air-booking-flow.mjs';
import {
  bookingLifecycle,
  inMaintenanceWindow,
  NotBookedError,
  PilotLockedError,
  preflight,
  resumeCancellation,
  reviewWindow,
  VERIFY_RETURN_ONLY,
} from '../examples/booking-lifecycle.mjs';
import type { PilotLock } from '../examples/booking-lifecycle.mjs';
import { Sabre } from '../src/index.js';
import direct from './fixtures/revalidate-itinerary.sandbox-direct.json';
import { config, json } from './helpers.js';

const search = oneWaySearch({ pcc: 'XXXX', origin: 'DFW', destination: 'LAX', departureDateTime: '2026-12-20T10:00:00', maxStops: 0 });
const traveler = {
  givenName: 'REALNAME',
  surname: 'REALSURNAME',
  passengerCode: 'ADT',
  emails: ['real@example.com'],
  phones: [{ number: '5551234567', label: 'M' as const }],
};
const contactInfo = { emails: ['real@example.com'], phones: ['5551234567'] };
const LOCATOR = 'PILOTX';

type Body = Record<string, unknown>;
type FlightToBook = { departureTime: string; [field: string]: unknown };

interface Script {
  create?: (body: Body) => Response;
  /** Respuestas de Get en orden; por defecto, el PNR tal como se pidió y luego vacío. */
  gets?: Array<(requested: FlightToBook[]) => Response>;
  cancel?: () => Response;
}

const liveBooking = (requested: FlightToBook[], status = 'HK') =>
  json(200, {
    bookingId: LOCATOR,
    flights: requested.map((f, i) => ({ ...f, itemId: String(i + 1), departureTime: `${f.departureTime}:00`, flightStatusCode: status })),
    travelers: [{ givenName: 'REALNAME', surname: 'REALSURNAME', passengerCode: 'ADT' }],
    errors: [{ category: 'WARNING', type: 'RESOURCE_UNAVAILABLE', description: 'fare rules' }],
  });
const emptyBooking = () => json(200, { bookingId: LOCATOR });

function client(script: Script = {}) {
  let requested: FlightToBook[] = [];
  const gets = script.gets ?? [(r) => liveBooking(r), () => emptyBooking()];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    if (url.includes('/auth/token')) return json(200, { access_token: 'T1', expires_in: 604800, token_type: 'bearer' });
    const body = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Body);
    if (url.includes('/v5/offers/shop')) return json(200, direct.search.response.body);
    if (url.includes('/v5/shop/flights/revalidate')) return json(200, direct.response.body);
    if (url.includes('/v1/trip/orders/createBooking')) {
      requested = (body.flightDetails as { flights: FlightToBook[] }).flights;
      return script.create?.(body) ?? json(200, { confirmationId: LOCATOR, booking: { bookingId: LOCATOR } });
    }
    if (url.includes('/v1/trip/orders/getBooking')) {
      const next = gets.shift();
      if (next === undefined) throw new Error('Get de más');
      return next(requested);
    }
    if (url.includes('/v1/trip/orders/cancelBooking')) return script.cancel?.() ?? json(200, { timestamp: 'now' });
    throw new Error(`URL inesperada: ${url}`);
  });
  return { fetch, sabre: new Sabre(config({ fetch, retry: { maxRetries: 0 } })) };
}

const calls = (fetch: ReturnType<typeof client>['fetch'], path: string) =>
  fetch.mock.calls.filter(([input]) => String(input).includes(path)).map(([, init]) => JSON.parse(String(init?.body)) as Body);

function memoryLock(initial?: Partial<PilotLock>) {
  const writes: PilotLock[] = [];
  let state = initial === undefined ? undefined : ({ environment: 'production', flights: '', createdAt: '', updatedAt: '', ...initial } as PilotLock);
  return {
    writes,
    store: {
      read: async () => state,
      write: async (next: PilotLock) => {
        writes.push(next);
        state = next;
      },
    },
  };
}

function run(sabre: Sabre, overrides: Record<string, unknown> = {}) {
  const steps: string[] = [];
  const lock = memoryLock();
  const review = vi.fn(async () => 'enter' as const);
  const confirm = vi.fn(async (_preview: unknown) => true);
  const promise = bookingLifecycle(sabre, {
    environment: 'production',
    search,
    traveler,
    contactInfo,
    ticketingPcc: 'XXXX',
    lock: lock.store,
    now: () => new Date('2026-10-11T18:00:00Z'),
    confirm,
    review,
    onStep: (step: string) => steps.push(step),
    ...overrides,
  });
  return { promise, steps, lock, review, confirm };
}

describe('examples/booking-lifecycle: secuencia', () => {
  it('feliz: crea con la política del piloto, verifica, espera la revisión, cancela y verifica vacío', async () => {
    const { fetch, sabre } = client();
    const { promise, steps, lock, review, confirm } = run(sabre);
    const report = await promise;

    expect(steps).toEqual([
      'bargainFinderMax',
      'revalidateItinerary',
      'createBookingPreview',
      'createBooking',
      'getBooking',
      'review',
      'cancelBooking',
      'getBookingFinal',
    ]);
    expect(report).toMatchObject({
      ok: true,
      confirmationId: LOCATOR,
      review: 'enter',
      verification: { ok: true, passengerCodes: ['ADT'], warnings: ['RESOURCE_UNAVAILABLE'] },
      cancel: { ok: true },
      final: { ok: true, flights: 0 },
    });
    expect(Object.keys(report.timings).sort()).toEqual(['cancelMs', 'createMs', 'finalMs', 'reviewMs', 'verifyMs']);
    expect(review).toHaveBeenCalledWith({ confirmationId: LOCATOR });

    // La confirmación muestra vuelo, clase, precio y pasajero antes de Create.
    const preview = confirm.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(preview).toMatchObject({ traveler: 'REALSURNAME/REALNAME (ADT)', ticketingPolicy: 'FUTURE_TICKETING' });
    expect(preview.price).toBe(report.price);

    const [create] = calls(fetch, '/createBooking');
    const tomorrow = new Date('2026-10-12T18:00:00Z');
    const ticketingDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    expect(create).toMatchObject({ travelers: [traveler], contactInfo });
    // Sabre exige futureTicketingPolicy con FUTURE_TICKETING (MANDATORY_DATA_MISSING en producción).
    expect(create!.agency).toEqual({ ticketingPolicy: 'FUTURE_TICKETING', futureTicketingPolicy: { ticketingDate, ticketingPcc: 'XXXX' } });
    expect(preview.ticketingDate).toBe(ticketingDate);
    expect(create).not.toHaveProperty('payment');
    expect(create).not.toHaveProperty('errorHandlingPolicy');
    const pricing = (create!.flightDetails as { flightPricing: Array<{ priceComparisons: unknown[] }> }).flightPricing[0]!;
    const total = direct.response.body.groupedItineraryResponse.itineraryGroups[0]!.itineraries[0]!.pricingInformation[0]!.fare
      .totalFare.totalPrice;
    expect(pricing.priceComparisons).toEqual([{ desiredAmount: String(total), comparisonType: 'INCREASE_BY_AMOUNT', amount: '0' }]);

    expect(calls(fetch, '/getBooking')).toEqual([
      { confirmationId: LOCATOR, returnOnly: VERIFY_RETURN_ONLY },
      { confirmationId: LOCATOR, returnOnly: ['FLIGHTS'] },
    ]);
    expect(calls(fetch, '/cancelBooking')).toEqual([{ confirmationId: LOCATOR, cancelAll: true }]);
    expect(fetch.mock.calls.filter(([input]) => String(input).includes('/auth/token'))).toHaveLength(1);

    // El lock se escribe apenas llega el localizador y termina en `cancelled`.
    expect(lock.writes.map((w) => [w.confirmationId, w.status])).toEqual([
      [LOCATOR, 'created'],
      [LOCATOR, 'cancelled'],
    ]);
    // Ni el informe ni el lock llevan datos del pasajero.
    expect(JSON.stringify([report, lock.writes])).not.toMatch(/REAL|5551234567/);
  });

  it('si la verificación falla, cancela enseguida sin ventana de revisión', async () => {
    const { fetch, sabre } = client({ gets: [(r) => liveBooking(r, 'UC'), () => emptyBooking()] });
    const { promise, steps, review, lock } = run(sabre);
    const report = await promise;

    expect(review).not.toHaveBeenCalled();
    expect(steps.slice(-4)).toEqual(['getBooking', 'failure', 'cancelBooking', 'getBookingFinal']);
    expect(report.ok).toBe(false);
    expect(report.review).toBe('skipped');
    expect(report.verification?.problems.join()).toMatch(/flightStatusCode UC ≠ HK/);
    expect(report.failure?.message).toMatch(/no coincide/);
    expect(calls(fetch, '/cancelBooking')).toHaveLength(1);
    expect(report.final).toEqual({ ok: true, flights: 0 });
    expect(lock.writes.at(-1)?.status).toBe('cancelled');
  });

  it('si Get de verificación lanza, cancela igual', async () => {
    const { fetch, sabre } = client({
      gets: [
        () => json(200, { errors: [{ category: 'APPLICATION_ERROR', type: 'BOOKING_NOT_FOUND', description: 'x' }] }),
        () => emptyBooking(),
      ],
    });
    const report = await run(sabre).promise;
    expect(report.failure).toMatchObject({ name: 'SabreBusinessError', code: 'BOOKING_NOT_FOUND' });
    expect(calls(fetch, '/cancelBooking')).toHaveLength(1);
  });

  it('Ctrl+C durante la revisión cancela', async () => {
    const { fetch, sabre } = client();
    const controller = new AbortController();
    const review = ({ signal }: { signal?: AbortSignal }) => {
      const result = reviewWindow({ enter: new Promise(() => {}), ...(signal === undefined ? {} : { signal }) });
      controller.abort();
      return result;
    };
    const report = await run(sabre, { review, signal: controller.signal }).promise;
    expect(report.review).toBe('interrupt');
    expect(calls(fetch, '/cancelBooking')).toHaveLength(1);
    expect(report.ok).toBe(true);
  });

  it('un error en la ventana de revisión no impide cancelar', async () => {
    const { fetch, sabre } = client();
    const report = await run(sabre, { review: async () => Promise.reject(new Error('stdin cerrado')) }).promise;
    expect(report.failure).toEqual({ name: 'Error', message: 'stdin cerrado' });
    expect(calls(fetch, '/cancelBooking')).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  it('NO_ITEMS_CANCELLED cuenta como fallo y deja el lock pendiente si quedan vuelos', async () => {
    const { sabre } = client({
      cancel: () => json(200, { errors: [{ category: 'WARNING', type: 'NO_ITEMS_CANCELLED', description: 'nada' }] }),
      gets: [(r) => liveBooking(r), (r) => liveBooking(r)],
    });
    const { promise, lock } = run(sabre);
    const report = await promise;
    expect(report.cancel).toMatchObject({ ok: false, error: { code: 'NO_ITEMS_CANCELLED' } });
    expect(report.final).toMatchObject({ ok: false });
    expect(report.final?.flights).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
    expect(lock.writes.at(-1)).toMatchObject({ confirmationId: LOCATOR, status: 'cancel-pending' });
  });

  it('END_TRANSACTION_PROBLEM en Cancel se resuelve con el Get final', async () => {
    const { sabre } = client({
      cancel: () => json(200, { errors: [{ category: 'WARNING', type: 'END_TRANSACTION_PROBLEM', description: 'x' }] }),
    });
    const report = await run(sabre).promise;
    expect(report.cancel).toEqual({ ok: true, warnings: ['END_TRANSACTION_PROBLEM'], pendingConfirmation: true });
    expect(report.final).toEqual({ ok: true, flights: 0 });
    expect(report.ok).toBe(true);
  });

  it('acepta el localizador de UNABLE_TO_RETRIEVE_BOOKING y lo persiste', async () => {
    const { sabre } = client({
      create: () =>
        json(200, {
          errors: [
            {
              category: 'WARNING',
              type: 'UNABLE_TO_RETRIEVE_BOOKING',
              description: `Booking was created successfully but could not be retrieved. (${LOCATOR})`,
            },
          ],
        }),
    });
    const { promise, lock } = run(sabre);
    const report = await promise;
    expect(report.create.warnings).toEqual(['UNABLE_TO_RETRIEVE_BOOKING']);
    expect(lock.writes[0]).toMatchObject({ confirmationId: LOCATOR, status: 'created' });
  });
});

describe('examples/booking-lifecycle: sin PNR', () => {
  it('con lock existente se niega antes de llamar a la red', async () => {
    const { fetch, sabre } = client();
    const lock = memoryLock({ confirmationId: LOCATOR, status: 'cancelled' });
    await expect(run(sabre, { lock: lock.store }).promise).rejects.toThrow(PilotLockedError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('si no se confirma, no llama a Create', async () => {
    const { fetch, sabre } = client();
    const { promise, lock } = run(sabre, { confirm: async () => false });
    await expect(promise).rejects.toThrow(NotBookedError);
    expect(calls(fetch, '/v1/trip/orders/')).toHaveLength(0);
    expect(lock.writes).toEqual([]);
  });

  it('si se interrumpe antes de Create, no llama a Create', async () => {
    const { fetch, sabre } = client();
    const controller = new AbortController();
    const confirm = async () => {
      controller.abort();
      return true;
    };
    await expect(run(sabre, { confirm, signal: controller.signal }).promise).rejects.toThrow(NotBookedError);
    expect(calls(fetch, '/v1/trip/orders/')).toHaveLength(0);
  });

  it('Create rechazado por Sabre (UNAUTHORIZED) no escribe lock: la corrida no se consume', async () => {
    const { fetch, sabre } = client({
      create: () =>
        json(200, { errors: [{ category: 'UNAUTHORIZED', type: 'UNAUTHORIZED_ACCESS', description: 'Expired or invalid security token' }] }),
    });
    const { promise, lock } = run(sabre);
    await expect(promise).rejects.toMatchObject({ name: 'SabreBusinessError', code: 'UNAUTHORIZED_ACCESS' });
    expect(lock.writes).toEqual([]);
    expect(calls(fetch, '/createBooking')).toHaveLength(1);
    expect(calls(fetch, '/cancelBooking')).toHaveLength(0);
  });

  it('Create con resultado incierto (HTTP 500) escribe un lock sin localizador y no reintenta', async () => {
    const { fetch, sabre } = client({ create: () => json(500, {}) });
    const { promise, lock } = run(sabre);
    await expect(promise).rejects.toMatchObject({ name: 'SabreGatewayError', status: 500 });
    expect(lock.writes).toEqual([expect.objectContaining({ confirmationId: null, status: 'uncertain' })]);
    expect(calls(fetch, '/createBooking')).toHaveLength(1);
  });
});

describe('examples/booking-lifecycle: resumeCancellation', () => {
  it('cancela el localizador del lock si sigue con vuelos', async () => {
    const { fetch, sabre } = client({
      gets: [() => json(200, { bookingId: LOCATOR, flights: [{ itemId: '1' }] }), () => emptyBooking()],
    });
    const lock = memoryLock({ confirmationId: LOCATOR, status: 'cancel-pending', flights: 'AA1 DFW→LAX' });
    const result = await resumeCancellation(sabre, { lock: lock.store });
    expect(result).toMatchObject({ ok: true, confirmationId: LOCATOR, final: { ok: true, flights: 0 } });
    expect(calls(fetch, '/cancelBooking')).toEqual([{ confirmationId: LOCATOR, cancelAll: true }]);
    expect(calls(fetch, '/createBooking')).toHaveLength(0);
    expect(lock.writes.at(-1)).toMatchObject({ confirmationId: LOCATOR, status: 'cancelled' });
  });

  it('no cancela si el PNR ya no tiene vuelos', async () => {
    const { fetch, sabre } = client({ gets: [() => emptyBooking()] });
    const lock = memoryLock({ confirmationId: LOCATOR, status: 'created', flights: 'AA1 DFW→LAX' });
    const result = await resumeCancellation(sabre, { lock: lock.store });
    expect(result.ok).toBe(true);
    expect(calls(fetch, '/cancelBooking')).toHaveLength(0);
    expect(lock.writes.at(-1)?.status).toBe('cancelled');
  });
});

describe('examples/booking-lifecycle: preflight', () => {
  // 13:00 CT, lejos del mantenimiento. `today` en la zona local, como la compara preflight.
  const now = new Date('2026-10-11T18:00:00Z');
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const prod = { environment: 'production', now };

  it('en producción exige los dos opt-in, con la fecha de hoy', () => {
    expect(preflight({ ...prod }).action).toBe('refuse');
    expect(preflight({ ...prod, allowProductionBooking: today }).action).toBe('refuse');
    expect(preflight({ ...prod, createBooking: '1' })).toMatchObject({ action: 'refuse', reason: /SABRE_ALLOW_PRODUCTION_BOOKING/ });
    expect(preflight({ ...prod, createBooking: '1', allowProductionBooking: '2026-10-01' })).toMatchObject({
      action: 'refuse',
      reason: /fecha de hoy/,
    });
    expect(preflight({ ...prod, createBooking: 'true', allowProductionBooking: today }).action).toBe('refuse');
  });

  it('con los dos opt-in y sin lock, permite crear', () => {
    expect(preflight({ ...prod, createBooking: '1', allowProductionBooking: today })).toEqual({ action: 'create' });
  });

  it('en sandbox basta SABRE_CREATE_BOOKING=1', () => {
    expect(preflight({ environment: 'sandbox', now }).action).toBe('refuse');
    expect(preflight({ environment: 'sandbox', createBooking: '1', now })).toEqual({ action: 'create' });
  });

  it('con un lock vivo solo permite retomar la cancelación, aunque haya opt-in', () => {
    const lock = { environment: 'production', confirmationId: LOCATOR, status: 'cancel-pending' as const, flights: '', createdAt: '', updatedAt: '' };
    expect(preflight({ ...prod, createBooking: '1', allowProductionBooking: today, lock })).toEqual({ action: 'resume', lock });
    expect(preflight({ ...prod, lock: { ...lock, status: 'cancelled' } })).toMatchObject({ action: 'refuse', reason: /nueva decisión/ });
    expect(preflight({ ...prod, lock: { ...lock, confirmationId: null, status: 'uncertain' } })).toMatchObject({
      action: 'refuse',
      reason: /incierto/,
    });
  });

  it('se niega cerca de la ventana de mantenimiento (00:15–00:25 CT)', () => {
    // 2026-10-11 es CDT (UTC-5): 00:15 CT = 05:15 UTC.
    expect(inMaintenanceWindow(new Date('2026-10-11T04:54:00Z'))).toBe(false);
    expect(inMaintenanceWindow(new Date('2026-10-11T04:55:00Z'))).toBe(true);
    expect(inMaintenanceWindow(new Date('2026-10-11T05:20:00Z'))).toBe(true);
    expect(inMaintenanceWindow(new Date('2026-10-11T05:30:00Z'))).toBe(false);
  });
});

describe('examples/booking-lifecycle: reviewWindow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resuelve con Enter', async () => {
    await expect(reviewWindow({ enter: Promise.resolve('') })).resolves.toBe('enter');
  });

  it('vence a los 15 minutos', async () => {
    vi.useFakeTimers();
    const result = reviewWindow({ enter: new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('timeout');
  });

  it('resuelve con la interrupción, también si ya llegó', async () => {
    const controller = new AbortController();
    const result = reviewWindow({ enter: new Promise(() => {}), signal: controller.signal });
    controller.abort();
    await expect(result).resolves.toBe('interrupt');
    await expect(reviewWindow({ enter: new Promise(() => {}), signal: controller.signal })).resolves.toBe('interrupt');
  });
});
