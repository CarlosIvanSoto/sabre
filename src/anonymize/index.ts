// Subruta `sabre-client/anonymize` (#192): solo la anonimización, sin el fake de colas ni las
// `queueFixtures` de `sabre-client/testing`, para poder importarla en un bundle de navegador.
// `sabre-client/testing` sigue exportando lo mismo. Ver ADR-027 (D1) y ADR-006.
export { createAnonymizer, isSafeHostLine } from '../testing/anonymize.js';
export type { Anonymizer, AnonymizerLeak, AnonymizerOptions } from '../testing/anonymize.js';
