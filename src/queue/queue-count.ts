// Get Queue Count (`QueueCountLLSRQ` 2.2.1). Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md
// (punto 2) y wiki/entities/queue-management.md (Get Queue Count y respuestas reales).
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreGatewayError, type SabreWarning } from '../errors/index.js';
import { asArray, respondedAtField, type SoapResponse } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';
import { type QueueSelection, selectionXml } from './queue-access.js';
import { type QueueRange, type QueueRef, queueIdentifierXml, toQueueRef } from './queue-ref.js';

export const QUEUE_COUNT_SERVICE = 'queueCount';
const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';

export interface QueueCountRequest {
  /** PCC cuyas colas se cuentan. Por defecto, el de la sesión. */
  pcc?: string;
  /** Contar solo esta cola (`QC/<PCC><cola>`). No se combina con `range`. */
  queue?: QueueRef;
  /**
   * Contar un rango de colas (`QC/<PCC>1-25`). No se combina con `queue`. La respuesta trae cada
   * cola del rango, también las vacías, con `count: 0`.
   */
  range?: QueueRange;
  /**
   * Hasta 8 filtros, como en `access`: la cola cuenta solo los PNR que cumplen (`QC/<PCC>20‡QD-08NOV`).
   * El host acepta cualquier función (`QD`, `AK`, `AL`, `PI`, `AC`… y combinaciones); un criterio
   * que no vale llega como `SabreBusinessError` (p. ej. `INVALID PLACING AGENT`). Necesita `queue`:
   * sin cola, Sabre responde `QUEUE SELECTED NOT VALID OR CLOSED`, y con `range`, `KEYS NOT ALLOWED`
   * (#213), así que el SDK lo rechaza antes con `TypeError`.
   */
  selection?: readonly QueueSelection[];
}

export type QueueCountOptions = RequestOptions;

/** Una cola con mensajes o PNR. */
export interface QueueCount {
  queue: QueueRef;
  count: number;
}

/**
 * `AdditionalQueueInfo` (desde la 2.2.0): información extra de una cola, como su transferencia a
 * otra cola o PCC (`FreeText="IS TRANSFERRED TO"`). Se tipa desde el design: ninguna respuesta real
 * la trajo todavía (#213), así que los valores van tal cual llegan, sin interpretar.
 */
export interface QueueAdditionalInfo {
  /** La cola dentro de cuyo `QueueIdentifier` llegó, si llegó dentro de uno. */
  queue?: QueueRef;
  /** `@FreeText`, p. ej. `"IS TRANSFERRED TO"`. */
  freeText?: string;
  /** `@PseudoCityCode`. */
  pseudoCityCode?: string;
  /** `@QueueNumber`, tal cual llegó. */
  queueNumber?: string;
}

