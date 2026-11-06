// Place Queue Message (`QueuePlaceLLSRQ` 2.0.4): colocar PNR en colas. Ver
// sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 2, "place"),
// wiki/sources/place-queue-message-v2-0-4-design.md y wiki/sources/sabre-legacy-client-1-0-8.md.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreGatewayError, type SabreWarning } from '../errors/index.js';
import { asArray, respondedAtField, type SoapResponse, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';
import {
  attribute,
  endStep,
  isEndOfDisplay,
  isEndOfDisplayResult,
  node,
  type QueueStep,
  textLines,
} from './queue-access.js';
import { type QueueRef, queueRefAttribute, toQueueRef } from './queue-ref.js';

export const QUEUE_PLACE_SERVICE = 'queuePlace';
const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';

/** Límites del design 2.0.4: hasta 10 colas y hasta 6 localizadores. */
export const MAX_PLACE_TO = 10;
export const MAX_PLACE_LOCATORS = 6;

/** Rangos de PIC válidos (`PrefatoryInstructionCode`), según el artículo de selección de colas. */
const INSTRUCTION_CODE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 191],
  [200, 254],
];

/** Una cola de destino. */
export interface QueuePlaceTarget {
  queue: QueueRef;
  /** Por defecto, el PCC de la sesión. */
  pcc?: string;
  /**
   * Código PIC (`PrefatoryInstructionCode`): 0–191 o 200–254. **Obligatorio**, aunque el design
   * 2.0.4 lo da como opcional: sin PIC, producción rechaza el place con `INSTRUCTION NUMBER NOT IN
   * RANGE` fuera de una cola y con `NEED INSTRUCTION NUMBER` dentro (#97). Sin valor por defecto.
   */
  instructionCode: number;
}

export interface QueuePlaceRequest {
  /** De 1 a 10 colas de destino. */
  to: readonly QueuePlaceTarget[];
  /**
   * Hasta 6 localizadores a colocar, sin tenerlos en el AAA. Solo fuera de una cola: dentro,
   * `place` coloca el PNR actual.
   */
  locators?: readonly string[];
}

export type QueuePlaceOptions = RequestOptions;

/** Una colocación que confirma Sabre (`QueueInfo`). */
export interface QueuePlacement {
  queue?: QueueRef;
  pcc?: string;
  locator?: string;
  /** `QueueInfo@DateTime` tal cual, sin año (`"12-21T12:00"`). */
  placedAt?: string;
}

/** Lo que devuelve `place` fuera de una cola: no avanza nada. */
export interface QueuePlaceResult {
  /** Las colocaciones de `QueueInfo`, si Sabre las manda. */
  placements: QueuePlacement[];
  /** Las líneas `Text`, tal cual (p. ej. `"OK 1030 NMIUTF"`). */
  text: string[];
  warnings: SabreWarning[];
  /**
   * `eb:Timestamp` de la respuesta de Sabre, en ISO 8601 UTC (`"2026-11-06T17:34:16Z"`). A
   * diferencia de las fechas del host, trae año y zona. Falta si Sabre no lo manda.
   */
  respondedAt?: string;
}

/**
 * Lo que devuelve `place`: un `QueueStep` dentro de una cola, y un `QueuePlaceResult` fuera. Se
 * distinguen con `'done' in result`. Con `locators`, el tipo ya es `QueuePlaceResult`.
 */
export type QueuePlaceResponse = QueueStep | QueuePlaceResult;

/** Destino ya validado, con el PCC resuelto. */
export interface ResolvedPlaceTarget {
  queue: QueueRef;
  pcc: string;
  instructionCode?: number;
}

/** Si un PIC está en los rangos válidos. */
export function isInstructionCode(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    INSTRUCTION_CODE_RANGES.some(([min, max]) => value >= min && value <= max)
  );
}

export function queuePlacePayload(to: readonly ResolvedPlaceTarget[], locators: readonly string[] = []): string {
  const identifiers = to
    .map((target) => {
      const pic = target.instructionCode === undefined ? '' : ` PrefatoryInstructionCode="${target.instructionCode}"`;
      return `<QueueIdentifier ${queueRefAttribute(target.queue)}${pic} PseudoCityCode="${xmlEscape(target.pcc)}"/>`;
    })
    .join('');
  const ids = locators.map((locator) => `<UniqueID ID="${xmlEscape(locator)}"/>`).join('');
  return `<QueuePlaceRQ Version="2.0.4" xmlns="${NAMESPACE}"><QueueInfo>${identifiers}${ids}</QueueInfo></QueuePlaceRQ>`;
}

