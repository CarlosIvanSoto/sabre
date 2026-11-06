// Lista de una cola (`QueueAccessLLSRQ` 2.1.1 con `List@Ind`): sus localizadores, sin recorrerla.
// Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 2) y
// wiki/sources/access-queue-v2-1-1-design.md.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreGatewayError, type SabreWarning } from '../errors/index.js';
import { asArray, respondedAtField, type SoapResponse, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';
import {
  attribute,
  isEndOfDisplay,
  isEndOfDisplayResult,
  lineFields,
  paragraphLines,
  QUEUE_ACCESS_SERVICE,
  type QueueItem,
  type QueueSelection,
  selectionXml,
} from './queue-access.js';
import { type QueueRef, queueRefAttribute } from './queue-ref.js';

const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';

export interface QueueListRequest {
  queue: QueueRef;
  /** PCC de la cola. Por defecto, el de la sesión. */
  pcc?: string;
  /** `true` para pedir también el pasajero principal de cada PNR (`Q/…/LN`). */
  primaryPassenger?: boolean;
  /**
   * Hasta 8 filtros, como en `access`, pero Sabre solo acepta `QD` (fecha de colocación en la cola,
   * p. ej. `{ function: 'QD', criteria: '05NOV' }`) o `AK` (el agente que lo colocó, PCC más firma,
   * p. ej. `{ function: 'AK', criteria: 'PCC1AAT' }`) en la lista: con otro código responde
   * `VALID SELECTION CODE FOR QUEUE LIST ARE QD OR AK` (producción, #155). El SDK lo rechaza sin red.
   */
  selection?: readonly QueueSelection[];
}

/**
 * Los únicos códigos de `Selection` que Sabre acepta en la lista (producción, #155): `QD`, la fecha
 * de colocación en la cola, y `AK`, el agente que colocó el PNR (`AK-<PCC><firma>`, según
 * wiki/sources/funciones-de-seleccion-de-colas.md). `QD` se probó en `list`; `AK` no.
 */
export const LIST_SELECTION_FUNCTIONS: readonly string[] = ['QD', 'AK'];

export type QueueListOptions = RequestOptions;

/**
 * Un PNR de la lista: los campos de su `Line`. Su `placedAt` es la **colocación en la cola**, la
 * fecha por la que filtra `QD`. No es la misma fecha que el `placedAt` de `access`, que es la última
 * modificación del PNR (producción, #155).
 */
export interface QueueListEntry extends Omit<QueueItem, 'paragraph'> {
  /** `Line@Number`: la posición en la lista. */
  position?: number;
}

export interface QueueListResponse {
  /** Los localizadores, en el orden de la cola. */
  locators: string[];
  /** Un elemento por PNR, en el mismo orden que `locators`. */
  entries: QueueListEntry[];
  /** `Paragraph/Text` tal cual: empieza con la cabecera `QUEUE LIST FOR <PCC>  QUEUE <n>`. */
  paragraph: string[];
  warnings: SabreWarning[];
  /**
   * `eb:Timestamp` de la respuesta de Sabre, en ISO 8601 UTC (`"2026-11-06T17:34:16Z"`). A
   * diferencia de las fechas del host, trae año y zona. Falta si Sabre no lo manda.
   */
  respondedAt?: string;
}

/** `Q/<PCC><cola>/L`. Los `Selection` van después de `QueueIdentifier`, como en `access`. */
export function queueListPayload(
  queue: QueueRef,
  pcc: string,
  primaryPassenger: boolean,
  selection: readonly QueueSelection[] = [],
): string {
  const list = primaryPassenger ? '<List Ind="true" PrimaryPassenger="true"/>' : '<List Ind="true"/>';
  return `<QueueAccessRQ Version="2.1.1" xmlns="${NAMESPACE}"><QueueIdentifier ${queueRefAttribute(queue)} PseudoCityCode="${xmlEscape(pcc)}">${list}</QueueIdentifier>${selectionXml(selection)}</QueueAccessRQ>`;
}

/** `list` es una lectura (decisión de la revisión): se reintenta como `count`. */
export function queueListRequest(payload: string, options: QueueListOptions): SessionRequest {
  return {
    service: QUEUE_ACCESS_SERVICE,
    action: 'QueueAccessLLSRQ',
    payload,
    idempotent: true,
    operation: 'queue.list',
    ...options,
  };
}

export function emptyList(warnings: SabreWarning[], paragraph: string[] = [], raw?: unknown): QueueListResponse {
  return { locators: [], entries: [], paragraph, warnings, ...respondedAtField(raw) };
}

/**
 * Lee la lista. No pagina: Sabre devuelve la cola entera en una sola respuesta (1221 `Line` en
 * ~279 KB, producción, #155). Una cola vacía (fin de cola como primera línea o como `stl:Warning`) da una lista
 * vacía. Un `Line` sin `UniqueID` es una respuesta que el SDK no entiende: lanza
 * `SabreGatewayError`.
 */
export function parseQueueList(response: SoapResponse): QueueListResponse {
  const { warnings } = response;
  const paragraph = paragraphLines(response.raw);
  const firstLine = paragraph.find((line) => line.trim() !== '');
  if (isEndOfDisplay(firstLine) || warnings.some(isEndOfDisplayResult)) return emptyList(warnings, paragraph, response.raw);

  const entries = asArray(response.payload.Line).map((line): QueueListEntry => {
    const fields = lineFields(line);
    if (fields === undefined) {
      throw new SabreGatewayError(`${QUEUE_ACCESS_SERVICE}: respuesta no reconocida (Line sin UniqueID en la lista)`, {
        protocol: 'soap',
        status: response.status,
        retryable: false,
        raw: response.raw,
      });
    }
    const number = attribute(line, 'Number');
    const position = number !== undefined && /^\d+$/.test(number) ? Number(number) : undefined;
    return { ...(position === undefined ? {} : { position }), ...fields };
  });
  return { locators: entries.map((entry) => entry.locator), entries, paragraph, warnings, ...respondedAtField(response.raw) };
}
