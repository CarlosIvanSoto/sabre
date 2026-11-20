// `session.reservation.confirmAirSegments` (ADR-034, #268): pasa a `HK` los segmentos `TK` de un
// cambio de horario con `UpdateReservationRQ` `CONFIRM-ALL`, después de releer el PNR y comprobar
// que los `TK` son los que el consumidor espera. Ver sabre-wiki/wiki/proyectos/sabre-client/
// decisiones/confirmar-cambio-de-horario.md.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreBusinessError, SabreGatewayError, SabreSessionError, SabreUncertainOutcomeError, type SabreUncertainOutcomeReason } from '../errors/index.js';
import type { SabreRawRequest } from '../http/raw-request.js';
import { BUSY_CODES, isPreviousEntryActive, respondedAtField, type SoapResponse } from '../http/soap-transport.js';
import type { EventLogger } from '../logging/logger.js';
import type { SessionRequest } from '../session/session.js';
import { isRecordLocator } from './reservation-history.js';
import {
  CONFIRM_ALL_ITEM,
  getReservationPayload,
  ignoreTransactionRequest,
  parseStlReservation,
  type ReservationAirSegment,
  type ReservationUpdateWarning,
  SabreReservationUpdateError,
  sabreErrorOf,
  type StlReservationResponse,
  UPDATE_RESERVATION_SERVICE,
  updateReservationPayload,
} from './stl-reservation.js';

export const CONFIRM_AIR_SEGMENTS_OPERATION = 'reservation.confirmAirSegments';

export interface ConfirmAirSegmentsRequest {
  /** El localizador del PNR: 6 caracteres alfanuméricos en mayúscula. */
  locator: string;
  /** El `ReceivedFrom` de la transacción (`6` del host): quién hizo el cambio. Obligatorio. */
  receivedFrom: string;
  /**
   * Los ids (`ReservationAirSegment.id`) de los segmentos `TK` que el consumidor espera
   * confirmar, en cualquier orden. Si los `TK` del PNR no son exactamente estos, no se escribe
   * nada y lanza `SabreReservationUpdateError` con `reason: 'SEGMENTS_CHANGED'`.
   */
  expectedSegmentIds: readonly string[];
}

export interface ConfirmAirSegmentsOptions extends Omit<RequestOptions, 'retry'> {
  /**
   * Abortar **después** de mandar `UpdateReservationRQ` no deshace la escritura: lanza
   * `SabreUncertainOutcomeError` con `reason: 'ABORTED'`. Antes, el `AbortError` se propaga tal cual.
   */
  signal?: AbortSignal;
  /** La escritura nunca se reintenta. Solo `{ maxRetries: 0 }`, o nada; también aplica a la lectura previa. */
  retry?: { maxRetries?: number };
}

export interface ConfirmAirSegmentsResult {
  /** `'confirmed'`: se mandó `CONFIRM-ALL`. `'noop'`: el PNR no tenía ningún `TK` y no se escribió nada. */
  status: 'confirmed' | 'noop';
  locator: string;
  /**
   * Los segmentos aéreos del PNR después del cambio (`RetrievePNR`), con su `previousStatus` de
   * la lectura previa. Con `'noop'`, los de la lectura previa.
   */
  segments: ReservationAirSegment[];
  /** Los ids de los segmentos cuyo `status` cambió. Vacío con `'noop'`. */
  changed: string[];
  /** `NOT_APPLIED` si un segmento esperado no quedó en `HK`, y los `Warnings` de Sabre. */
  warnings: ReservationUpdateWarning[];
  /** `eb:Timestamp` de la última respuesta de Sabre, en ISO 8601 UTC. Falta si Sabre no lo manda. */
  respondedAt?: string;
}

/** @internal Lo que la operación necesita de la sesión. */
export interface ConfirmAirSegmentsContext {
  send(request: SessionRequest): Promise<SoapResponse>;
  log?: EventLogger | undefined;
}

