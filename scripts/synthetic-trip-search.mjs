#!/usr/bin/env node
// Sobres sintéticos de `Trip_SearchRS` para ADR-033 (#249): lo que no se vio en Sabre (truncado,
// NumberPages > 1, Reservation@Error, zona que no coincide y los errores de la guía), armado sobre el
// sobre real "one" de test/fixtures/trip-search.sandbox-cert1.json. No llama a Sabre.
//
//   node scripts/synthetic-trip-search.mjs
//
// Escribe test/fixtures/trip-search.synthetic-guide.json. Cada sobre lleva su `source`.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../test/fixtures/', import.meta.url).pathname;
const cert = JSON.parse(readFileSync(`${root}trip-search.sandbox-cert1.json`, 'utf8'));
const template = cert.responses.find((r) => r.label === 'one').body;
const open = /<Trip_SearchRS\b[^>]*>/.exec(template)[0];
const env = (inner, { local, utc } = {}) => {
  let body = template.replace(/<Trip_SearchRS\b[^>]*>[\s\S]*<\/Trip_SearchRS>/, `${open}${inner}</Trip_SearchRS>`);
  if (local) body = body.replace(/(<Trip_SearchRS\b[^>]*TimeStamp=")[^"]*(")/, `$1${local}$2`);
  if (utc) body = body.replace(/(<eb:Timestamp>)[^<]*(<\/eb:Timestamp>)/, `$1${utc}$2`);
  return body;
};
const res = (locs, extra = '') => locs.map((l) => (typeof l === 'string' ? `<Reservation Locator="${l}"${extra}><stl19:GetReservationRS xmlns:stl19="http://webservices.sabre.com/pnrbuilder/v1_19" Version="1.19.0"></stl19:GetReservationRS></Reservation>` : `<Reservation Locator="${l.locator}" Error="${l.error}"/>`)).join('');
const list = (n, pages, total, locs) => `<ReservationsList NumberResults="${n}" NumberPages="${pages}" TotalResults="${total}"><Reservations>${res(locs)}</Reservations></ReservationsList>`;
const err = (code, severity, message) => `<Errors><Error ErrorCode="${code}" Severity="${severity}" ErrorMessage="${message}"/></Errors>`;
const GUIDE = 'User Guide 4.5.0, 5.1 «List of Codes» (el código sale del orden de las dos columnas, que el PDF separó)';
const cases = [
  ['truncated-counters', `<Success>Success</Success>${list(3, 1, 5, ['AAAAAA', 'AAAAAB', 'AAAAAC'])}`, 'Design RS (NumberResults, TotalResults): TotalResults > NumberResults sin advertencia. Armado; no se vio en Sabre.'],
  ['truncated-warning-error-element', `<Success>Success</Success>${err('200006', 'MINOR', 'Number of results exceeded view limit or requested PNRs limit')}${list(2, 1, 2, ['AAAAAA', 'AAAAAB'])}`, `${GUIDE}: 200006, texto de la sección 1 (Overview). Se supone que llega como Errors/Error junto a la lista, con contadores iguales; la ubicación y Severity son supuestas. No se vio en Sabre.`],
  ['truncated-warning-warning-element', `<Success>Success</Success><Warnings><Warning ErrorCode="200006" Severity="MINOR" ErrorMessage="Number of results exceeded view limit or requested PNRs limit"/></Warnings>${list(2, 1, 2, ['AAAAAA', 'AAAAAB'])}`, `${GUIDE}: 200006. Variante con Warnings/Warning, por si la advertencia no llega como Error; forma supuesta. No se vio en Sabre.`],
  ['max-exceeded-warning', `<Success>Success</Success>${err('200005', 'MINOR', 'Max number of requested PNRs exceeded view limit [800]')}${list(1, 1, 1, ['AAAAAA'])}`, `${GUIDE}: 200005, con todos los resultados (la guía dice que se devuelven todos). Ubicación y Severity supuestas. No se vio en Sabre.`],
  ['number-pages', `<Success>Success</Success>${list(2, 2, 2, ['AAAAAA', 'AAAAAB'])}`, 'Design RS (NumberPages): NumberPages > 1 en una búsqueda síncrona. Armado; no se vio en Sabre.'],
  ['reservation-error', `<Success>Success</Success><ReservationsList NumberResults="2" NumberPages="1" TotalResults="2"><Reservations>${res(['AAAAAA'])}${res([{ locator: 'AAAAAB', error: 'General PNR error' }])}</Reservations></ReservationsList>`, 'Design RS (Reservation@Error) con el texto de 700001 de la guía. Armado; no se vio en Sabre.'],
  ['duplicate-locator', `<Success>Success</Success><ReservationsList NumberResults="3" NumberPages="1" TotalResults="3"><Reservations>${res(['AAAAAA', 'AAAAAB'])}</Reservations><Reservations>${res(['AAAAAA'])}</Reservations></ReservationsList>`, 'Design RS (Reservations repetible): el mismo localizador dos veces, para la deduplicación. Armado; no se vio en Sabre.'],
  ['timezone-mismatch', `<Success>Success</Success>${list(1, 1, 1, ['AAAAAA'])}`, 'Sobre real "one" con el TimeStamp de la raíz en UTC-5 (US Central en horario de verano) frente a eb:Timestamp: para TIMEZONE_MISMATCH con America/Mexico_City (Q-137). Armado.', { local: '2026-11-16T15:24:13' }],
  ['error-no-primary-criteria', err('200204', 'MINOR', 'There is no primary criteria specified'), 'User Guide 4.5.0, 5.2 «Samples» (ejemplo de la guía, con el namespace del sobre real). No se vio en Sabre.'],
  ['error-criteria-too-weak', err('200207', 'MODERATE', 'Primary criteria too weak – add more specific primary criterion'), `${GUIDE}: 200207. Severity supuesta. No se vio en Sabre.`],
  ['error-too-many-results', err('200206', 'MODERATE', 'Too many results – specify more data'), `${GUIDE}: 200206. Severity supuesta. No se vio en Sabre.`],
  ['error-db-search-timeout', err('200203', 'MODERATE', 'DB search timeout'), `${GUIDE}: 200203. Severity supuesta. No se vio en Sabre.`],
  ['error-empty-pcc-after-branch-access', err('200208', 'MODERATE', 'Empty PCC list after Branch access check'), `${GUIDE}: 200208. Severity supuesta. No se vio en Sabre.`],
  ['error-empty-pcc-list', err('200102', 'MODERATE', 'Request validation error - Empty PCC List'), `${GUIDE}: 200102. Severity supuesta. No se vio en Sabre.`],
  ['error-unable-to-process-db-search', err('200202', 'MODERATE', 'Unable to process DB search'), 'User Guide 4.5.0, 5.2 «Samples» (200202, MODERATE): otro error, para UNKNOWN. No se vio en Sabre.'],
];
const fixture = {
  recordedAt: '2026-11-16',
  environment: 'synthetic',
  scenario: 'guide',
  source: 'Sobres armados a mano para ADR-033 (#249), sobre el sobre real "one" de trip-search.sandbox-cert1.json (mismo header y raíz). Ninguno se vio en Sabre: el contenido sale de la guía o del design (ver source de cada uno).',
  responses: cases.map(([label, inner, source, stamps]) => ({ operation: 'reservation.searchByUpdateDate', label, source, status: 200, body: env(inner, stamps) })),
};
writeFileSync(`${root}trip-search.synthetic-guide.json`, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(fixture.responses.length, 'sobres');
