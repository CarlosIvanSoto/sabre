// `sabre.tickets.verify`: ¿se emitió? Lo lee de Get Booking (ADR-031, sección 5). Nunca reemite.
import type { BookingFlightTicket } from '../booking/booking-types.js';
import { isObject, nonEmpty } from '../booking/booking-errors.js';
import { type GetBookingOptions, getBooking } from '../booking/get-booking.js';
import type { RestTransport } from '../http/rest-transport.js';

/** Estados de un boleto vigente: emitido ATPCO (`TE`), EMD (`ME`) o NDC (`TO`). */
const LIVE_STATUS = new Set(['TE', 'ME', 'TO']);

export interface VerifyTicketsRequest {
  confirmationId: string;
  /** PCC de emisión, si se emitió con `targetPcc`. */
  targetPcc?: string;
  /** Números que la reserva ya tenía antes de emitir: no cuentan como nuevos. */
  knownTickets?: readonly string[];
  /**
   * Números que se esperan, p. ej. los `tickets` de un `SabreUncertainOutcomeError`. Si no están
   * en el PNR, el resultado es `notCommitted`, no `notFound`: **esos boletos existen** y no se
   * vuelve a emitir.
   */
  expectedTickets?: readonly string[];
}

/** Los callbacks crudos reciben `operation: 'booking.get'`: es el Get Booking que corre. */
export type VerifyTicketsOptions = GetBookingOptions;

/** Un boleto vigente de la reserva, como lo trae Get Booking. */
export interface VerifiedTicket {
  number: string;
  ticketStatusCode?: string;
  ticketStatusName?: string;
  date?: string;
  ticketingPcc?: string;
}

export type VerifyTicketsResponse =
  | { status: 'issued'; tickets: VerifiedTicket[]; checkedAt: string }
  | { status: 'notCommitted'; tickets: VerifiedTicket[]; missing: string[]; checkedAt: string }
  | { status: 'notFound'; checkedAt: string };

/**
 * Lee la reserva con Get Booking (lectura idempotente, con reintento) y mira el
 * `ticketStatusCode` de `flightTickets[]`, **no `isTicketed`**, que sigue en `true` después de un
 * void (CERT, 2026-11-12). Un boleto anulado (`TV`) no cuenta.
 *
 * - `issued`: hay boletos vigentes nuevos (fuera de `knownTickets`), y están todos los
 *   `expectedTickets`.
 * - `notCommitted`: faltan `expectedTickets` en el PNR (*ghost ticket*). Están emitidos: no se
 *   vuelve a emitir.
 * - `notFound`: ningún boleto vigente nuevo. **No prueba que no se haya emitido**: el guardado en
 *   el PNR puede tardar. Espera y verifica otra vez, y en producción revisa también el DQB
 *   (`session.reporting.dailySalesSummary`, por `pnrLocator`) antes de reintentar. En CERT el DQB
 *   no siempre tiene datos.
 */
export async function verifyTickets(
  transport: RestTransport,
  request: VerifyTicketsRequest,
  options: VerifyTicketsOptions = {},
  now: () => Date = () => new Date(),
): Promise<VerifyTicketsResponse> {
  if (!isObject(request) || !nonEmpty(request.confirmationId)) {
    throw new TypeError('sabre-client: tickets.verify espera { confirmationId: string, ... }');
  }
  for (const key of ['knownTickets', 'expectedTickets'] as const) {
    const list = request[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every(nonEmpty))) {
      throw new TypeError(`sabre-client: tickets.verify espera ${key} como lista de números de boleto`);
    }
  }
  const booking = await getBooking(
    transport,
    { confirmationId: request.confirmationId, ...(request.targetPcc === undefined ? {} : { targetPcc: request.targetPcc }) },
    options,
  );
  const checkedAt = now().toISOString();
  const known = new Set(request.knownTickets ?? []);
  const live = (booking.flightTickets ?? []).filter(isLive).map(toVerified);
  const fresh = live.filter((ticket) => !known.has(ticket.number));
  const expected = request.expectedTickets ?? [];
  const missing = expected.filter((number) => !live.some((ticket) => ticket.number === number));

  if (missing.length > 0) return { status: 'notCommitted', tickets: fresh, missing, checkedAt };
  if (fresh.length > 0 || expected.length > 0) return { status: 'issued', tickets: fresh, checkedAt };
  return { status: 'notFound', checkedAt };
}

function isLive(ticket: BookingFlightTicket): boolean {
  return isObject(ticket) && nonEmpty(ticket.number) && ticket.ticketStatusCode !== undefined && LIVE_STATUS.has(ticket.ticketStatusCode);
}

function toVerified(ticket: BookingFlightTicket): VerifiedTicket {
  return {
    number: ticket.number,
    ...(ticket.ticketStatusCode === undefined ? {} : { ticketStatusCode: ticket.ticketStatusCode }),
    ...(ticket.ticketStatusName === undefined ? {} : { ticketStatusName: ticket.ticketStatusName }),
    ...(ticket.date === undefined ? {} : { date: ticket.date }),
    ...(ticket.ticketingPcc === undefined ? {} : { ticketingPcc: ticket.ticketingPcc }),
  };
}
