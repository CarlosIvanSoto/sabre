#!/usr/bin/env node
// Recorrido de colas de solo lectura contra Sabre (#96): graba las respuestas reales, anonimizadas,
// como fixtures. Lo corre el usuario, con su confirmación en cada corrida; nunca la CI. Necesita
// `npm run build` antes.
//
//   SABRE_ENVIRONMENT=production SABRE_QUEUE=2 node --env-file=.env.production scripts/validate-queue.mjs walk
//   SABRE_ENVIRONMENT=production SABRE_EMPTY_QUEUE=3 node --env-file=.env.production scripts/validate-queue.mjs empty
//   node --env-file=.env scripts/validate-queue.mjs messages
//
// Solo lectura: count, list, access, ignore (`I`) y exit (`QXI`). Nunca manda `QR` (remove) ni
// place, así que ningún PNR sale de su cola ni se mueve a otra.
//
// - `walk` (una sesión): count → list(SABRE_QUEUE) → `I` y `QXI` crudos (¿list deja la sesión
//   dentro de la cola?, y el texto de `QXI` fuera de una cola) → access → count dentro de la cola →
//   ignore hasta el fin de cola o SABRE_QUEUE_LIMIT PNR (10 por defecto) → exit si hace falta.
// - `empty` (una sesión): count → list(SABRE_EMPTY_QUEUE) → access → exit si hace falta.
// - `count` (una sesión): solo count, para comprobar cuántos PNR tiene SABRE_QUEUE después de un
//   recorrido. No entra a ninguna cola.
// - `messages` (una sesión, #169 punto 3): count → access crudo a la cola `S` (`Number="S"`, la de
//   mensajes, ADR-028) → `I` crudo → `QXI` crudo. Crudo porque `access` del SDK todavía lanza
//   `SabreGatewayError` cuando la respuesta no trae `Line`. Graba la forma de un paso de mensaje:
//   qué trae en lugar de `Line` y si trae `Paragraph`. No usa SABRE_QUEUE.
//
// Las pruebas crudas usan el método interno de la sesión (`sessionSend`), sacado del prototipo con
// Object.getOwnPropertySymbols: el SDK no deja mandar `I` ni `QXI` cuando cree que la sesión está
// afuera. Es un truco del script, no API pública (aprobado por el usuario el 2026-11-01).
//
// Variables: el juego único de credenciales de scripts/lib/env-credentials.mjs (SABRE_USERNAME,
// SABRE_PCC, SABRE_DOMAIN, SABRE_PASSWORD, SABRE_CLIENT_ID, SABRE_CLIENT_SECRET), SABRE_ENVIRONMENT, más
// SABRE_QUEUE, SABRE_EMPTY_QUEUE (un número o un nombre de cola), SABRE_QUEUE_LIMIT y
// SABRE_QUEUE_PCC (el PCC de las colas; por defecto, el de la sesión). Con SABRE_QUEUE_PCC=target se
// usa SABRE_TARGET_PCC.
//
// La anonimización y la protección contra fugas están en scripts/lib/legacy-recorder.mjs: el
// párrafo es el PNR entero, así que se enmascara por estructura. Si queda un dato real, no se
// escribe la fixture. La consola solo muestra los alias.
import { createRecorder, env, legacyClient, legacyEnvironment, queueRef, rejectMessageQueue, sessionSendOf } from './lib/legacy-recorder.mjs';

const scenario = process.argv[2];
if (!['walk', 'empty', 'count', 'messages'].includes(scenario)) {
  console.error(`escenario desconocido: ${scenario ?? '(ninguno)'} (usa walk, empty, count o messages)`);
  process.exit(2);
}
const { environment, credentials, queuePcc, queuePccLabel, secrets } = legacyEnvironment();
const pccRequest = queuePcc === undefined ? {} : { pcc: queuePcc };
const queueText = scenario === 'messages' ? 'S' : scenario === 'empty' ? env('SABRE_EMPTY_QUEUE') : env('SABRE_QUEUE');
const queue = queueRef(queueText);
if (scenario === 'walk' || scenario === 'empty') rejectMessageQueue(queue, scenario === 'empty' ? 'SABRE_EMPTY_QUEUE' : 'SABRE_QUEUE');
const limit = Number(process.env.SABRE_QUEUE_LIMIT ?? 10);
if (!Number.isInteger(limit) || limit < 1) {
  console.error('SABRE_QUEUE_LIMIT debe ser un entero ≥ 1');
  process.exit(2);
}

const { aliasOf, step, stepSummary, results, options, logger, writeFixture } = createRecorder(secrets);
const legacy = legacyClient(environment, credentials, logger);

console.log(`entorno ${environment} · escenario ${scenario} · cola ${queueText} · PCC de las colas: ${queuePccLabel}`);
const session = await legacy.openSession(options);
const send = sessionSendOf(session);
if (send === undefined) {
  console.error('no se encontró sessionSend en el prototipo de la sesión');
  await session.close();
  process.exit(1);
}
const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';
const rawNavigation = (action) =>
  session[send]({
    service: 'queueAccess',
    action: 'QueueAccessLLSRQ',
    payload: `<QueueAccessRQ Version="2.1.1" xmlns="${NAMESPACE}"><Navigation Action="${action}"/></QueueAccessRQ>`,
    idempotent: false,
    operation: `probe.${action}`,
    ...options,
  });

