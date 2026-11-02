// Revisión de una cola con `SabreLegacy`: recorre la cola con `session.queue.process` y decide qué
// hacer con cada PNR según su párrafo. Solo usa la API pública del SDK. Los tests la corren contra
// el fake de `sabre-client/testing`, sin red (test/examples-queue-review.test.ts).
//
// Las reglas son de ejemplo, no las de ninguna agencia:
// - un PNR emitido (con una línea `TE`/`TK` en el campo de ticketing) sale de la cola;
// - un PNR con algún segmento cancelado por la aerolínea (`HX`, `UN`, `UC`, `NO`) va a la cola de
//   revisión, con el PIC que se pase;
// - el resto sigue en la cola.
import { parseQueueParagraph } from 'sabre-client';

const CANCELLED = new Set(['HX', 'UN', 'UC', 'NO']);

/**
 * @typedef {object} ReviewOptions
 * @property {import('sabre-client').QueueRef} queue La cola a revisar.
 * @property {string} [pcc] PCC de la cola. Por defecto, el de la sesión.
 * @property {number} [limit] Máximo de PNR a visitar. Sin él, hasta el fin de cola.
 * @property {import('sabre-client').QueueRef} reviewQueue La cola de revisión.
 * @property {number} instructionCode El PIC con el que se coloca en la cola de revisión.
 * @property {Date | string} [referenceDate] Fecha contra la que se resuelven los años del párrafo. Por defecto, hoy.
 */

/**
 * Qué hacer con un PNR, según su párrafo.
 * @param {import('sabre-client').QueueItem} item
 * @param {{ referenceDate: Date | string, reviewQueue: import('sabre-client').QueueRef, instructionCode: number }} rules
 * @returns {import('sabre-client').QueueProcessAction}
 */
export function decide(item, { referenceDate, reviewQueue, instructionCode }) {
  const paragraph = parseQueueParagraph(item.paragraph, { referenceDate });
  if (paragraph.ticketing?.issued) return { action: 'remove' };
  if (paragraph.segments.some((segment) => CANCELLED.has(segment.status))) {
    return { action: 'place', to: [{ queue: reviewQueue, instructionCode }] };
  }
  return { action: 'ignore' };
}

/**
 * Recorre `queue` en una sesión propia y devuelve lo que hizo con cada PNR. `limit` corta el
 * recorrido: sin él, sigue hasta el fin de cola.
 * @param {import('sabre-client').SabreLegacy} legacy
 * @param {ReviewOptions} options
 */
export async function reviewQueue(legacy, { queue, pcc, limit, reviewQueue, instructionCode, referenceDate = new Date() }) {
  const decisions = [];
  const result = await legacy.withSession((session) =>
    session.queue.process({ queue, ...(pcc === undefined ? {} : { pcc }), ...(limit === undefined ? {} : { limit }) }, (item) => {
      const decision = decide(item, { referenceDate, reviewQueue, instructionCode });
      decisions.push({ locator: item.locator, action: decision.action });
      return decision;
    }),
  );
  return { ...result, decisions };
}