const fail = (detail: string): never => {
  throw new TypeError(`sabre-client: reservation.confirmAirSegments ${detail}`);
};

export function validateConfirmAirSegmentsRequest(request: ConfirmAirSegmentsRequest, options: ConfirmAirSegmentsOptions): void {
  if (typeof request !== 'object' || request === null) fail('necesita un request');
  if (!isRecordLocator(request.locator)) fail('necesita un localizador de 6 caracteres alfanuméricos en mayúscula');
  if (typeof request.receivedFrom !== 'string' || request.receivedFrom.trim() === '') fail('necesita receivedFrom');
  const ids = request.expectedSegmentIds as unknown;
  if (!Array.isArray(ids) || ids.length === 0) fail('necesita expectedSegmentIds con al menos un id');
  for (const id of ids as unknown[]) if (typeof id !== 'string' || id.trim() === '') fail('necesita ids de segmento no vacíos en expectedSegmentIds');
  const retries = options.retry?.maxRetries;
  if (retries !== undefined && retries !== 0) fail('no se reintenta nunca: retry.maxRetries solo puede ser 0');
}

export async function confirmAirSegments(
  context: ConfirmAirSegmentsContext,
  request: ConfirmAirSegmentsRequest,
  options: ConfirmAirSegmentsOptions = {},
): Promise<ConfirmAirSegmentsResult> {
  validateConfirmAirSegmentsRequest(request, options);
  const { locator, receivedFrom } = request;
  const expected = [...new Set(request.expectedSegmentIds.map((id) => id.trim()))];
  const { signal, onRawResponse, onRawRequest } = options;
  const common = {
    operation: CONFIRM_AIR_SEGMENTS_OPERATION,
    ...(signal === undefined ? {} : { signal }),
    ...(onRawResponse === undefined ? {} : { onRawResponse }),
  };
  const withRawRequest = onRawRequest === undefined ? {} : { onRawRequest };

  // 1. Lectura `Stateful`: deja el PNR en el AAA para el Update. Es una lectura: los errores
  // del transporte salen tal cual, salvo el `stl:Error`, que se envuelve en `SABRE_ERROR`.
  let getResponse: SoapResponse;
  try {
    getResponse = await context.send({
      service: UPDATE_RESERVATION_SERVICE,
      action: 'GetReservationRQ',
      payload: getReservationPayload(locator),
      idempotent: true,
      ...(options.retry === undefined ? {} : { retry: options.retry }),
      ...withRawRequest,
      ...common,
    });
  } catch (error) {
    throw error instanceof SabreBusinessError ? asSabreError(error) : error;
  }
  const before = parseStlReservation(getResponse, 'GetReservationRS');
  if (before.errors.length > 0) throw sabreErrorOf(before.errors, getResponse);
  if (before.segments === undefined) throw notRecognized(getResponse, 'GetReservationRS sin Reservation');

  // 2. Chequeo local, sin escribir.
  const tk = before.segments.filter((segment) => segment.status === 'TK').map((segment) => segment.id);
  if (tk.length === 0) {
    return {
      status: 'noop',
      locator,
      segments: before.segments.map((segment) => ({ ...segment, previousStatus: segment.status })),
      changed: [],
      warnings: before.warnings,
      ...respondedAtField(getResponse.raw),
    };
  }
  if (!sameIds(tk, expected)) {
    throw new SabreReservationUpdateError(
      `${UPDATE_RESERVATION_SERVICE}: los segmentos TK del PNR (${tk.join(', ')}) no son los esperados (${expected.join(', ')}); no se escribió nada`,
      { reason: 'SEGMENTS_CHANGED', code: 'SEGMENTS_CHANGED', raw: getResponse.raw, expectedSegments: expected, actualSegments: tk },
    );
  }

  // 3. Escritura: `CONFIRM-ALL` con el ET en la misma llamada. Sin ningún reintento, tampoco el
  // esquema de `PREVIOUS ENTRY ACTIVE` del transporte: sale un solo `UpdateReservationRQ`.
  signal?.throwIfAborted();
  let sent = false;
  const ignore = () => ignoreTransaction(context, { ...common, ...withRawRequest });
  let updateResponse: SoapResponse;
  try {
    updateResponse = await context.send({
      service: UPDATE_RESERVATION_SERVICE,
      action: 'UpdateReservationRQ',
      payload: updateReservationPayload([CONFIRM_ALL_ITEM], receivedFrom),
      idempotent: false,
      retry: { maxRetries: 0 },
      retryPreviousEntryActive: false,
      // `onRawRequest` llega si el transporte llamó a `fetch`: así se sabe si el Update salió.
      onRawRequest: (raw: SabreRawRequest) => {
        sent = true;
        onRawRequest?.(raw);
      },
      ...common,
    });
  } catch (error) {
    throw await updateFailure(error, sent, locator, signal, ignore);
  }

  let after: StlReservationResponse;
  try {
    after = parseStlReservation(updateResponse, 'UpdateReservationRS');
  } catch (error) {
    throw uncertain('UNPARSEABLE', 'UpdateReservationRS no reconocido', locator, updateResponse.raw, error);
  }
  if (after.success && after.errors.length > 0) {
    throw uncertain('END_TRANSACTION_PROBLEM', `Success con Errors (${after.errors.map((e) => e.code).join(', ')})`, locator, updateResponse.raw);
  }
  if (!after.success) {
    if (after.errors.length === 0) throw uncertain('UNPARSEABLE', 'UpdateReservationRS sin Success ni Errors', locator, updateResponse.raw);
    const pea = after.errors.find((e) => isPreviousEntryActive(e.message) || isPreviousEntryActive(e.code));
    if (pea !== undefined) throw uncertain('PREVIOUS_ENTRY_ACTIVE', `${pea.code} ${pea.message}`, locator, updateResponse.raw);
    // Sabre no escribió: se descarta lo que quedó pendiente en el AAA.
    await ignore();
    throw sabreErrorOf(after.errors, updateResponse);
  }
  if (after.segments === undefined) throw uncertain('UNPARSEABLE', 'UpdateReservationRS sin Reservation', locator, updateResponse.raw);

  // 4. Resultado: `CONFIRM-ALL` no trae `Results`, así que lo que cambió sale de comparar.
  const previous = new Map(before.segments.map((segment) => [segment.id, segment.status]));
  const segments = after.segments.map((segment) => {
    const previousStatus = previous.get(segment.id);
    return previousStatus === undefined ? segment : { ...segment, previousStatus };
  });
  const changed = segments.filter((segment) => segment.previousStatus !== segment.status).map((segment) => segment.id);
  const now = new Map(segments.map((segment) => [segment.id, segment.status]));
  const notApplied = expected.filter((id) => now.get(id) !== 'HK');
  const warnings: ReservationUpdateWarning[] = [...before.warnings, ...after.warnings];
  if (notApplied.length > 0) {
    warnings.push({
      code: 'NOT_APPLIED',
      message: `Sabre respondió Success, pero ${notApplied.map((id) => `${id} (${now.get(id) ?? 'ya no está'})`).join(', ')} no quedó en HK`,
      segmentIds: notApplied,
    });
  }
  return { status: 'confirmed', locator, segments, changed, warnings, ...respondedAtField(updateResponse.raw) };
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  const set = new Set(actual);
  return set.size === expected.length && expected.every((id) => set.has(id));
}