export interface QueueCountResponse {
  /**
   * Las colas que trae la respuesta, en el orden de Sabre. Sin `range`, Sabre no lista las vacías;
   * con `range`, lista todas las del rango, las vacías con `count: 0`. Con `queue`, trae solo esa
   * (con `count: 0` si está vacía o si ningún PNR cumple `selection`).
   */
  queues: QueueCount[];
  /** Los `AdditionalQueueInfo` de la respuesta, si vino alguno. */
  additionalInfo?: QueueAdditionalInfo[];
  /**
   * Los `Totals` por `Type`: `MESSAGES`, `SPECIALS` y `PNRS`. Si Sabre no manda alguno, queda en
   * `undefined`. Sin filtros son los del PCC, y con `range`, los del rango. Con `queue` y sin
   * `selection`, Sabre no manda `Totals` (CERT y producción, #213).
   *
   * `unfiltered` sale de un `Totals` sin `Type`, que Sabre manda solo con `selection` y que el
   * design no menciona: cuántos PNR tiene la cola sin filtrar (el `1 MATCHING PNRS OUT OF 80` del
   * host, #213).
   */
  totals: { messages?: number; specials?: number; pnrs?: number; unfiltered?: number };
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

/** Lo que filtra un `count`, ya validado: la cola o el rango, y los `Selection`. */
export interface QueueCountTarget {
  queue?: QueueRef;
  range?: QueueRange;
  selection?: readonly QueueSelection[];
}

/**
 * Cuerpo de `QueueCountRQ`: todo el PCC, una cola o un rango, con los `Selection` como hermanos de
 * `QueueInfo` (design 2.2.1).
 */
export function queueCountPayload(pcc: string, target: QueueCountTarget = {}): string {
  return `<QueueCountRQ Version="2.2.1" xmlns="${NAMESPACE}"><QueueInfo>${queueIdentifierXml(pcc, target)}</QueueInfo>${selectionXml(target.selection ?? [])}</QueueCountRQ>`;
}

/** `QueueCountLLSRQ` es una lectura: se reintenta ante `USG_*_BUSY`, transitorios y red. */
export function queueCountRequest(pcc: string, options: QueueCountOptions, target: QueueCountTarget = {}): SessionRequest {
  return {
    service: QUEUE_COUNT_SERVICE,
    action: 'QueueCountLLSRQ',
    payload: queueCountPayload(pcc, target),
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
  const additionalInfo: QueueAdditionalInfo[] = [];
  let countedAt: string | undefined;
  // El design no deja claro si `AdditionalQueueInfo` es hijo de `QueueIdentifier` o hermano: se lee
  // en los dos lugares, y también al nivel de `QueueInfo` por si acaso.
  additionalInfo.push(...readAdditionalInfo(response.payload.AdditionalQueueInfo));
  for (const info of asArray(response.payload.QueueInfo)) {
    countedAt ??= nonEmpty(attribute(info, 'DateTime'));
    additionalInfo.push(...readAdditionalInfo((info as XmlNode).AdditionalQueueInfo));
    for (const identifier of asArray((info as XmlNode).QueueIdentifier)) {
      // `Number` trae las numéricas y las alfabéticas ("400", "S"); `Name`, las colas con nombre
      // (ADR-028). Las respuestas reales solo traen `Number`, pero se lee igual que en place.
      const number = attribute(identifier, 'Number');
      const name = nonEmpty(attribute(identifier, 'Name'));
      const queue: QueueRef | undefined = number === undefined && name !== undefined ? { name } : toQueueRef(number);
      const count = parseHostCount(attribute(identifier, 'Count'));
      if (queue === undefined || count === undefined) {
        throw malformed(`QueueIdentifier con Number="${number ?? ''}" y Count="${attribute(identifier, 'Count') ?? ''}"`, response);
      }
      queues.push({ queue, count });
      additionalInfo.push(...readAdditionalInfo((identifier as XmlNode).AdditionalQueueInfo, queue));
    }
  }

  const totals: QueueCountResponse['totals'] = {};
  for (const total of asArray(response.payload.Totals)) {
    const type = attribute(total, 'Type');
    const key = type === undefined ? 'unfiltered' : TOTAL_TYPES[type.toUpperCase() as keyof typeof TOTAL_TYPES];
    if (key === undefined) continue;
    const count = parseHostCount(attribute(total, 'Count'));
    if (count === undefined) throw malformed(`Totals ${key} con Count="${attribute(total, 'Count') ?? ''}"`, response);
    totals[key] = count;
  }

  return {
    queues,
    ...(additionalInfo.length === 0 ? {} : { additionalInfo }),
    totals,
    ...(countedAt === undefined ? {} : { countedAt }),
    warnings: response.warnings,
    ...respondedAtField(response.raw),
  };
}

function readAdditionalInfo(value: unknown, queue?: QueueRef): QueueAdditionalInfo[] {
  return asArray(value).map((element) => {
    const freeText = nonEmpty(attribute(element, 'FreeText'));
    const pseudoCityCode = nonEmpty(attribute(element, 'PseudoCityCode'));
    const queueNumber = nonEmpty(attribute(element, 'QueueNumber'));
    return {
      ...(queue === undefined ? {} : { queue }),
      ...(freeText === undefined ? {} : { freeText }),
      ...(pseudoCityCode === undefined ? {} : { pseudoCityCode }),
      ...(queueNumber === undefined ? {} : { queueNumber }),
    };
  });
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
