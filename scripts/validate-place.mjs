#!/usr/bin/env node
// Valida `place` y `remove` contra Sabre con colas de prueba (#97), y graba las respuestas,
// anonimizadas, como fixtures. Lo corre el usuario, con su confirmación en cada corrida; nunca la
// CI. Necesita `npm run build` antes.
//
//   SABRE_ENVIRONMENT=production SABRE_PLACE_LOCATORS=ABC123,DEF456 SABRE_TEST_QUEUE=401 \
//     SABRE_TEST_QUEUE_2=402 node --env-file=.env.production scripts/validate-place.mjs
//
// Escribe en colas reales, así que todo va con protecciones:
// - Arranca solo si SABRE_TEST_QUEUE y SABRE_TEST_QUEUE_2 están vacías según `count`. Si no, no
//   coloca ni saca nada.
// - Solo saca (`QR`) PNR de SABRE_PLACE_LOCATORS. Si una cola de prueba muestra otro PNR, sale con
//   `QXI` sin sacarlo y no saca nada más de esa cola.
// - No crea ni modifica PNR: solo los coloca en las colas de prueba y los vuelve a sacar.
//
// Recorrido, en una sesión:
//  1. count: las dos colas de prueba tienen que estar vacías.
//  2. place fuera de una cola: los PNR designados a SABRE_TEST_QUEUE.
//  3. count: cuántos quedaron.
//  4. access(SABRE_TEST_QUEUE): el primero.
//  5. place dentro de la cola, a SABRE_TEST_QUEUE_2: ¿devuelve el siguiente, el mismo o el fin?
//  6. remove hasta el fin de SABRE_TEST_QUEUE.
//  7. count: ¿place dentro de la cola dejó el PNR en SABRE_TEST_QUEUE?
//  8. Limpieza: access + remove en las dos colas, hasta vaciarlas.
//  9. count final: las dos tienen que quedar en 0.
//
// Con `cleanup` como argumento solo hace los pasos 8 y 9: vacía las colas de prueba de PNR
// designados, por ejemplo si una corrida anterior quedó a medias.
//
// Variables: las de scripts/validate-queue.mjs (credenciales, SABRE_QUEUE_PCC), más
// SABRE_PLACE_LOCATORS (de 1 a 6, separados por coma; con 2 o más la pregunta del paso 5 se
// responde mejor), SABRE_TEST_QUEUE y SABRE_TEST_QUEUE_2 (número o nombre de cola), y
// SABRE_INSTRUCTION_CODE: el PIC de cada colocación (11 por defecto, el de todos los ejemplos). Sin
// PIC, producción rechaza el place con INSTRUCTION NUMBER NOT IN RANGE fuera de una cola y con
// NEED INSTRUCTION NUMBER dentro (#97).
import { createRecorder, env, legacyClient, legacyEnvironment, queueRef } from './lib/legacy-recorder.mjs';

const mode = process.argv[2] ?? 'run';
if (mode !== 'run' && mode !== 'cleanup') {
  console.error(`modo desconocido: ${mode} (usa run, o cleanup para solo vaciar las colas de prueba)`);
  process.exit(2);
}
const { environment, credentials, queuePcc, queuePccLabel, secrets } = legacyEnvironment();
const pccRequest = queuePcc === undefined ? {} : { pcc: queuePcc };
const designated = env('SABRE_PLACE_LOCATORS')
  .split(',')
  .map((locator) => locator.trim().toUpperCase())
  .filter((locator) => locator !== '');
if (designated.length < 1 || designated.length > 6) {
  console.error('SABRE_PLACE_LOCATORS debe traer de 1 a 6 localizadores separados por coma');
  process.exit(2);
}
const testQueueText = env('SABRE_TEST_QUEUE');
const testQueue2Text = env('SABRE_TEST_QUEUE_2');
if (testQueueText === testQueue2Text) {
  console.error('SABRE_TEST_QUEUE y SABRE_TEST_QUEUE_2 tienen que ser colas distintas');
  process.exit(2);
}
const instructionCode = Number(process.env.SABRE_INSTRUCTION_CODE ?? 11);
if (!Number.isInteger(instructionCode)) {
  console.error('SABRE_INSTRUCTION_CODE debe ser un entero (0–191 o 200–254)');
  process.exit(2);
}
const testQueue = queueRef(testQueueText);
const testQueue2 = queueRef(testQueue2Text);

// Los PNR designados van como secretos además de con alias: ninguno puede quedar en la fixture.
const { aliasOf, step, stepSummary, results, options, logger, writeFixture } = createRecorder([...secrets, ...designated]);
for (const locator of designated) aliasOf(locator);
const legacy = legacyClient(environment, credentials, logger);

// Número y cola alfabética ('S') se comparan por valor; las con nombre, por `name` (ADR-028).
const sameQueue = (a, b) => (typeof a !== 'object' ? a === b : typeof b === 'object' && a.name === b.name);
const countOf = (response, queue) => response?.queues.find((q) => sameQueue(q.queue, queue))?.count ?? 0;
const countStep = (name) =>
  step(name, () => session.queue.count(pccRequest, options), (r) => ({
    [testQueueText]: countOf(r, testQueue),
    [testQueue2Text]: countOf(r, testQueue2),
  }));

console.log(
  `entorno ${environment} · colas de prueba ${testQueueText} y ${testQueue2Text} · PCC de las colas: ${queuePccLabel} · PIC ${instructionCode} · ${designated.length} PNR designados (${designated.map(aliasOf).join(', ')})`,
);
const session = await legacy.openSession(options);