/** Colocar no es idempotente: dentro de una cola mueve el cursor, y fuera repetiría la colocación. */
export function queuePlaceRequest(payload: string, options: QueuePlaceOptions): SessionRequest {
  return {
    service: QUEUE_PLACE_SERVICE,
    action: 'QueuePlaceLLSRQ',
    payload,
    idempotent: false,
    operation: 'queue.place',
    ...options,
  };
}

/**
 * Línea de firma del PNR, al final del texto: `<PCC>.<PCC>*<agente> HHMM/DDMMMYY <localizador> H`,
 * p. ej. `7TZA.7TZA*AW5 0319/06SEP24 NGDEZP H`.
 */
const SIGNATURE_LINE = /\s\d{4}\/\d{2}[A-Z]{3}\d{2}\s+([A-Z0-9]{6})\s+H\s*$/;

/** El localizador de la última línea de firma del texto, si hay una. */
export function signatureLocator(lines: readonly string[]): string | undefined {
  for (let index = lines.length - 1; index >= 0; index--) {
    const match = SIGNATURE_LINE.exec(lines[index] ?? '');
    if (match !== null) return match[1];
  }
  return undefined;
}

/** El fin de cola de `place`: como `stl:Warning` (evidencia de `1.0.8`) o como primera línea. */
function isEnd(response: SoapResponse, text: readonly string[]): boolean {
  return response.warnings.some(isEndOfDisplayResult) || isEndOfDisplay(text.find((line) => line.trim() !== ''));
}

/**
 * Dentro de una cola, `QueuePlaceRS` trae el PNR siguiente en `Text` y no trae `Line`: el
 * localizador sale de la línea de firma, y `placedAt` y `placedBy` quedan en `undefined`, porque
 * esa firma es la última modificación del PNR y no su colocación en la cola.
 */
export function parsePlaceStep(response: SoapResponse): QueueStep {
  const text = textLines(response.raw, 'QueuePlaceRS');
  if (isEnd(response, text)) return endStep(response.warnings, 'end-of-display', response.raw);
  const locator = signatureLocator(text);
  if (locator === undefined) {
    throw new SabreGatewayError(`${QUEUE_PLACE_SERVICE}: respuesta no reconocida (sin línea de firma del PNR ni fin de cola)`, {
      protocol: 'soap',
      status: response.status,
      retryable: false,
      raw: response.raw,
    });
  }
  return { done: false, item: { locator, paragraph: text }, warnings: response.warnings, ...respondedAtField(response.raw) };
}

/**
 * Lo que `place` puede leer con la sesión en `'unknown'`: un fin de cola, un PNR con línea de
 * firma (seguía en la cola) o, si no, un `QueuePlaceResult`.
 */
export function parsePlaceUnknown(response: SoapResponse): QueuePlaceResponse {
  const text = textLines(response.raw, 'QueuePlaceRS');
  if (isEnd(response, text) || signatureLocator(text) !== undefined) return parsePlaceStep(response);
  return parsePlaceResult(response);
}

/** Fuera de una cola: las colocaciones de `QueueInfo` y el texto. */
export function parsePlaceResult(response: SoapResponse): QueuePlaceResult {
  const placements = asArray(response.payload.QueueInfo).map((info): QueuePlacement => {
    const identifier = node(node(info)?.QueueIdentifier);
    // `Number` es alfanumérico ("400" o "S"); `Name` es siempre un nombre.
    const number = attribute(identifier, 'Number');
    const name = attribute(identifier, 'Name');
    const queue: QueueRef | undefined = number !== undefined ? toQueueRef(number) : name !== undefined ? { name } : undefined;
    const pcc = attribute(identifier, 'PseudoCityCode');
    const locator = attribute(node(info)?.UniqueID, 'ID');
    const placedAt = attribute(info, 'DateTime');
    return {
      ...(queue === undefined ? {} : { queue }),
      ...(pcc === undefined ? {} : { pcc }),
      ...(locator === undefined ? {} : { locator }),
      ...(placedAt === undefined ? {} : { placedAt }),
    };
  });
  return {
    placements,
    text: textLines(response.raw, 'QueuePlaceRS'),
    warnings: response.warnings,
    ...respondedAtField(response.raw),
  };
}
