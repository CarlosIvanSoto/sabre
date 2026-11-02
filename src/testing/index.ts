// Subruta `sabre-client/testing`: herramientas para que los consumidores prueben su lógica de
// colas sin red. No entra en el bundle principal. Ver sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md
// (punto 7) y wiki/sdk/configuracion-logging-y-build.md.
export { createQueueFake } from './queue-fake.js';
export type {
  QueueFake,
  QueueFakeCall,
  QueueFakeCommand,
  QueueFakeItem,
  QueueFakeOptions,
  QueueFakePnr,
} from './queue-fake.js';
export { queueFixtures } from './fixtures.js';
export type { RecordedFixture, RecordedResponse } from './fixtures.js';