/** La forma de una respuesta de `QueueAccessRS`, sin texto: nombres de nodos y cuántas líneas. */
const shapeOf = (r) => {
  const payload = r?.payload ?? {};
  const paragraph = payload.Paragraph;
  const texts = paragraph === undefined ? [] : [paragraph].flat().flatMap((p) => [p?.Text ?? []].flat());
  return {
    payload: r?.payloadName,
    keys: Object.keys(payload),
    line: payload.Line !== undefined,
    paragraph: paragraph !== undefined,
    paragraphKeys: paragraph === undefined ? undefined : Object.keys([paragraph].flat()[0] ?? {}),
    textLines: texts.length,
    warnings: r?.warnings?.length,
  };
};
const rawAccess = () =>
  session[send]({
    service: 'queueAccess',
    action: 'QueueAccessLLSRQ',
    payload: `<QueueAccessRQ Version="2.1.1" xmlns="${NAMESPACE}"><QueueIdentifier Number="S" PseudoCityCode="${queuePcc ?? env('SABRE_PCC')}"/></QueueAccessRQ>`,
    idempotent: false,
    operation: 'probe.access S',
    ...options,
  });

class CountOnly extends Error {}
let listed;
const visited = [];
try {
  // Número y cola alfabética ('S') se comparan por valor; las con nombre, por `name` (ADR-028).
  const sameQueue = (ref) => (typeof ref !== 'object' ? ref === queue : typeof queue === 'object' && ref.name === queue.name);
  await step('count', () => session.queue.count(pccRequest, options), (r) => ({
    queues: r.queues.length,
    totals: r.totals,
    queue: { queue: queueText, count: r.queues.find((q) => sameQueue(q.queue))?.count ?? 0 },
  }));
  if (scenario === 'count') throw new CountOnly();
  if (scenario === 'messages') {
    // Solo `I` y `QXI` después del access: nunca `QR`, así que ningún mensaje sale de la cola.
    await step('probe.access S', rawAccess, shapeOf);
    await step('probe.I en S', () => rawNavigation('I'), shapeOf);
    await step('probe.QXI', () => rawNavigation('QXI'), shapeOf);
    throw new CountOnly();
  }
  listed = await step('list', () => session.queue.list({ queue, ...pccRequest }, options), (r) => ({ locators: r.locators.map(aliasOf) }));

  if (scenario === 'walk') {
    // ¿list dejó la sesión dentro de la cola? Un `I` crudo: un PNR quiere decir que sí.
    await step('probe.I después de list', () => rawNavigation('I'), (r) => ({ payload: r.payloadName, line: r.payload?.Line !== undefined }));
    // Salir por las dudas, y un segundo `QXI` que seguro va fuera de una cola.
    await step('probe.QXI', () => rawNavigation('QXI'), (r) => ({ payload: r.payloadName }));
    await step('probe.QXI fuera de una cola', () => rawNavigation('QXI'), (r) => ({ payload: r.payloadName }));
  }

  let current = await step('access', () => session.queue.access({ queue, ...pccRequest }, options), stepSummary);
  if (current !== undefined && !current.done) visited.push(current.item.locator);

  if (scenario === 'walk' && current !== undefined && !current.done) {
    await step('count dentro de la cola', () => session.queue.count(pccRequest, options), (r) => ({
      queues: r.queues.length,
      queue: { queue: queueText, count: r.queues.find((q) => sameQueue(q.queue))?.count ?? 0 },
    }));
    while (current !== undefined && !current.done && visited.length < limit) {
      current = await step('ignore', () => session.queue.ignore(options), stepSummary);
      if (current !== undefined && !current.done) visited.push(current.item.locator);
    }
  }
  if (session.queue.state !== 'outside') await step('exit', () => session.queue.exit(options));
} catch (error) {
  if (!(error instanceof CountOnly)) throw error;
} finally {
  await step('close', () => session.close(options));
}

// --- Hallazgos ----------------------------------------------------------------------------------
const listOrder = listed?.locators ?? [];
const result = (name) => results.find((r) => r.step === name);
const findings = {
  listedCount: listOrder.length,
  visitedCount: visited.length,
  traversalMatchesList: visited.every((locator, index) => locator === listOrder[index]),
  endOfDisplay: results.some((r) => r.done === true),
  ...(scenario === 'walk' && {
    listLeavesSessionInside: result('probe.I después de list')?.line === true,
    qxiOutsideQueue: result('probe.QXI fuera de una cola'),
    // Si el PNR que sigue a count dentro de la cola es el segundo de la lista, count no movió el cursor.
    countInsideKeepsCursor: visited.length >= 2 ? visited[1] === listOrder[1] : undefined,
  }),
  finalState: session.queue.state,
  ...(scenario === 'messages' && {
    messageCount: result('count')?.queue?.count,
    messagesTotal: result('count')?.totals,
    accessShape: result('probe.access S'),
    ignoreShape: result('probe.I en S'),
    exitShape: result('probe.QXI'),
  }),
};

writeFixture(`queue.${environment}-${scenario}`, { environment, scenario, queue: typeof queue === 'object' ? { name: 'XXXX' } : queue }, findings);
