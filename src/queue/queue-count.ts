// Get Queue Count (`QueueCountLLSRQ` 2.2.1). Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md
// (punto 2) y wiki/entities/queue-management.md (Get Queue Count y respuestas reales).
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreGatewayError, type SabreWarning } from '../errors/index.js';
import { asArray, respondedAtField, type SoapResponse, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';
import { type QueueRef, toQueueRef } from './queue-ref.js';

export const QUEUE_COUNT_SERVICE = 'queueCount';
const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';

export interface QueueCountRequest {
  /** PCC cuyas colas se cuentan. Por defecto, el de la sesión. */
  pcc?: string;
}

export type QueueCountOptions = RequestOptions;

/** Una cola con mensajes o PNR. */
export interface QueueCount {
  queue: QueueRef;
  count: number;
}

export interface QueueCountResponse {
  /** Las colas que trae la respuesta, en el orden de Sabre. Sabre no lista las vacías. */
  queues: QueueCount[];
  /**
   * Los `Totals` por `Type`: `MESSAGES`, `SPECIALS` y `PNRS`. Si Sabre no manda alguno, queda en
   * `undefined`.
   */
  totals: { messages?: number; specials?: number; pnrs?: number };
  /**
   * `QueueInfo@DateTime` tal cual llegó, sin año (`"06-25T09:46"`): la hora del host al contar.
   * Es un hecho pasado, así que el año se resuelve hacia atrás desde una fecha de referencia.
   */
  countedAt?: string;
  /** Los `stl:Warning` de la respuesta. No lanzan. */
  warnings: SabreWarning[];
  /**
   * `eb:Timestamp` de la respuesta de Sabre, en ISO 8601 UTC (`"2026-11-06T17:34:16Z"`). A
   * diferencia de las fechas del host, trae año y zona. Falta si Sabre no lo manda.
   */
  respondedAt?: string;
}

const TOTAL_TYPES = { MESSAGES: 'messages', SPECIALS: 'specials', PNRS: 'pnrs' } as const;

/** Cuerpo de `QueueCountRQ`: solo el PCC, para contar todas sus colas. */
export function queueCountPayload(pcc: string): string {
  return `<QueueCountRQ Version="2.2.1" xmlns="${NAMESPACE}"><QueueInfo><QueueIdentifier PseudoCityCode="${xmlEscape(pcc)}"/></QueueInfo></QueueCountRQ>`;
}

/** `QueueCountLLSRQ` es una lectura: se reintenta ante `USG_*_BUSY`, transitorios y red. */
export function queueCountRequest(pcc: string, options: QueueCountOptions): SessionRequest {
  return {
    service: QUEUE_COUNT_SERVICE,
    action: 'QueueCountLLSRQ',
    payload: queueCountPayload(pcc),
    idempotent: true,
    operation: 'queue.count',
    ...options,
  };
}

/**
 * Normaliza un `Count` de Sabre a número. Llega con relleno de puntos, como en la documentación
 * (`"....261"`), o sin él, como en las respuestas reales (`"6"`). Devuelve `undefined` si no es
 * un entero con ese formato.
 */
export function parseHostCount(value: string | undefined): number | undefined {
  const match = /^[.\s]*(\d+)\s*$/.exec(value ?? '');
  return match === null ? undefined : Number(match[1]);
}

type XmlNode = Record<string, unknown>;

function attribute(node: unknown, name: string): string | undefined {
  const value = (node as XmlNode | undefined)?.[`@${name}`];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Lee `QueueCountRS`. Si falta una sección, queda vacía o en `undefined`. Un `Number` o un `Count`
 * que no se puede leer es una respuesta que el SDK no entiende: lanza `SabreGatewayError` antes
 * que devolver una cuenta equivocada.
 */
export function parseQueueCountResponse(response: SoapResponse): QueueCountResponse {
  const queues: QueueCount[] = [];
  let countedAt: string | undefined;
  for (const info of asArray(response.payload.QueueInfo)) {
    countedAt ??= nonEmpty(attribute(info, 'DateTime'));
    for (const identifier of asArray((info as XmlNode).QueueIdentifier)) {
      const number = attribute(identifier, 'Number');
      const queue = toQueueRef(number);
      const count = parseHostCount(attribute(identifier, 'Count'));
      if (queue === undefined || count === undefined) {
        throw malformed(`QueueIdentifier con Number="${number ?? ''}" y Count="${attribute(identifier, 'Count') ?? ''}"`, response);
      }
      queues.push({ queue, count });
    }
  }

  const totals: QueueCountResponse['totals'] = {};
  for (const total of asArray(response.payload.Totals)) {
    const key = TOTAL_TYPES[(attribute(total, 'Type') ?? '').toUpperCase() as keyof typeof TOTAL_TYPES];
    if (key === undefined) continue;
    const count = parseHostCount(attribute(total, 'Count'));
    if (count === undefined) throw malformed(`Totals ${key} con Count="${attribute(total, 'Count') ?? ''}"`, response);
    totals[key] = count;
  }

  return {
    queues,
    totals,
    ...(countedAt === undefined ? {} : { countedAt }),
    warnings: response.warnings,
    ...respondedAtField(response.raw),
  };
}

function malformed(detail: string, response: SoapResponse): SabreGatewayError {
  return new SabreGatewayError(`${QUEUE_COUNT_SERVICE}: respuesta no reconocida (${detail})`, {
    protocol: 'soap',
    status: response.status,
    retryable: false,
    raw: response.raw,
  });
}

function nonEmpty(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text === undefined || text === '' ? undefined : text;
}
