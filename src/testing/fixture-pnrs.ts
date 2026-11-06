// De una corrida grabada a los PNR del fake de colas (#166, ADR-027 D2): lee las respuestas con el
// parseo del SDK, así el consumidor no tiene que leer el XML por su cuenta.
import { asArray, untrimmedPayload } from '../http/soap-transport.js';
import { attribute, isEndOfDisplay, lineFields, textLines } from '../queue/queue-access.js';
import { signatureLocator } from '../queue/queue-place.js';
import type { RecordedFixture } from './fixtures.js';
import type { QueueFakePnr } from './queue-fake.js';

/** Las operaciones cuyas respuestas traen PNR de una cola. */
const QUEUE_OPERATION = /^queue\.(list|access|ignore|remove|place)$/;

/**
 * Los PNR de una corrida grabada, listos para `createQueueFake`: primero los de `queue.list`, en
 * su orden, y después los que aparecen en las demás respuestas de cola (`access`, `ignore`,
 * `remove`, `place`), en el orden en que aparecen. Cada localizador sale una sola vez.
 *
 * - `placedAt`, `placedBy` y `primaryPassenger` salen del `Line` de `list`. Si el PNR no está en la
 *   lista, salen del `Line` del primer `access`, `ignore` o `remove` que lo trae (ahí `placedAt` es
 *   la última modificación del PNR, no su colocación en la cola).
 * - `paragraph` es el del primer `access`, `ignore`, `remove` o `place` que muestra el PNR, tal
 *   cual. El localizador del párrafo sale del `Line`, o de la línea de firma si no hay `Line`
 *   (`place` dentro de una cola).
 * - Un PNR que solo aparece como colocado (`place` fuera de una cola) va sin párrafo, y el fake le
 *   agrega una línea de firma.
 *
 * La cola en la que van los decide quien lo usa:
 *
 * ```ts
 * createQueueFake({ queues: { '9': queueFakePnrs(queueFixtures.walk) } })
 * ```
 *
 * Las fixtures de `queueFixtures` usan alias distintos (`walk`: `AAAAAA`–`AAAAAD`, `place`:
 * `AAAAAE`–`AAAAAF`, `placeWithoutInstructionCodeInside`: `AAAAAG`–`AAAAAH`), así que los PNR de
 * varias se pueden juntar en un mismo fake.
 */
export function queueFakePnrs(fixture: RecordedFixture): QueueFakePnr[] {
  const pnrs = new Map<string, QueueFakePnr>();
  const add = (locator: string, fields: Omit<QueueFakePnr, 'locator'>) => {
    const current = pnrs.get(locator) ?? { locator };
    // Lo primero que se vio de cada campo se queda: la lista va antes que el resto.
    pnrs.set(locator, { ...fields, ...current });
  };

  const responses = fixture.responses.filter((response) => QUEUE_OPERATION.test(response.operation));
  const ordered = [
    ...responses.filter((response) => response.operation === 'queue.list'),
    ...responses.filter((response) => response.operation !== 'queue.list'),
  ];
  for (const response of ordered) {
    const payload = untrimmedPayload(response.body);
    const lines = asArray(payload?.Line)
      .map(lineFields)
      .filter((fields) => fields !== undefined);
    for (const { locator, placedAt, placedBy, primaryPassenger } of lines) {
      add(locator, {
        ...(placedAt === undefined ? {} : { placedAt }),
        ...(placedBy === undefined ? {} : { placedBy }),
        ...(primaryPassenger === undefined ? {} : { primaryPassenger }),
      });
    }
    if (response.operation === 'queue.list') continue;
    // `place` fuera de una cola: cada PNR colocado, en su `QueueInfo`.
    for (const info of asArray(payload?.QueueInfo)) {
      const locator = attribute((info as Record<string, unknown>).UniqueID, 'ID');
      if (locator !== undefined) add(locator, {});
    }

    const paragraph = textLines(response.body, /<(?:\w+:)?QueuePlaceRS\b/.test(response.body) ? 'QueuePlaceRS' : 'QueueAccessRS');
    if (paragraph.length === 0 || isEndOfDisplay(paragraph.find((line) => line.trim() !== ''))) continue;
    const locator = lines.length === 1 ? lines[0]!.locator : signatureLocator(paragraph);
    if (locator !== undefined) add(locator, { paragraph });
  }
  return [...pnrs.values()];
}
