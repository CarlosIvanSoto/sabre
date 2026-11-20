// El flujo común de las escrituras de ADR-034 (`confirmAirSegments`, #268, y `removeAirSegments`,
// #269): la lectura `Stateful`, el `UpdateReservationRQ` con End Transaction y sin reintentos, la
// clasificación de sus fallos (no escrito, incierto) y el `IgnoreTransaction`. Ver sabre-wiki/wiki/
// proyectos/sabre-client/decisiones/confirmar-cambio-de-horario.md, «Precisiones de diseño».
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreBusinessError, SabreGatewayError, SabreSessionError, SabreUncertainOutcomeError, type SabreUncertainOutcomeReason } from '../errors/index.js';
import type { SabreRawRequest } from '../http/raw-request.js';
import { BUSY_CODES, isPreviousEntryActive, type SoapResponse } from '../http/soap-transport.js';
import type { EventLogger } from '../logging/logger.js';
import type { SessionRequest } from '../session/session.js';
import { isRecordLocator } from './reservation-history.js';
import {
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

/** Las opciones de una escritura de ADR-034: las de `RequestOptions`, sin reintentos. */
export interface AirSegmentUpdateOptions extends Omit<RequestOptions, 'retry'> {
  /**
   * Abortar **después** de mandar `UpdateReservationRQ` no deshace la escritura: lanza
   * `SabreUncertainOutcomeError` con `reason: 'ABORTED'`. Antes, el `AbortError` se propaga tal cual.
   */
  signal?: AbortSignal;
  /** La escritura nunca se reintenta. Solo `{ maxRetries: 0 }`, o nada; también aplica a la lectura previa. */
  retry?: { maxRetries?: number };
}

/** @internal Lo que una escritura de ADR-034 necesita de la sesión. */
export interface AirSegmentUpdateContext {
  send(request: SessionRequest): Promise<SoapResponse>;
  log?: EventLogger | undefined;
}

/** `TypeError` sin red, con el nombre de la operación. */
export function invalid(operation: string, detail: string): never {
  throw new TypeError(`sabre-client: ${operation} ${detail}`);
}

/** Lo que comparten los dos requests: `locator`, `receivedFrom` y `retry.maxRetries`. */
export function validateCommon(operation: string, request: { locator?: unknown; receivedFrom?: unknown } | null, options: AirSegmentUpdateOptions): void {
  if (typeof request !== 'object' || request === null) invalid(operation, 'necesita un request');
  if (!isRecordLocator(request.locator as string)) invalid(operation, 'necesita un localizador de 6 caracteres alfanuméricos en mayúscula');
  if (typeof request.receivedFrom !== 'string' || request.receivedFrom.trim() === '') invalid(operation, 'necesita receivedFrom');
  const retries = options.retry?.maxRetries;
  if (retries !== undefined && retries !== 0) invalid(operation, 'no se reintenta nunca: retry.maxRetries solo puede ser 0');
}

/** Una lista de ids no vacía, sin vacíos; devuelve los ids recortados y sin repetidos, en orden. */
export function validateIds(operation: string, field: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) invalid(operation, `necesita ${field} con al menos un id`);
  for (const id of value as unknown[]) if (typeof id !== 'string' || id.trim() === '') invalid(operation, `necesita ids de segmento no vacíos en ${field}`);
  return [...new Set((value as string[]).map((id) => id.trim()))];
}

/** Una escritura en curso: la operación, los callbacks y el `signal` del consumidor. */
export class AirSegmentUpdate {
  readonly #context: AirSegmentUpdateContext;
  readonly #operation: string;
  readonly #locator: string;
  readonly #options: AirSegmentUpdateOptions;
  readonly #common: Pick<SessionRequest, 'operation' | 'signal' | 'onRawResponse'>;
  readonly #withRawRequest: Pick<SessionRequest, 'onRawRequest'>;

