// Referencia a una cola de PNR, la misma en la entrada y en la salida. Ver
// sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 2 y decisiones de la revisión) y
// wiki/sources/ingresar-a-una-cola.md.
import { xmlEscape } from '../http/soap-transport.js';

/**
 * Una cola (ADR-028). Hay tres clases, y viajan por dos atributos distintos de `QueueIdentifier`:
 * - **numérica**, de 0 a 511: `400` → `Number="400"`;
 * - **alfabética**, una o dos letras mayúsculas: `'S'` → `Number="S"`. La `S` es la cola de
 *   **mensajes** del PCC (cuenta lo mismo que `Totals Type="MESSAGES"`): no tiene PNR y no se puede
 *   listar;
 * - **con nombre** (tablas QN y QNB): `{ name: 'HOTELS' }` → `Name="HOTELS"`.
 *
 * Lo que devuelve `queue.count` se pasa tal cual a las demás operaciones. Las colas 0–49 son del
 * sistema: el SDK no las restringe.
 */
export type QueueRef = number | string | { name: string };

/** Primera y última cola numérica de un PCC. */
export const MIN_QUEUE_NUMBER = 0;
export const MAX_QUEUE_NUMBER = 511;

/** La cola de mensajes del PCC: no tiene PNR y Sabre no la lista (`INVALID ENTRY`). */
export const MESSAGE_QUEUE = 'S';

/**
 * Una cola alfabética: una o dos letras mayúsculas. Es una regla laxa a propósito: la documentación
 * solo muestra `S` y `A`, y no se sabe si hay colas de dos letras (ADR-028).
 */
const ALPHA_QUEUE = /^[A-Z]{1,2}$/;

function fail(message: string): never {
  throw new TypeError(`sabre-client: ${message}`);
}

/** Valida una `QueueRef` de la entrada, sin red. `label` es el nombre del campo en el mensaje. */
export function validateQueueRef(value: unknown, label: string): asserts value is QueueRef {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= MIN_QUEUE_NUMBER && value <= MAX_QUEUE_NUMBER) return;
    fail(`${label} debe ser un número de cola entero de ${MIN_QUEUE_NUMBER} a ${MAX_QUEUE_NUMBER}, una cola alfabética ('S') o { name }`);
  }
  if (typeof value === 'string') {
    if (ALPHA_QUEUE.test(value)) return;
    // Cada cola tiene una sola forma: '12' no se convierte en 12, ni 's' en 'S' (ADR-028).
    if (/^\d+$/.test(value.trim())) fail(`${label}: una cola numérica va como número (${Number(value)}), no como string`);
    fail(`${label} debe ser una cola alfabética de una o dos letras mayúsculas (p. ej. 'S')`);
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const { name } = value as { name?: unknown };
    if (typeof name !== 'string' || name.trim() === '') fail(`${label}.name debe ser un string no vacío`);
    // Un { name } de una o dos letras es casi seguro una cola alfabética mal armada, p. ej. el
    // { name: 'S' } que devolvía count en la 0.4.x: Sabre lo rechaza con INVALID QUEUE NAME FORMAT.
    // Ninguna fuente confirma que no existan colas con nombre tan cortas: si aparece una, se afloja
    // esta regla, y eso no rompe la compatibilidad (ADR-028, sub-decisión ii).
    if (ALPHA_QUEUE.test(name)) fail(`${label}: '${name}' es una cola alfabética: pasa '${name}', no { name: '${name}' }`);
    return;
  }
  fail(`${label} debe ser un número de cola (0–511), una cola alfabética ('S') o { name }`);
}

/** Atributo de `QueueIdentifier`: `Number="12"`, `Number="S"` o `Name="HOTELS"`, ya escapado. */
export function queueRefAttribute(queue: QueueRef): string {
  if (typeof queue === 'number') return `Number="${queue}"`;
  if (typeof queue === 'string') return `Number="${xmlEscape(queue)}"`;
  return `Name="${xmlEscape(queue.name)}"`;
}

/**
 * Un rango de colas numéricas, de `start` a `end`, las dos incluidas: `{ start: 1, end: 25 }` es el
 * `QC/<PCC>1-25` del host. Lo usan `count` y `activity`. A diferencia de pedir todo el PCC, Sabre
 * devuelve cada cola del rango, también las vacías, con cuenta `0` (CERT y producción, #213).
 *
 * El design también acepta rangos de colas con nombre (`TEST1-TEST2`), pero ninguna prueba los vio:
 * por ahora solo van números.
 */
export interface QueueRange {
  start: number;
  end: number;
}

/** Valida un `QueueRange` de la entrada, sin red. `label` es el nombre del campo en el mensaje. */
export function validateQueueRange(value: unknown, label: string): asserts value is QueueRange {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label} debe ser { start, end }`);
  const { start, end } = value as { start?: unknown; end?: unknown };
  for (const [name, bound] of [['start', start], ['end', end]] as const) {
    if (typeof bound !== 'number' || !Number.isInteger(bound) || bound < MIN_QUEUE_NUMBER || bound > MAX_QUEUE_NUMBER) {
      fail(`${label}.${name} debe ser un número de cola entero de ${MIN_QUEUE_NUMBER} a ${MAX_QUEUE_NUMBER}`);
    }
  }
  if ((start as number) >= (end as number)) fail(`${label}.start debe ser menor que ${label}.end (para una sola cola, usa queue)`);
}

/**
 * `QueueIdentifier` de `QueueCountRQ` y `QueueAnalysisRQ`: todo el PCC, una cola o un rango. `Range`
 * va como hijo y sin `Number` ni `Name`: con los dos, Sabre responde `Client.Validation` (#213).
 */
export function queueIdentifierXml(pcc: string, target: { queue?: QueueRef; range?: QueueRange } = {}): string {
  const pccAttribute = `PseudoCityCode="${xmlEscape(pcc)}"`;
  if (target.range !== undefined) {
    return `<QueueIdentifier ${pccAttribute}><Range Start="${target.range.start}" End="${target.range.end}"/></QueueIdentifier>`;
  }
  if (target.queue !== undefined) return `<QueueIdentifier ${queueRefAttribute(target.queue)} ${pccAttribute}/>`;
  return `<QueueIdentifier ${pccAttribute}/>`;
}

/** Si la cola es la de mensajes (`'S'`). */
export function isMessageQueue(queue: QueueRef): boolean {
  return queue === MESSAGE_QUEUE;
}

/**
 * Lee el `Number` de una respuesta (`QueueCountRS`, `QueuePlaceRS`, `QueueAnalysisRS`): `"12"` da
 * `12`, y `"S"`, `'S'`. Devuelve `undefined` si viene vacío. Un `Number` que no es ni numérico ni
 * alfabético sale tal cual, como string: es lo que mandó Sabre.
 */
export function toQueueRef(value: string | undefined): QueueRef | undefined {
  const text = value?.trim();
  if (text === undefined || text === '') return undefined;
  return /^\d+$/.test(text) ? Number(text) : text;
}