function notRecognized(response: SoapResponse, detail: string): SabreGatewayError {
  return new SabreGatewayError(`${UPDATE_RESERVATION_SERVICE}: respuesta no reconocida (${detail})`, {
    protocol: 'soap',
    status: response.status,
    retryable: false,
    raw: response.raw,
  });
}

function uncertain(reason: SabreUncertainOutcomeReason, detail: string, locator: string, raw: unknown, cause?: unknown): SabreUncertainOutcomeError {
  return new SabreUncertainOutcomeError(
    `${UPDATE_RESERVATION_SERVICE}: no se sabe si se escribió (${detail}). Relee el PNR antes de reintentar.`,
    { operation: CONFIRM_AIR_SEGMENTS_OPERATION, confirmationId: locator, reason, raw, ...(cause === undefined ? {} : { cause }) },
  );
}

/**
 * Un `stl:ApplicationResults/Error` que lanzó el transporte, como `SabreReservationUpdateError`
 * con `reason: 'SABRE_ERROR'`: el mismo contrato que un `Errors/Error` de STL 1.19.
 */
function asSabreError(error: SabreBusinessError): SabreReservationUpdateError {
  return new SabreReservationUpdateError(error.message, {
    reason: 'SABRE_ERROR',
    code: error.code,
    raw: error.raw,
    warnings: error.warnings,
    errors: error.errors,
    cause: error,
  });
}