/** Sale de la cola si la sesión quedó adentro o en `'unknown'`. */
async function leave(name) {
  if (session.queue.state !== 'outside') await step(name, () => session.queue.exit(options));
}

/**
 * Saca de la cola en curso los PNR designados, desde `current`, hasta el fin. Devuelve `'end'` si
 * llegó al fin de cola, `'foreign'` si apareció un PNR no designado (sale con `QXI` sin sacarlo) o
 * `'stopped'` si una operación falló o se agotó el tope.
 */
async function removeDesignated(current, label) {
  let guard = designated.length * 2 + 2;
  while (current !== undefined && !current.done && guard-- > 0) {
    if (!designated.includes(current.item.locator)) {
      results.push({ step: `${label}: PNR no designado, no se saca`, ok: false });
      await leave(`${label}: exit`);
      return 'foreign';
    }
    current = await step(`${label}: remove`, () => session.queue.remove({}, options), stepSummary);
  }
  await leave(`${label}: exit`);
  return current !== undefined && current.done ? 'end' : 'stopped';
}

/** Vacía las dos colas de prueba, sacando solo PNR designados. */
async function cleanup() {
  for (const [queue, text] of [
    [testQueue, testQueueText],
    [testQueue2, testQueue2Text],
  ]) {
    const current = await step(`limpieza: access ${text}`, () => session.queue.access({ queue, ...pccRequest }, options), stepSummary);
    if (current !== undefined && !current.done) {
      const outcome = await removeDesignated(current, `limpieza ${text}`);
      if (outcome === 'foreign') foreign = true;
    }
    await leave(`limpieza ${text}: exit`);
  }
}

let started = false;
let placeInside;
let accessed;
let afterPlace;
let afterPlaceInside;
let finalCount;
let foreign = false;
try {
  if (mode === 'cleanup') {
    // Solo limpieza: saca los PNR designados que hayan quedado en las colas de prueba.
    await countStep('count inicial');
    await cleanup();
    finalCount = await countStep('count final');
  } else {
    const before = await countStep('count inicial');
    if (before === undefined || countOf(before, testQueue) !== 0 || countOf(before, testQueue2) !== 0) {
      results.push({ step: 'las colas de prueba no están vacías: no se coloca nada', ok: false });
    } else {
      started = true;
      // Producción pide el PIC fuera y dentro de una cola: sin él responde INSTRUCTION NUMBER NOT
      // IN RANGE (afuera) y NEED INSTRUCTION NUMBER (adentro). Ver las fixtures place-sin-pic*.
      const target = (queue) => [{ queue, instructionCode, ...pccRequest }];
      await step('place fuera de una cola', () => session.queue.place({ to: target(testQueue), locators: designated }, options), stepSummary);
      afterPlace = await countStep('count después de place');

      accessed = await step(`access ${testQueueText}`, () => session.queue.access({ queue: testQueue, ...pccRequest }, options), stepSummary);
      if (accessed !== undefined && !accessed.done && designated.includes(accessed.item.locator)) {
        placeInside = await step(`place dentro de la cola a ${testQueue2Text}`, () => session.queue.place({ to: target(testQueue2) }, options), stepSummary);
        const outcome = await removeDesignated(placeInside, `limpieza ${testQueueText}`);
        if (outcome === 'foreign') foreign = true;
      } else {
        if (accessed !== undefined && !accessed.done) foreign = true;
        await leave(`access ${testQueueText}: exit`);
      }
      afterPlaceInside = await countStep('count después de place dentro de la cola');
      await cleanup();
      finalCount = await countStep('count final');
    }
  }
} finally {
  await leave('exit');
  await step('close', () => session.close(options));
}

// --- Hallazgos ----------------------------------------------------------------------------------
const first = accessed !== undefined && !accessed.done ? accessed.item.locator : undefined;
const inside = placeInside !== undefined && 'done' in placeInside ? placeInside : undefined;
const findings = {
  started,
  placedCount: countOf(afterPlace, testQueue),
  // ¿Qué devuelve place dentro de la cola? El mismo PNR, el siguiente o el fin de cola.
  placeInsideReturns:
    inside === undefined
      ? undefined
      : inside.done
        ? inside.reason
        : inside.item.locator === first
          ? 'same'
          : designated.includes(inside.item.locator)
            ? 'next'
            : 'foreign',
  // ¿place dentro de la cola sacó el PNR actual de la cola de origen?
  afterPlaceInside: afterPlaceInside === undefined ? undefined : { [testQueueText]: countOf(afterPlaceInside, testQueue), [testQueue2Text]: countOf(afterPlaceInside, testQueue2) },
  finalCounts: finalCount === undefined ? undefined : { [testQueueText]: countOf(finalCount, testQueue), [testQueue2Text]: countOf(finalCount, testQueue2) },
  emptyAtEnd: finalCount !== undefined && countOf(finalCount, testQueue) === 0 && countOf(finalCount, testQueue2) === 0,
  foreignPnrSeen: foreign,
  finalState: session.queue.state,
};

writeFixture(`queue.${environment}-place${mode === 'cleanup' ? '-cleanup' : ''}`, { environment, designated: designated.length, instructionCode }, findings);
if (!started && mode === 'run') {
  console.error('⚠️ una de las colas de prueba no estaba vacía: no se colocó ni se sacó nada.');
  process.exit(1);
}
if (!findings.emptyAtEnd) {
  console.error('⚠️ las colas de prueba no quedaron vacías: revisarlas a mano.');
  process.exit(1);
}
