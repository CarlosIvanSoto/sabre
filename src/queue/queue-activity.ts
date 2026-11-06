// Get Queue Activity (`QueueAnalysisLLSRQ` 2.0.0). Ver
// sabre-wiki/wiki/proyectos/sabre-client/decisiones/tier-4-colas-avanzadas.md (A1),
// wiki/sources/get-queue-activity-v2-0-0-design.md y wiki/entities/queue-management.md.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreGatewayError, type SabreWarning } from '../errors/index.js';
import { asArray, respondedAtField, type SoapResponse, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';
import { parseHostCount } from './queue-count.js';
import { type QueueRef, toQueueRef } from './queue-ref.js';

export const QUEUE_ACTIVITY_SERVICE = 'queueAnalysis';
const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';

export interface QueueActivityRequest {
  /** PCC cuyas colas se analizan. Por defecto, el de la sesión. */
  pcc?: string;
}

export type QueueActivityOptions = RequestOptions;

/**
 * Los ocho contadores de Get Queue Activity, con los nombres de Sabre. La pantalla `QA` del host los
 * muestra en columnas (`ON Q`, `REMOVD`, …). Ninguna fuente dice desde cuándo cuentan (Q-097): el
 * SDK los devuelve sin interpretar.
 */
export interface QueueActivityCounters {
  /** `NumMessages`: los mensajes o PNR que están hoy en la cola (`ON Q`). */
  numMessages: number;
  /** `Ended`: los terminados en la cola. */
  ended: number;
  /** `Ignored`: los ignorados (`I`). */
  ignored: number;
  /** `Moved`: los movidos a otra cola. */
  moved: number;
  /** `Removed`: los sacados de la cola (`QR`). */
  removed: number;
  /** `Transferred`: los transferidos. */
  transferred: number;
  /** `LeftMessageToContact`: con un mensaje dejado al contacto. */
  leftMessageToContact: number;
  /** `UnableToReach`: los que no se pudo contactar. */
  unableToReach: number;
}

/** Los contadores de una cola. Sabre lista también colas vacías con contadores. */
export interface QueueActivity extends QueueActivityCounters {
  /** La cola, como en `count`: `400`, `'S'` o `{ name }`. Se pasa tal cual a las demás operaciones. */
  queue: QueueRef;
}

export interface QueueActivityResponse {
  /** Las colas que trae la respuesta, en el orden de Sabre. */
  queues: QueueActivity[];
  /** `Totals`: los ocho contadores sumados para el PCC. Sin `Totals`, `undefined`. */
  totals?: QueueActivityCounters;
  /**
   * `QueueInfo@DateTime` tal cual llegó, sin año (`"11-06T11:33"`): la hora del host al analizar.
   * Es un hecho pasado, así que el año se resuelve hacia atrás, como `countedAt`.
   */
  analyzedAt?: string;
  /** Los `stl:Warning` de la respuesta. No lanzan. */
  warnings: SabreWarning[];
  /** `eb:Timestamp` de la respuesta de Sabre, en ISO 8601 UTC. Falta si Sabre no lo manda. */
  respondedAt?: string;
}

/** Elemento de Sabre → contador. */
const COUNTERS: ReadonlyArray<[string, keyof QueueActivityCounters]> = [
  ['NumMessages', 'numMessages'],
  ['Ended', 'ended'],
  ['Ignored', 'ignored'],
  ['Moved', 'moved'],
  ['Removed', 'removed'],
  ['Transferred', 'transferred'],
  ['LeftMessageToContact', 'leftMessageToContact'],
  ['UnableToReach', 'unableToReach'],
];

/** Cuerpo de `QueueAnalysisRQ`: solo el PCC, para analizar todas sus colas (`QA/<PCC>`). */
export function queueActivityPayload(pcc: string): string {
  return `<QueueAnalysisRQ Version="2.0.0" xmlns="${NAMESPACE}"><QueueInfo><QueueIdentifier PseudoCityCode="${xmlEscape(pcc)}"/></QueueInfo></QueueAnalysisRQ>`;
}

/**
 * `QueueAnalysisLLSRQ` es una lectura: se reintenta ante `USG_*_BUSY`, transitorios y red. No pide
 * duty code 9, aunque el sample lo diga (CERT y producción, Q-098).
 */
export function queueActivityRequest(pcc: string, options: QueueActivityOptions): SessionRequest {
  return {
    service: QUEUE_ACTIVITY_SERVICE,
    action: 'QueueAnalysisLLSRQ',
    payload: queueActivityPayload(pcc),
    idempotent: true,
    operation: 'queue.activity',
    ...options,
  };
}

type XmlNode = Record<string, unknown>;

function attribute(node: unknown, name: string): string | undefined {
  const value = (Array.isArray(node) ? node[0] : (node as XmlNode | undefined))?.[`@${name}`];
  return typeof value === 'string' ? value : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text === undefined || text === '' ? undefined : text;
}

/**
 * Lee `QueueAnalysisRS`. Un `Number` que no se puede leer, o un contador que falta o no es un
 * entero, es una respuesta que el SDK no entiende: lanza `SabreGatewayError` antes que devolver un
 * contador equivocado.
 */
export function parseQueueActivityResponse(response: SoapResponse): QueueActivityResponse {
  const queues: QueueActivity[] = [];
  let analyzedAt: string | undefined;
  for (const info of asArray(response.payload.QueueInfo)) {
    analyzedAt ??= nonEmpty(attribute(info, 'DateTime'));
    for (const identifier of asArray((info as XmlNode).QueueIdentifier)) {
      // `Number` trae las numéricas y las alfabéticas ("400", "S"); `Name`, las con nombre (ADR-028).
      const number = attribute(identifier, 'Number');
      const name = nonEmpty(attribute(identifier, 'Name'));
      const queue: QueueRef | undefined = number === undefined && name !== undefined ? { name } : toQueueRef(number);
      if (queue === undefined) throw malformed(`QueueIdentifier con Number="${number ?? ''}"`, response);
      queues.push({ queue, ...counters(identifier, `la cola ${number ?? name}`, response) });
    }
  }
  const totalsNode = asArray(response.payload.Totals)[0];
  const totals = totalsNode === undefined ? undefined : counters(totalsNode, 'Totals', response);

  return {
    queues,
    ...(totals === undefined ? {} : { totals }),
    ...(analyzedAt === undefined ? {} : { analyzedAt }),
    warnings: response.warnings,
    ...respondedAtField(response.raw),
  };
}

function counters(node: unknown, label: string, response: SoapResponse): QueueActivityCounters {
  const result = {} as QueueActivityCounters;
  for (const [element, key] of COUNTERS) {
    const raw = attribute((node as XmlNode)[element], 'Count');
    const count = parseHostCount(raw);
    if (count === undefined) throw malformed(`${label} con ${element} Count="${raw ?? ''}"`, response);
    result[key] = count;
  }
  return result;
}

function malformed(detail: string, response: SoapResponse): SabreGatewayError {
  return new SabreGatewayError(`${QUEUE_ACTIVITY_SERVICE}: respuesta no reconocida (${detail})`, {
    protocol: 'soap',
    status: response.status,
    retryable: false,
    raw: response.raw,
  });
}
