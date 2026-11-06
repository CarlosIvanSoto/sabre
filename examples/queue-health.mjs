// Salud de una cola con `SabreLegacy`: los contadores de Get Queue Activity (`QA`) y, por cada PNR
// de la cola, su última transacción en Get Itinerary History (`*H`). Solo usa la API pública del
// SDK. Los tests la corren contra el fake de `sabre-client/testing`, sin red
// (test/examples-queue-health.test.ts).
//
// La regla de "cola sin atender" es de ejemplo: hay PNR en la cola y ninguno se sacó (`removed` en
// 0). Ninguna fuente dice desde cuándo cuentan los contadores de Sabre (Q-097), así que conviene
// compararlos entre dos lecturas en lugar de leerlos solos.

/** Si dos `QueueRef` son la misma cola: `9`, `'S'` o `{ name }`. */
const sameQueue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {import('sabre-client').SabreLegacy} legacy
 * @param {{ queue: import('sabre-client').QueueRef, pcc?: string }} options
 */
export async function queueHealth(legacy, { queue, pcc }) {
  const scope = pcc === undefined ? {} : { pcc };
  return legacy.withSession(async (session) => {
    const activity = await session.queue.activity(scope);
    const counters = activity.queues.find((entry) => sameQueue(entry.queue, queue)) ?? null;
    const { locators } = await session.queue.list({ queue, ...scope });

    // El historial se pide fuera de la cola: dentro, Sabre rechaza el de otro PNR (NAK6).
    const pnrs = [];
    for (const locator of locators) {
      const { transactions } = await session.reservation.history(locator);
      // `createdAt` trae año (`YYYY-MM-DDTHH:mm`), así que ordena como texto.
      const last = transactions.reduce((latest, t) => ((t.createdAt ?? '') > (latest?.createdAt ?? '') ? t : latest), undefined);
      pnrs.push({ locator, transactions: transactions.length, lastChangeAt: last?.createdAt, lastAgent: last?.agent });
    }

    return {
      queue,
      analyzedAt: activity.analyzedAt,
      counters,
      unattended: counters !== null && counters.numMessages > 0 && counters.removed === 0,
      pnrs,
    };
  });
}
