#!/usr/bin/env node
// Fixture de Search For Itineraries (`Trip_SearchRQ` 4.5.0, ADR-033, #249) a partir de sobres
// `Trip_SearchRS` reales ya guardados en disco. No llama a Sabre: recibe los XML de una prueba de
// solo lectura (sabre-wiki: wiki/sources/trip-search-prueba-2026-11-16.md), los anonimiza y
// escribe test/fixtures/trip-search.<environment>-<name>.json. Lo corre el usuario o el agente con
// su confirmación; nunca la CI.
//
//   node --env-file=.env scripts/record-trip-search.mjs --name cert1 --environment sandbox \
//     --recorded-at 2026-11-16 --source '…' --labels one,empty,wide <a.xml> <b.xml> <c.xml>
//
// Variables: las credenciales (como en los demás scripts) y SABRE_TARGET_PCC si la prueba fue en
// otro PCC: todos entran como secretos.
//
// Anonimización, además de `createAnonymizer` (secretos y `PseudoCityCode` a `XXXX`):
// - cada `Reservation@Locator` pasa al alias del anonimizador (`AAAAAA`, `AAAAAB`…), el mismo en
//   todos los sobres, en el orden en que aparecen;
// - `eb:CPAId` (el PCC de la sesión) a `XXXX`.
// Se conservan los contadores (`NumberResults`, `NumberPages`, `TotalResults`), el `TimeStamp` de
// la raíz y `eb:Timestamp`. Si después de todo queda un valor original, corta con código 1 sin
// escribir.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createAnonymizer } from '../dist/testing.js';
import { envCredentials } from './lib/env-credentials.mjs';

const USAGE = 'uso: record-trip-search.mjs --name <nombre> --environment <sandbox|production> --recorded-at <fecha> --source <texto> --labels <a,b…> <xml>…';
let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      environment: { type: 'string' },
      'recorded-at': { type: 'string' },
      source: { type: 'string' },
      labels: { type: 'string' },
    },
  });
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(2);
}
const { values: options, positionals: files } = args;
const missing = ['name', 'environment', 'recorded-at', 'source', 'labels'].filter((key) => options[key] === undefined);
if (missing.length > 0) {
  console.error(`faltan --${missing.join(', --')}\n${USAGE}`);
  process.exit(2);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(options.name)) {
  console.error(`--name va en kebab-case, sin extensión (recibido: ${options.name})`);
  process.exit(2);
}
if (options.environment !== 'sandbox' && options.environment !== 'production') {
  console.error(`--environment debe ser sandbox o production (recibido: ${options.environment})`);
  process.exit(2);
}
const labels = options.labels.split(',').filter((label) => label !== '');
if (files.length === 0 || files.length !== labels.length) {
  console.error(`--labels trae ${labels.length} etiquetas para ${files.length} XML\n${USAGE}`);
  process.exit(2);
}

const { secrets } = envCredentials({ authVersion: 'v3' });
const { anonymize, leaks } = createAnonymizer({ secrets: [...secrets, process.env.SABRE_TARGET_PCC] });

const LOCATOR = /(<(?:[\w-]+:)?Reservation\b[^>]*\bLocator=")([^"]*)(")/g;
const originals = new Set();
// Alias propios, no los de `createAnonymizer`: un XML que ya pasó por una anonimización previa (los
// de `cert1`) trae alias (`AAAAAA`) que se conservan, y los nuevos se saltan los que ya están.
const aliases = new Map();
const taken = new Set();
const nextAlias = () => {
  for (let n = 0; ; n++) {
    let alias = '';
    for (let i = 0, k = n; i < 6; i++, k = Math.floor(k / 26)) alias = String.fromCharCode(65 + (k % 26)) + alias;
    if (!taken.has(alias)) return alias;
  }
};
const aliasOf = (locator) => {
  if (!aliases.has(locator)) {
    const alias = /^AAA[A-Z]{3}$/.test(locator) ? locator : nextAlias();
    aliases.set(locator, alias);
    taken.add(alias);
  }
  return aliases.get(locator);
};

function anonymizeSearch(xml) {
  let out = xml.replace(LOCATOR, (_, open, locator, close) => {
    if (!/^AAA[A-Z]{3}$/.test(locator)) originals.add(locator);
    return `${open}${aliasOf(locator)}${close}`;
  });
  out = out.replace(/(<(?:[\w-]+:)?CPAId\b[^>]*>)[^<]*(<\/(?:[\w-]+:)?CPAId>)/g, '$1XXXX$2');
  return anonymize(out);
}

const inputs = files.map((file) => readFileSync(file, 'utf8'));
// Primero los alias previos, para que los nuevos no los repitan.
for (const xml of inputs) for (const match of xml.matchAll(LOCATOR)) if (/^AAA[A-Z]{3}$/.test(match[2])) aliasOf(match[2]);

const responses = inputs.map((xml, index) => ({
  operation: 'reservation.searchByUpdateDate',
  label: labels[index],
  status: 200,
  body: anonymizeSearch(xml),
}));
const fixture = { recordedAt: options['recorded-at'], environment: options.environment, scenario: options.name, source: options.source, responses };
const text = `${JSON.stringify(fixture, null, 2)}\n`;

const remaining = [...originals].filter((value) => text.includes(value));
const found = leaks(text);
if (found.length > 0 || remaining.length > 0) {
  console.error(`quedan datos reales (${[...found, ...(remaining.length > 0 ? [`${remaining.length} localizadores`] : [])].join(', ')}): no se escribe`);
  process.exit(1);
}
const out = new URL(`../test/fixtures/trip-search.${options.environment}-${options.name}.json`, import.meta.url);
writeFileSync(out, text);
console.log(`escrita ${out.pathname}: ${responses.length} sobres, ${originals.size} localizadores con alias`);
