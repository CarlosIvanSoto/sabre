// Subruta `sabre-client/testing`: herramientas para que los consumidores prueben su lógica de
// colas, de ventas del día y de reserva y emisión sin red, y la anonimización de las respuestas grabadas. No entra en el bundle principal. Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md
// (punto 7) y wiki/sdk/configuracion-logging-y-build.md.
export { createQueueFake, QUEUE_FAKE_SELECTION_FUNCTIONS } from './queue-fake.js';
export type {
  QueueFake,
  QueueFakeActivity,
  QueueFakeCall,
  QueueFakeCommand,
  QueueFakeDailySalesDay,
  QueueFakeHistoryTransaction,
  QueueFakeItem,
  QueueFakeOptions,
  QueueFakePnr,
} from './queue-fake.js';
export type {
  QueueFakeBooking,
  QueueFakeDownlineCause,
  QueueFakeFulfillOutcome,
  QueueFakeTicket,
  QueueFakeTicketing,
  QueueFakeVoidOutcome,
} from './booking-fake.js';
export { createAnonymizer, isSafeHostLine } from './anonymize.js';
export type { Anonymizer, AnonymizerLeak, AnonymizerOptions } from './anonymize.js';
export { queueFakePnrs } from './fixture-pnrs.js';
export { queueFixtures } from './fixtures.js';
export type { RecordedFixture, RecordedResponse } from './fixtures.js';
