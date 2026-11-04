#!/usr/bin/env node
// Valida `session.command()` contra Sabre (#142) y graba las respuestas como fixture redactada.
// Lo corre el usuario, con su confirmación en cada corrida; nunca la CI. Necesita `npm run build`
// antes. Reemplaza las respuestas del 2026-11-03, que se perdieron (ADR-021, Consecuencias).
//
//   node --env-file=.env scripts/validate-command.mjs
//   SABRE_ENVIRONMENT=production node --env-file=.env.production scripts/validate-command.mjs
//   SABRE_COMMAND_ACTIVATE=1 node --env-file=.env scripts/validate-command.mjs   # solo sandbox
//
// Abre una sesión y manda, en orden:
// - `W/PT¥*`: estado del TJR "Store Passenger Type In PNR" (`PSGR TYPE - ON/OFF`). Solo lectura,
//   con `idempotent: true`.
// - `SI9`: toma duty code 9 en la sesión. No cambia la configuración del PCC; el AAA se descarta al
//   cerrar.
// - Solo con SABRE_COMMAND_ACTIVATE=1 y en sandbox: `W/PT¥ON` (**cambia la configuración del PCC**:
//   activa el TJR) y otra vez `W/PT¥*`. En producción se rechaza.
//
// Variables: el juego único de credenciales de scripts/lib/env-credentials.mjs, más
// SABRE_ENVIRONMENT (sandbox por defecto) y SABRE_COMMAND_ACTIVATE.
//
// Se graban solo las respuestas, nunca los requests. El SDK ya tapa el BinarySecurityToken. Además
// se reemplazan por `XXXX` el usuario, el PCC y las credenciales, y el `LNIATA` (dirección de la
// terminal) por `XXXXXX`. Si después de redactar queda algún secreto o algo con forma de token de
// sesión, no se escribe la fixture.
import { writeFileSync } from 'node:fs';
import { SabreError, SabreLegacy } from '../dist/index.js';
import { envCredentials } from './lib/env-credentials.mjs';

const environment = process.env.SABRE_ENVIRONMENT || 'sandbox';
if (environment !== 'sandbox' && environment !== 'production') {
  console.error(`SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})`);
  process.exit(2);
}
const activate = process.env.SABRE_COMMAND_ACTIVATE === '1';
if (activate && environment === 'production') {
  console.error('SABRE_COMMAND_ACTIVATE=1 cambia la configuración del PCC: solo se permite en sandbox');
  process.exit(2);
}

const { authVersion, credentials, secrets: credentialSecrets } = envCredentials();
const secrets = credentialSecrets
  .filter((value) => typeof value === 'string' && value.length >= 3)
  .sort((a, b) => b.length - a.length);
const redact = (text) =>
  secrets
    .reduce((value, secret) => value.split(secret).join('XXXX'), String(text))
    .replace(/LNIATA="[^"]*"/g, 'LNIATA="XXXXXX"');

const legacy = new SabreLegacy({ environment, authVersion, credentials, retry: { maxRetries: 0 } });

const commands = [
  { command: 'W/PT¥*', idempotent: true },
  { command: 'SI9' },
  ...(activate ? [{ command: 'W/PT¥ON' }, { command: 'W/PT¥*', idempotent: true }] : []),
];

console.log(`entorno ${environment} · OAuth ${authVersion} · ${activate ? 'CON W/PT¥ON (cambia el PCC)' : 'solo lectura y SI9'}`);

const steps = [];
await legacy.withSession(async (session) => {
  for (const { command, idempotent = false } of commands) {
    let raw;
    const step = { command, idempotent };
    try {
      const screen = await session.command(command, { idempotent, onRawResponse: (r) => (raw = r) });
      step.ok = true;
      step.text = redact(screen.text);
      step.warnings = screen.warnings.map((w) => ({ code: w.code, message: redact(w.message) }));
      console.log(`✔ ${command}\n${step.text}\n`);
    } catch (error) {
      step.ok = false;
      step.error = {
        name: error?.name,
        message: redact(error?.message),
        ...(error instanceof SabreError && { code: error.code, retryable: error.retryable, status: error.status }),
      };
      console.log(`✘ ${command}: ${JSON.stringify(step.error)}`);
    }
    if (raw !== undefined) step.response = { status: raw.status, attempts: raw.attempts, body: redact(raw.body) };
    steps.push(step);
  }
});

const fixture = {
  recordedAt: new Date().toISOString().slice(0, 10),
  environment,
  activate,
  steps,
};
const text = `${JSON.stringify(fixture, null, 2)}\n`;
const leaks = secrets.filter((secret) => text.includes(secret));
if (leaks.length > 0 || /IceSess|Shared\/IDL/.test(text)) {
  console.error('⚠️ la fixture todavía trae un secreto o un token de sesión: no se escribe.');
  process.exit(1);
}
const file = new URL(`../test/fixtures/command.${environment}${activate ? '-activate' : ''}.json`, import.meta.url);
writeFileSync(file, text);
console.log(`fixture: ${file.pathname}`);
