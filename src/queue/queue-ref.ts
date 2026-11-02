// Referencia a una cola de PNR, la misma en la entrada y en la salida. Ver
// sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 2 y decisiones de la revisión) y
// wiki/sources/ingresar-a-una-cola.md.
import { xmlEscape } from '../http/soap-transport.js';

/**
 * Una cola: su número, de 0 a 511, o su nombre (colas alfabéticas de las tablas QN y QNB, p. ej.
 * `{ name: 'S' }`). Lo que devuelve `queue.count` se pasa tal cual a las demás operaciones.
 *
 * Las colas 0–49 son del sistema: el SDK no las restringe.
 */
export type QueueRef = number | { name: string };

/** Primera y última cola numérica de un PCC. */
export const MIN_QUEUE_NUMBER = 0;
export const MAX_QUEUE_NUMBER = 511;

/** Valida una `QueueRef` de la entrada, sin red. `label` es el nombre del campo en el mensaje. */
export function validateQueueRef(value: unknown, label: string): asserts value is QueueRef {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= MIN_QUEUE_NUMBER && value <= MAX_QUEUE_NUMBER) return;
    throw new TypeError(
      `sabre-client: ${label} debe ser un número de cola entero de ${MIN_QUEUE_NUMBER} a ${MAX_QUEUE_NUMBER}, o { name }`,
    );
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const { name } = value as { name?: unknown };
    if (typeof name === 'string' && name.trim() !== '') return;
    throw new TypeError(`sabre-client: ${label}.name debe ser un string no vacío`);
  }
  throw new TypeError(`sabre-client: ${label} debe ser un número de cola (0–511) o { name }`);
}

/** Atributo de `QueueIdentifier`: `Number="12"` o `Name="S"`, ya escapado. */
export function queueRefAttribute(queue: QueueRef): string {
  return typeof queue === 'number' ? `Number="${queue}"` : `Name="${xmlEscape(queue.name)}"`;
}

/**
 * Lee el `Number` alfanumérico de una respuesta: `"12"` da `12`, y `"S"`, `{ name: 'S' }`.
 * Devuelve `undefined` si viene vacío.
 */
export function toQueueRef(value: string | undefined): QueueRef | undefined {
  const text = value?.trim();
  if (text === undefined || text === '') return undefined;
  return /^\d+$/.test(text) ? Number(text) : { name: text };
}