  constructor(context: AirSegmentUpdateContext, operation: string, locator: string, options: AirSegmentUpdateOptions) {
    this.#context = context;
    this.#operation = operation;
    this.#locator = locator;
    this.#options = options;
    const { signal, onRawResponse, onRawRequest } = options;
    this.#common = {
      operation,
      ...(signal === undefined ? {} : { signal }),
      ...(onRawResponse === undefined ? {} : { onRawResponse }),
    };
    this.#withRawRequest = onRawRequest === undefined ? {} : { onRawRequest };
  }

  /**
   * 1. Lectura `Stateful`: deja el PNR en el AAA para el Update. Es una lectura: los errores del
   * transporte salen tal cual, salvo el `stl:Error`, que se envuelve en `SABRE_ERROR`.
   */
  async read(): Promise<{ response: SoapResponse; segments: ReservationAirSegment[]; warnings: ReservationUpdateWarning[] }> {
    let response: SoapResponse;
    try {
      response = await this.#context.send({
        service: UPDATE_RESERVATION_SERVICE,
        action: 'GetReservationRQ',
        payload: getReservationPayload(this.#locator),
        idempotent: true,
        ...(this.#options.retry === undefined ? {} : { retry: this.#options.retry }),
        ...this.#withRawRequest,
        ...this.#common,
      });
    } catch (error) {
      throw error instanceof SabreBusinessError ? asSabreError(error) : error;
    }
    const before = parseStlReservation(response, 'GetReservationRS');
    if (before.errors.length > 0) throw sabreErrorOf(before.errors, response);
    if (before.segments === undefined) throw notRecognized(response, 'GetReservationRS sin Reservation');
    return { response, segments: before.segments, warnings: before.warnings };
  }

  /**
   * 3. Escritura con el ET en la misma llamada. Sin ningún reintento, tampoco el esquema de
   * `PREVIOUS ENTRY ACTIVE` del transporte: sale un solo `UpdateReservationRQ`. Devuelve la
   * respuesta solo si trae `Success` y `Reservation`; lo demás lanza (no escrito o incierto).
   *
   * `deleted` son los ids que borran los `items` (`removeAirSegments`; vacío en
   * `confirmAirSegments`). Con `Errors` y sin `Success`, si hay evidencia de que algo se aplicó (un
   * `UpdateResult` `SUCCESS` en cualquiera de las dos operaciones, o un `deleted` que ya no está en
   * un `Reservation` con segmentos aéreos), es incierto con `PARTIALLY_APPLIED`, sin IG.
   */
  async write(items: readonly string[], receivedFrom: string, deleted: readonly string[] = []): Promise<{ response: SoapResponse; after: StlReservationResponse & { segments: ReservationAirSegment[] } }> {
    const { signal, onRawRequest } = this.#options;
    signal?.throwIfAborted();
    let sent = false;
    let response: SoapResponse;
    try {
      response = await this.#context.send({
        service: UPDATE_RESERVATION_SERVICE,
        action: 'UpdateReservationRQ',
        payload: updateReservationPayload(items, receivedFrom),
        idempotent: false,
        retry: { maxRetries: 0 },
        retryPreviousEntryActive: false,
        // `onRawRequest` llega si el transporte llamó a `fetch`: así se sabe si el Update salió.
        onRawRequest: (raw: SabreRawRequest) => {
          sent = true;
          onRawRequest?.(raw);
        },
        ...this.#common,
      });
    } catch (error) {
      throw await this.#updateFailure(error, sent);
    }

    let after: StlReservationResponse;
    try {
      after = parseStlReservation(response, 'UpdateReservationRS');
    } catch (error) {
      throw this.#uncertain('UNPARSEABLE', 'UpdateReservationRS no reconocido', response.raw, error);
    }
    if (after.success && after.errors.length > 0) {
      throw this.#uncertain('END_TRANSACTION_PROBLEM', `Success con Errors (${after.errors.map((e) => e.code).join(', ')})`, response.raw);
    }
    if (!after.success) {
      if (after.errors.length === 0) throw this.#uncertain('UNPARSEABLE', 'UpdateReservationRS sin Success ni Errors', response.raw);
      const applied = appliedEvidence(after, deleted);
      if (applied !== undefined) {
        throw this.#uncertain('PARTIALLY_APPLIED', `Errors (${after.errors.map((e) => e.code).join(', ')}) con ${applied}`, response.raw);
      }
      const pea = after.errors.find((e) => isPreviousEntryActive(e.message) || isPreviousEntryActive(e.code));
      if (pea !== undefined) throw this.#uncertain('PREVIOUS_ENTRY_ACTIVE', `${pea.code} ${pea.message}`, response.raw);
      // Sabre no escribió: se descarta lo que quedó pendiente en el AAA.
      await this.#ignore();
      throw sabreErrorOf(after.errors, response);
    }
    if (after.segments === undefined) throw this.#uncertain('UNPARSEABLE', 'UpdateReservationRS sin Reservation', response.raw);
    return { response, after: after as StlReservationResponse & { segments: ReservationAirSegment[] } };
  }

  #uncertain(reason: SabreUncertainOutcomeReason, detail: string, raw: unknown, cause?: unknown): SabreUncertainOutcomeError {
    return new SabreUncertainOutcomeError(
      `${UPDATE_RESERVATION_SERVICE}: no se sabe si se escribió (${detail}). Relee el PNR antes de reintentar.`,
      { operation: this.#operation, confirmationId: this.#locator, reason, raw, ...(cause === undefined ? {} : { cause }) },
    );
  }

  /**
   * Un fallo del Update que no es una respuesta legible. No se escribió (sale tal cual): la sesión
   * inutilizable y el gateway ocupado (`USG_*_BUSY`), que rechazan antes de llegar al servicio, y
   * el abort antes de mandar. Un `stl:Error` es «no escrito» (`SABRE_ERROR`, con
   * IgnoreTransaction), salvo `PREVIOUS ENTRY ACTIVE`. Lo demás pudo haber llegado a Sabre: incierto.
   */
  async #updateFailure(error: unknown, sent: boolean): Promise<unknown> {
    const make = (reason: SabreUncertainOutcomeReason, detail: string) => {
      const raw = error instanceof SabreGatewayError || error instanceof SabreBusinessError ? error.raw : undefined;
      return this.#uncertain(reason, detail, raw, error);
    };
    const aborted = (error instanceof Error && error.name === 'AbortError') || this.#options.signal?.aborted === true;
    if (aborted) return sent ? make('ABORTED', 'abort con el Update ya mandado') : error;
    if (error instanceof SabreSessionError) return error;
    if (error instanceof SabreBusinessError) {
      // `stl:ApplicationResults/Error`: no llega en las fuentes de STL 1.19. `PREVIOUS ENTRY ACTIVE`
      // dice que Sabre agotó sus reintentos internos con una entrada en curso: incierto, sin IG.
      if (isPreviousEntryActive(error.message)) return make('PREVIOUS_ENTRY_ACTIVE', error.message);
      await this.#ignore();
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
  async #ignore(): Promise<void> {
    try {
      await this.#context.send({ ...ignoreTransactionRequest(this.#operation), ...this.#common, ...this.#withRawRequest });
    } catch (error) {
      this.#context.log?.emit('warn', 'sabre.reservation.ignoreFailed', {
        operation: this.#operation,
        errorName: error instanceof Error ? error.name : typeof error,
        ...(error instanceof SabreGatewayError && error.code !== undefined ? { code: error.code } : {}),
      });
    }
  }
}

