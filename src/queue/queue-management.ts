// Módulo de dominio `session.queue` (Queue Management). Las operaciones viven en la sesión porque
// necesitan su estado. Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 2).
import { isPseudoCityCode } from '../session/credentials.js';
import type { SessionRequest } from '../session/session.js';
import type { SoapResponse } from '../http/soap-transport.js';
import {
  type QueueCountOptions,
  type QueueCountRequest,
  type QueueCountResponse,
  parseQueueCountResponse,
  queueCountRequest,
} from './queue-count.js';

/** @internal Lo que la sesión le presta al módulo de colas. */
export interface QueueContext {
  /** Una llamada a Sabre dentro de la sesión, con uso exclusivo. */
  send(request: SessionRequest): Promise<SoapResponse>;
  /** PCC de la sesión: el default de cada operación. */
  pcc: string;
}

export class QueueManagement {
  readonly #context: QueueContext;

  /** @internal Lo construye `SabreSession`. */
  constructor(context: QueueContext) {
    this.#context = context;
  }

  /**
   * Get Queue Count (`QueueCountLLSRQ` 2.2.1): cuántos mensajes o PNR hay en cada cola del PCC,
   * más los totales. Cada `queue` de la respuesta se puede pasar tal cual a las demás operaciones
   * de cola.
   *
   * Se puede llamar dentro o fuera de una cola. Es una lectura: se reintenta ante fallos
   * transitorios. Un PCC que no tiene 3 o 4 caracteres alfanuméricos lanza `TypeError` sin red.
   */
  async count(request: QueueCountRequest = {}, options: QueueCountOptions = {}): Promise<QueueCountResponse> {
    const pcc = this.#pcc(request.pcc, 'pcc');
    const response = await this.#context.send(queueCountRequest(pcc, options));
    return parseQueueCountResponse(response);
  }

  #pcc(value: unknown, label: string): string {
    if (value === undefined) return this.#context.pcc;
    if (!isPseudoCityCode(value)) throw new TypeError(`sabre-client: ${label} debe tener 3 o 4 caracteres alfanuméricos`);
    return value;
  }
}
