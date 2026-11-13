#!/usr/bin/env node
// Fixture del «Summary» del DQB (`TKT_TravelAgencyReportsRQ` / `DailySalesSummaryRQ` 1.2.2, ADR-030,
// #223), a partir de sobres `DailySalesSummaryRS` reales ya guardados en disco. No llama a Sabre:
// recibe los XML de la prueba de solo lectura (sabre-wiki: wiki/sources/dqb-prueba-2026-11-12.md),
// los anonimiza por estructura y escribe test/fixtures/reporting.production-daily-sales-summary.json.
// Lo corre el usuario o el agente con su confirmación; nunca la CI.
//
//   node --env-file=.env.production scripts/record-daily-sales.mjs <hoy.xml> <ayer.xml>
//
// Con `--name`, escribe otra fixture y no toca la de producción (#243). Los sobres se etiquetan
// con `--labels` (separadas por comas, una por XML) y el resto de los metadatos sale de
// `--environment`, `--recorded-at` y `--source`:
//
//   node --env-file=.env scripts/record-daily-sales.mjs --name daily-sales-void \
//     --environment sandbox --labels 2026-11-12,2026-11-13 --recorded-at 2026-11-13 \
//     --source '…' <dia1.xml> <dia2.xml>
//
// escribe test/fixtures/reporting.sandbox-daily-sales-void.json.
//
// Variables: las credenciales (como en los demás scripts) y SABRE_TARGET_PCC, si el reporte es de
// otro PCC: todos entran como secretos.
//
// Anonimización, además de `createAnonymizer` (secretos, `PseudoCityCode`, `AgentSine` y
// `PassengerName`, que pasa a `PASAJERO/UNO`, `PASAJERO/DOS`…):
// - `PnrLocator` pasa al alias del anonimizador (`AAAAAA`, `AAAAAB`…), igual en los dos sobres;
// - `DocumentNumber` conserva los 3 dígitos de la aerolínea y el resto pasa a un consecutivo;
// - los importes (`Amount`, `PaymentTotal`, `PaymentAmount`, `CashTotals`, `CreditTotals`,
//   `CommissionTotals`) pasan a valores fijos con los mismos decimales;
// - `AgentSine` a `AAA`, `AgentPseudoCity` a `XXXX` y `AgencyName` a `AGENCIA`.
// Se conservan los enums, los atributos (`count`, `fop`, `category`…), las fechas y las horas.
// Si después de todo queda un valor original, corta con código 1 sin escribir.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createAnonymizer } from '../dist/testing.js';
import { envCredentials } from './lib/env-credentials.mjs';

const USAGE = 'uso: record-daily-sales.mjs [--name <nombre> --labels <a,b…> --environment <sandbox|production> --recorded-at <fecha> --source <texto>] <xml>…';
let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      labels: { type: 'string' },
      environment: { type: 'string' },
      'recorded-at': { type: 'string' },
      source: { type: 'string' },
    },
  });
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(2);
}
const { values: options, positionals: files } = args;
// Sin `--name`, todo queda como antes: la fixture de producción con el día en curso y el anterior.
const custom = options.name !== undefined;
const extra = ['labels', 'environment', 'recorded-at', 'source'].filter((key) => options[key] !== undefined);
if (!custom && extra.length > 0) {
  console.error(`--${extra.join(', --')} solo con --name: sin él se escribe la fixture de producción\n${USAGE}`);
  process.exit(2);
}
if (custom && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(options.name)) {
  console.error(`--name va en kebab-case, sin extensión (recibido: ${options.name})`);
  process.exit(2);
}
const environment = options.environment ?? 'production';
if (environment !== 'sandbox' && environment !== 'production') {
  console.error(`--environment debe ser sandbox o production (recibido: ${environment})`);
  process.exit(2);
}
if (custom && environment === 'production' && options.name === 'daily-sales-summary') {
  console.error('ese --name es la fixture de producción: corre el script sin --name');
  process.exit(2);
}
const labels = custom ? (options.labels ?? '').split(',').filter((label) => label !== '') : ['today', 'previousDay'];
if (files.length === 0 || files.length !== labels.length) {
  console.error(`${custom ? `--labels trae ${labels.length} etiquetas para ${files.length} XML` : 'faltan <hoy.xml> y <ayer.xml>'}\n${USAGE}`);
  process.exit(2);
}
if (custom && (options['recorded-at'] === undefined || options.source === undefined)) {
  console.error(`con --name hacen falta --recorded-at y --source\n${USAGE}`);
  process.exit(2);
}

