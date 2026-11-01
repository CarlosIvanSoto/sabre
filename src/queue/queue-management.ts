// Módulo de dominio `session.queue` (Queue Management). Las operaciones viven en la sesión porque
// necesitan su estado. Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 2 y
// decisiones de la revisión).
import { SabreBusinessError, SabreGatewayError, SabreSessionError } from '../errors/index.js';
import type { EventLogger } from '../logging/logger.js';
import type { SoapResponse } from '../http/soap-transport.js';
import { isPseudoCityCode } from '../session/credentials.js';
import type { SessionRequest } from '../session/session.js';
import {
  endOfDisplayError,
  endStep,
  MAX_REMOVE_FROM,
  MAX_SELECTIONS,
  navigationOperation,
  type QueueAccessOptions,
  type QueueAccessRequest,
  queueAccessPayload,
  queueAccessRequest,
  type QueueNavigationOptions,
  queueNavigationPayload,
  type QueueRemoveRequest,
  type QueueSelection,
  type QueueStep,
  parseQueueStep,
} from './queue-access.js';
import {
  type QueueCountOptions,
  type QueueCountRequest,
  type QueueCountResponse,
  parseQueueCountResponse,
  queueCountRequest,
} from './queue-count.js';
import {
  isInstructionCode,
  MAX_PLACE_LOCATORS,
  MAX_PLACE_TO,
  parsePlaceResult,
  parsePlaceStep,
  parsePlaceUnknown,
  type QueuePlaceOptions,
  type QueuePlaceRequest,
  type QueuePlaceResponse,
  type QueuePlaceResult,
  queuePlacePayload,
  queuePlaceRequest,
  type ResolvedPlaceTarget,
} from './queue-place.js';
import { type QueueRef, validateQueueRef } from './queue-ref.js';

/**
 * Dónde está la sesión respecto de las colas: `'outside'`, `'inside'` (hay un PNR de una cola en
 * el AAA) o `'unknown'` (una operación falló dentro de una cola, o un `access` falló sin respuesta
 * de Sabre, y no se sabe si Sabre dejó la sesión adentro). De `'unknown'` se sale con `exit()`.
 */
export type QueueState = 'outside' | 'inside' | 'unknown';

/** @internal Lo que la sesión le presta al módulo de colas. */
export interface QueueContext {
  /** Una llamada a Sabre dentro de la sesión, con uso exclusivo. */
  send(request: SessionRequest): Promise<SoapResponse>;
  /** PCC de la sesión: el default de cada operación. */
  pcc: string;
  log: EventLogger;
}

function fail(message: string): never {
  throw new TypeError(`sabre-client: ${message}`);
}

/**
 * Si el error es una respuesta clara de Sabre que rechazó el request: un `stl:Error` o un SOAP
 * fault con código. Un fallo de red, una cancelación o una respuesta que el SDK no entiende no lo
 * son: el request pudo haberse procesado.
 */
function rejectedBySabre(error: unknown): boolean {
  return error instanceof SabreBusinessError || (error instanceof SabreGatewayError && error.code !== undefined);
}

export class QueueManagement {
  readonly #context: QueueContext;
  #state: QueueState = 'outside';

  /** @internal Lo construye `SabreSession`. */
  constructor(context: QueueContext) {
    this.#context = context;
  }

  /**
   * Si la sesión está dentro de una cola. Lo lleva el SDK: `access` con un PNR la deja en
   * `'inside'`, y el fin de cola o `exit()`, en `'outside'`.
   */
  get state(): QueueState {
    return this.#state;
  }

  /**
   * Get Queue Count (`QueueCountLLSRQ` 2.2.1): cuántos mensajes o PNR hay en cada cola del PCC,
   * más los totales. Cada `queue` de la respuesta se puede pasar tal cual a las demás operaciones
   * de cola.
   *
   * Se puede llamar dentro o fuera de una cola, y no cambia `state`. Es una lectura: se reintenta
   * ante fallos transitorios. Un PCC que no tiene 3 o 4 caracteres alfanuméricos lanza
   * `TypeError` sin red.
   */
  async count(request: QueueCountRequest = {}, options: QueueCountOptions = {}): Promise<QueueCountResponse> {
    const pcc = this.#pcc(request.pcc, 'pcc');
    const response = await this.#context.send(queueCountRequest(pcc, options));
    return parseQueueCountResponse(response);
  }