/**
 * Evidencia, en un `UpdateReservationRS` con `Errors`, de que alguna parte se aplicó: los
 * `UpdateResult` `SUCCESS`, o los `deleted` que ya no están en `Reservation`. La ausencia solo
 * cuenta si `Reservation` trae al menos un segmento aéreo: uno reducido (sin `Segments`) no dice
 * nada de lo que se borró. `undefined` si no hay evidencia.
 */
function appliedEvidence(after: StlReservationResponse, deleted: readonly string[]): string | undefined {
  const succeeded = after.updateResults.filter((result) => result.status === 'SUCCESS').map((result) => result.updateId);
  if (succeeded.length > 0) return `UpdateResult SUCCESS en UpdateId ${succeeded.join(', ')}`;
  if (after.segments === undefined || after.segments.length === 0) return undefined;
  const present = new Set(after.segments.map((segment) => segment.id));
  const gone = deleted.filter((id) => !present.has(id));
  return gone.length > 0 ? `${gone.join(', ')} ya no está en el PNR` : undefined;
}

/**
 * `UNEXPECTED_CHANGE` si `changed` trae ids que no están en `requested`: Sabre tocó (borró o
 * cambió de estado) un segmento que no se pidió. `undefined` si no.
 */
export function unexpectedChange(changed: readonly string[], requested: readonly string[], statusOf: (id: string) => string | undefined): ReservationUpdateWarning | undefined {
  const asked = new Set(requested);
  const extra = changed.filter((id) => !asked.has(id));
  if (extra.length === 0) return undefined;
  return {
    code: 'UNEXPECTED_CHANGE',
    message: `Sabre cambió segmentos que no se pidieron: ${extra.map((id) => `${id} (${statusOf(id) ?? 'ya no está'})`).join(', ')}`,
    segmentIds: extra,
  };
}

/** Los segmentos después del cambio, con el `previousStatus` de la lectura previa. */
export function withPreviousStatus(before: readonly ReservationAirSegment[], after: readonly ReservationAirSegment[]): ReservationAirSegment[] {
  const previous = new Map(before.map((segment) => [segment.id, segment.status]));
  return after.map((segment) => {
    const previousStatus = previous.get(segment.id);
    return previousStatus === undefined ? segment : { ...segment, previousStatus };
  });
}

function notRecognized(response: SoapResponse, detail: string): SabreGatewayError {
  return new SabreGatewayError(`${UPDATE_RESERVATION_SERVICE}: respuesta no reconocida (${detail})`, {
    protocol: 'soap',
    status: response.status,
    retryable: false,
    raw: response.raw,
  });
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
