// Respuestas de producción grabadas en la validación del Tier 3 (#96 y #97), anonimizadas: PCC
// como `XXXX`, firmas como `AAA`, localizadores como alias (`AAAAAA`…), el token como
// `[REDACTED]` y el párrafo enmascarado (letras a `X`, dígitos a `9`), salvo los avisos PIC,
// los encabezados fijos y el fin de cola. Ver scripts/lib/legacy-recorder.mjs.
import placeJson from '../../test/fixtures/queue.production-place.json';
import placeWithoutCodeJson from '../../test/fixtures/queue.production-place-sin-pic.json';
import placeWithoutCodeInsideJson from '../../test/fixtures/queue.production-place-sin-pic-adentro.json';
import emptyQueueJson from '../../test/fixtures/queue.production-walk-empty-queue.json';
import walkJson from '../../test/fixtures/queue.production-walk.json';

/** Una respuesta grabada: la operación del SDK, el HTTP status y el sobre SOAP tal cual llegó. */
export interface RecordedResponse {
  /** `operation` de `onRawResponse` (`'openSession'`, `'queue.access'`…) o `probe.*` si el script la mandó crudo. */
  operation: string;
  status: number;
  body: string;
}

/** Una corrida grabada: sus respuestas en el orden en que llegaron. */
export interface RecordedFixture {
  /** Fecha de la corrida, `YYYY-MM-DD` en UTC. */
  recordedAt: string;
  responses: readonly RecordedResponse[];
}

function fixture(json: { recordedAt: string; responses: readonly RecordedResponse[] }): RecordedFixture {
  return Object.freeze({
    recordedAt: json.recordedAt,
    responses: Object.freeze(
      json.responses.map(({ operation, status, body }) => Object.freeze({ operation, status, body })),
    ),
  });
}

/**
 * Las corridas de producción del Tier 3. Cada una usa sus propios alias de localizador, así que
 * se pueden juntar en un fake con `queueFakePnrs` sin que choquen:
 * - `walk`: `AAAAAA`–`AAAAAD`; `place`: `AAAAAE`–`AAAAAF`;
 *   `placeWithoutInstructionCodeInside`: `AAAAAG`–`AAAAAH`.
 *
 * Qué trae cada una:
 * - `walk`: `count`, `list`, `access` y `ignore` sobre una cola de 4 PNR hasta el fin de cola,
 *   más `I` y `QXI` fuera de una cola;
 * - `emptyQueue`: `access` y `list` sobre una cola vacía (`QUEUE SELECTED WAS EMPTY`);
 * - `place`: `place` fuera y dentro de una cola, y `remove` hasta el fin de cola;
 * - `placeWithoutInstructionCode` y `placeWithoutInstructionCodeInside`: `place` sin PIC, fuera
 *   (`INSTRUCTION NUMBER NOT IN RANGE`) y dentro de una cola (`NEED INSTRUCTION NUMBER`).
 *
 * El `list` de `walk` se grabó sin `primaryPassenger: true` (sin `/LN`), así que ningún `Line`
 * trae `PassengerName` (#193).
 */
export const queueFixtures: Readonly<{
  walk: RecordedFixture;
  emptyQueue: RecordedFixture;
  place: RecordedFixture;
  placeWithoutInstructionCode: RecordedFixture;
  placeWithoutInstructionCodeInside: RecordedFixture;
}> = Object.freeze({
  walk: fixture(walkJson),
  emptyQueue: fixture(emptyQueueJson),
  place: fixture(placeJson),
  placeWithoutInstructionCode: fixture(placeWithoutCodeJson),
  placeWithoutInstructionCodeInside: fixture(placeWithoutCodeInsideJson),
});