  /**
   * Access Queue (`QueueAccessLLSRQ` 2.1.1): entra a una cola y devuelve su primer PNR. Una cola
   * vacía, o sin PNR que cumplan `selection`, devuelve `{ done: true }` y la sesión sigue afuera.
   *
   * Lanza `TypeError` sin red si la sesión ya está dentro de una cola (o en `'unknown'`: hay que
   * llamar a `exit()` primero), si `queue` no es de 0 a 511 o `{ name }`, o con más de 8 filtros.
   * Mueve el cursor: nunca se reintenta ante un fallo de red, y ese fallo deja `state` en
   * `'unknown'`.
   */
  async access(request: QueueAccessRequest, options: QueueAccessOptions = {}): Promise<QueueStep> {
    if (this.#state === 'inside') fail('la sesión ya está dentro de una cola: sal con queue.exit() antes de entrar a otra');
    if (this.#state === 'unknown') fail('no se sabe si la sesión sigue dentro de una cola: llama a queue.exit() antes de entrar');
    if (typeof request !== 'object' || request === null) fail('queue.access recibe { queue, pcc?, selection? }');
    validateQueueRef(request.queue, 'queue');
    const pcc = this.#pcc(request.pcc, 'pcc');
    const selection = validateSelection(request.selection);
    return this.#step(queueAccessRequest(queueAccessPayload(request.queue, pcc, selection), 'queue.access', options));
  }

  /**
   * Deja el PNR actual en la cola y pasa al siguiente (`I`). Fuera de una cola lanza `TypeError`
   * sin red.
   */
  async ignore(options: QueueNavigationOptions = {}): Promise<QueueStep> {
    this.#requireQueue('ignore');
    return this.#step(queueAccessRequest(queueNavigationPayload('I'), navigationOperation('I'), options));
  }

  /**
   * Saca el PNR actual de la cola y pasa al siguiente (`QR`). Con `from` (de 1 a 3 colas), lo saca
   * de esas colas a la vez. Fuera de una cola lanza `TypeError` sin red.
   */
  async remove(request: QueueRemoveRequest = {}, options: QueueNavigationOptions = {}): Promise<QueueStep> {
    this.#requireQueue('remove');
    const from = this.#removeFrom(request.from);
    return this.#step(queueAccessRequest(queueNavigationPayload('QR', from), navigationOperation('QR'), options));
  }

  /**
   * Sale de la cola sin cerrar la transacción (`QXI`) y deja `state` en `'outside'`. Fuera de una
   * cola lanza `TypeError` sin red. En `'unknown'` manda `QXI` igual y, si Sabre lo rechaza porque
   * la sesión ya no estaba en una cola, lo da por bueno.
   */
  async exit(options: QueueNavigationOptions = {}): Promise<void> {
    this.#requireQueue('exit');
    const before = this.#state;
    const request = queueAccessRequest(queueNavigationPayload('QXI'), navigationOperation('QXI'), options);
    try {
      await this.#context.send(request);
    } catch (error) {
      if (before === 'unknown' && error instanceof SabreBusinessError) {
        // Sabre respondió con un error de negocio: lo más probable es que ya no hubiera cola.
        // El texto exacto de "no estás en una cola" no está documentado: se confirma en #96.
        this.#context.log.emit('info', 'sabre.queue.exitTolerated', { code: error.code, error });
        this.#state = 'outside';
        return;
      }
      this.#onError(error);
      throw error;
    }
    this.#state = 'outside';
  }

  /**
   * Place Queue Message (`QueuePlaceLLSRQ` 2.0.4): coloca un PNR en 1 a 10 colas.
   *
   * - **Dentro de una cola**, coloca el PNR actual y devuelve un `QueueStep` con el siguiente,
   *   como `ignore` y `remove`. El localizador sale de la línea de firma del PNR; `placedAt` y
   *   `placedBy` quedan en `undefined`. Con `locators` lanza `TypeError` sin red: para colocar
   *   otros PNR, primero `exit()`.
   * - **Fuera de una cola**, coloca los `locators` (hasta 6) o el PNR del AAA, no avanza nada y
   *   devuelve `{ placements, text, warnings }`.
   *
   * `instructionCode` tiene que ser 0–191 o 200–254, y no tiene valor por defecto. Nunca se
   * reintenta ante un fallo de red. Errores como `BAD PNR LOCATOR` o `NEED RECEIVED FROM FIELD`
   * salen como `SabreBusinessError` (`service: 'queuePlace'`).
   */
  place(request: QueuePlaceRequest & { locators: readonly string[] }, options?: QueuePlaceOptions): Promise<QueuePlaceResult>;
  place(request: QueuePlaceRequest, options?: QueuePlaceOptions): Promise<QueuePlaceResponse>;
  async place(request: QueuePlaceRequest, options: QueuePlaceOptions = {}): Promise<QueuePlaceResponse> {
    if (typeof request !== 'object' || request === null) fail('queue.place recibe { to, locators? }');
    const to = this.#placeTo(request.to);
    const locators = validateLocators(request.locators);
    if (locators.length > 0 && this.#state === 'inside') {
      fail('queue.place con locators no se puede dentro de una cola, donde coloca el PNR actual: sal con queue.exit() antes');
    }
    if (locators.length > 0 && this.#state === 'unknown') {
      fail('no se sabe si la sesión sigue dentro de una cola: llama a queue.exit() antes de colocar por localizador');
    }
    const send = queuePlaceRequest(queuePlacePayload(to, locators), options);
    // Fuera de una cola, colocar no toca el cursor: el estado no cambia, ni con un error.
    if (this.#state === 'outside') return parsePlaceResult(await this.#context.send(send));
    return this.#advance(send, this.#state === 'inside' ? parsePlaceStep : parsePlaceUnknown);
  }

  /** Manda una operación que avanza y actualiza `state` con el resultado. */
  #step(request: SessionRequest): Promise<QueueStep> {
    return this.#advance(request, parseQueueStep);
  }

  /**
   * Manda una operación que puede mover el cursor. Un `QueueStep` fija el estado: `'outside'` con
   * el fin de cola e `'inside'` con un PNR. Cualquier otro resultado lo deja como estaba.
   */
  async #advance<T extends QueuePlaceResponse>(request: SessionRequest, parse: (response: SoapResponse) => T): Promise<T> {
    let result: T;
    try {
      result = parse(await this.#context.send(request));
    } catch (error) {
      const end = endOfDisplayError(error, request.service);
      if (end !== undefined) {
        this.#state = 'outside';
        return endStep([...end.warnings]) as T;
      }
      this.#onError(error);
      throw error;
    }
    if ('done' in result) this.#state = result.done ? 'outside' : 'inside';
    return result;
  }

  /**
   * Qué pasa con `state` cuando una operación de cola falla. Los `TypeError` del uso exclusivo y
   * los errores de sesión no lo tocan: no llegaron a Sabre, o la sesión ya no sirve. Dentro de una
   * cola, cualquier otro error deja `'unknown'`. Fuera, solo lo que no es un rechazo claro de
   * Sabre (fallo de red, cancelación, respuesta ilegible).
   */
  #onError(error: unknown): void {
    if (error instanceof TypeError || error instanceof SabreSessionError) return;
    if (this.#state === 'outside' && rejectedBySabre(error)) return;
    this.#state = 'unknown';
  }

  #placeTo(to: unknown): ResolvedPlaceTarget[] {
    if (!Array.isArray(to) || to.length === 0 || to.length > MAX_PLACE_TO) {
      fail(`to debe ser una lista de 1 a ${MAX_PLACE_TO} colas`);
    }
    return to.map((target: unknown, index) => {
      if (typeof target !== 'object' || target === null) fail(`to[${index}] debe ser { queue, pcc?, instructionCode? }`);
      const { queue, pcc, instructionCode } = target as { queue?: unknown; pcc?: unknown; instructionCode?: unknown };
      validateQueueRef(queue, `to[${index}].queue`);
      if (instructionCode !== undefined && !isInstructionCode(instructionCode)) {
        fail(`to[${index}].instructionCode debe ser un entero de 0 a 191 o de 200 a 254`);
      }
      return {
        queue,
        pcc: this.#pcc(pcc, `to[${index}].pcc`),
        ...(instructionCode === undefined ? {} : { instructionCode }),
      };
    });
  }

  #requireQueue(operation: string): void {
    if (this.#state === 'outside') fail(`queue.${operation} necesita estar dentro de una cola: entra con queue.access()`);
  }

  #pcc(value: unknown, label: string): string {
    if (value === undefined) return this.#context.pcc;
    if (!isPseudoCityCode(value)) fail(`${label} debe tener 3 o 4 caracteres alfanuméricos`);
    return value;
  }