/**
 * Un fallo del Update que no es una respuesta legible. No se escribió (sale tal cual): la sesión
 * inutilizable y el gateway ocupado (`USG_*_BUSY`), que rechazan antes de llegar al servicio, y el
 * abort antes de mandar. Un `stl:Error` es «no escrito» (`SABRE_ERROR`, con IgnoreTransaction),
 * salvo `PREVIOUS ENTRY ACTIVE`. Lo demás pudo haber llegado a Sabre: incierto.
 */
async function updateFailure(error: unknown, sent: boolean, locator: string, signal: AbortSignal | undefined, ignore: () => Promise<void>): Promise<unknown> {
  const make = (reason: SabreUncertainOutcomeReason, detail: string) => {
    const raw = error instanceof SabreGatewayError || error instanceof SabreBusinessError ? error.raw : undefined;
    return uncertain(reason, detail, locator, raw, error);
  };
  const aborted = (error instanceof Error && error.name === 'AbortError') || signal?.aborted === true;
  if (aborted) return sent ? make('ABORTED', 'abort con el Update ya mandado') : error;
  if (error instanceof SabreSessionError) return error;
  if (error instanceof SabreBusinessError) {
    // `stl:ApplicationResults/Error`: no llega en las fuentes de STL 1.19. `PREVIOUS ENTRY ACTIVE`
    // dice que Sabre agotó sus reintentos internos con una entrada en curso: incierto, sin IG.
    if (isPreviousEntryActive(error.message)) return make('PREVIOUS_ENTRY_ACTIVE', error.message);
    await ignore();
    return asSabreError(error);
  }
  if (error instanceof SabreGatewayError && error.protocol === 'soap') {
    if (error.code !== undefined && BUSY_CODES.has(error.code)) return error;
    if (error.status === undefined) return make('TRANSPORT', 'fallo de red sin respuesta');
    // Cualquier SOAP fault (los únicos que traen `code`) o un 5xx sin sobre.
    if (error.code !== undefined || error.status >= 500) {
      return make('GATEWAY_5XX', `HTTP ${error.status}${error.code === undefined ? '' : ` ${error.code}`}`);
    }
    return make('UNPARSEABLE', `HTTP ${error.status} sin una respuesta reconocible`);
  }
  return error;
}

/**
 * `IgnoreTransactionLLSRQ` después de un error de Sabre en el Update. Lleva el `signal` y los
 * callbacks crudos del consumidor. Si falla, se avisa al logger y sigue: quien llama lanza el
 * error original.
 */
async function ignoreTransaction(context: ConfirmAirSegmentsContext, options: Partial<SessionRequest>): Promise<void> {
  try {
    await context.send({ ...ignoreTransactionRequest(CONFIRM_AIR_SEGMENTS_OPERATION), ...options });
  } catch (error) {
    context.log?.emit('warn', 'sabre.reservation.ignoreFailed', {
      operation: CONFIRM_AIR_SEGMENTS_OPERATION,
      errorName: error instanceof Error ? error.name : typeof error,
      ...(error instanceof SabreGatewayError && error.code !== undefined ? { code: error.code } : {}),
    });
  }
}