const { secrets } = envCredentials({ authVersion: 'v3' });
const { anonymize, aliasOf, leaks } = createAnonymizer({ secrets: [...secrets, process.env.SABRE_TARGET_PCC] });

const names = new Set();
const documents = new Map();
const originals = new Set();

/** Reemplaza el texto de cada `<prefijo:name>…</prefijo:name>` con `replace(texto)`. */
const element = (xml, name, replace) =>
  xml.replace(new RegExp(`(<(?:[\\w-]+:)?${name}\\b[^>]*>)([^<]*)(</(?:[\\w-]+:)?${name}>)`, 'g'), (_, open, text, close) => {
    if (text.trim() !== '') originals.add(text.trim());
    return `${open}${replace(text.trim())}${close}`;
  });

const fakeAmount = (fixed) => (text) => (/\.\d+$/.test(text) ? `${fixed}.${'0'.repeat(text.split('.')[1].length)}` : String(fixed));

function anonymizeSummary(xml) {
  let out = xml;
  out = element(out, 'PnrLocator', (text) => aliasOf(text));
  // `PassengerName` lo reemplaza `anonymize` (`PASAJERO/UNO`…); aquí solo se cuenta.
  for (const match of out.matchAll(/<(?:[\w-]+:)?PassengerName\b[^>]*>([^<]*)</g)) {
    originals.add(match[1].trim());
    names.add(match[1].trim());
  }
  out = element(out, 'DocumentNumber', (text) => {
    if (!documents.has(text)) documents.set(text, `${text.slice(0, 3)}${String(documents.size + 1).padStart(text.length - 3, '0')}`);
    return documents.get(text);
  });
  for (const name of ['Amount', 'PaymentTotal', 'PaymentAmount']) out = element(out, name, fakeAmount(100));
  for (const name of ['CashTotals', 'CreditTotals', 'CommissionTotals']) out = element(out, name, fakeAmount(1000));
  out = element(out, 'AgentSine', () => 'AAA');
  out = element(out, 'AgentPseudoCity', () => 'XXXX');
  out = element(out, 'AgencyName', () => 'AGENCIA');
  return anonymize(out);
}

const responses = files.map((file, index) => [labels[index], file]).map(([label, file]) => ({ operation: 'reporting.dailySalesSummary', label, status: 200, body: anonymizeSummary(readFileSync(file, 'utf8')) }));

const fixture = custom
  ? { recordedAt: options['recorded-at'], environment, scenario: options.name, source: options.source, responses }
  : {
      recordedAt: '2026-11-12',
      environment: 'production',
      scenario: 'daily-sales-summary',
      source: 'sabre-wiki: wiki/sources/dqb-prueba-2026-11-12.md (PCC P8, día en curso y día anterior)',
      responses,
    };
const text = `${JSON.stringify(fixture, null, 2)}\n`;

// Los importes y los números de documento originales pueden ser cortos o repetirse en valores
// legítimos (`count="1"`), así que se buscan solo los que tienen forma de dato real.
const realValues = [...originals].filter((value) => /^[A-Z]{6}$|\/|^\d{10,}$|^\d+\.\d{2}$/.test(value) && !/^(PASAJERO|AAAA)/.test(value));
// Se busca como texto completo de un elemento o un atributo: `0.00` está dentro de `100.00`.
const remaining = realValues.filter((value) => text.includes(`>${value}<`) || text.includes(`"${value}"`));
const found = leaks(text);
if (found.length > 0 || remaining.length > 0) {
  for (const value of remaining) console.error(`  queda: ${value.replace(/[A-Z]/g, 'A').replace(/\d/g, '9')}`);
  console.error(`⚠️ la fixture todavía trae datos reales (${[...found, `${remaining.length} valores originales`].join(', ')}): no se escribe.`);
  process.exit(1);
}
const file = new URL(`../test/fixtures/reporting.${fixture.environment}-${fixture.scenario}.json`, import.meta.url);
writeFileSync(file, text);
console.log(`fixture: ${file.pathname} (${responses.length} sobres, ${documents.size} documentos, ${names.size} pasajeros)`);