  #removeFrom(from: unknown): Array<{ queue: QueueRef; pcc: string }> {
    if (from === undefined) return [];
    if (!Array.isArray(from) || from.length === 0 || from.length > MAX_REMOVE_FROM) {
      fail(`from debe ser una lista de 1 a ${MAX_REMOVE_FROM} colas`);
    }
    return from.map((target: unknown, index) => {
      if (typeof target !== 'object' || target === null) fail(`from[${index}] debe ser { queue, pcc? }`);
      const { queue, pcc } = target as { queue?: unknown; pcc?: unknown };
      validateQueueRef(queue, `from[${index}].queue`);
      return { queue, pcc: this.#pcc(pcc, `from[${index}].pcc`) };
    });
  }
}

function validateLocators(locators: unknown): string[] {
  if (locators === undefined) return [];
  if (!Array.isArray(locators) || locators.length === 0 || locators.length > MAX_PLACE_LOCATORS) {
    fail(`locators debe ser una lista de 1 a ${MAX_PLACE_LOCATORS} localizadores`);
  }
  return locators.map((locator: unknown, index) => {
    if (typeof locator !== 'string' || locator.trim() === '') fail(`locators[${index}] debe ser un string no vacío`);
    return locator;
  });
}

function validateSelection(selection: unknown): QueueSelection[] {
  if (selection === undefined) return [];
  if (!Array.isArray(selection)) fail('selection debe ser una lista de { function, criteria }');
  if (selection.length > MAX_SELECTIONS) fail(`selection admite hasta ${MAX_SELECTIONS} filtros`);
  return selection.map((filter: unknown, index) => {
    const { function: fn, criteria } = (typeof filter === 'object' && filter !== null ? filter : {}) as {
      function?: unknown;
      criteria?: unknown;
    };
    if (typeof fn !== 'string' || fn.trim() === '') fail(`selection[${index}].function debe ser un string no vacío`);
    if (typeof criteria !== 'string' || criteria.trim() === '') {
      fail(`selection[${index}].criteria debe ser un string no vacío`);
    }
    return { function: fn, criteria };
  });
}
