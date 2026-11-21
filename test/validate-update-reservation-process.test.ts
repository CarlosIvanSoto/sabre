// scripts/validate-update-reservation.mjs como proceso (#272): lo que corta antes de abrir sesión.
// Sin credenciales en el entorno, así que si el script intentara abrir una sesión fallaría distinto.
// Requiere `npm run build` antes (el script importa dist/), como en la CI: sin dist/ el test falla
// con ese aviso en vez de saltarse en silencio (revisión del PR #282, hallazgo 3).
import { describe, expect, it } from 'vitest';

// Rutas en variable y tipos a mano: el typecheck no tiene @types/node.
type SpawnResult = { status: number | null, stdout: string, stderr: string };
type ChildProcess = { spawnSync: (command: string, args: string[], options: object) => SpawnResult };
const childProcessPath = 'node:child_process';
const childProcess: ChildProcess | undefined = await import(/* @vite-ignore */ childProcessPath).catch(() => undefined);
const distPath = '../dist/index.js';
const dist: unknown = await import(/* @vite-ignore */ distPath).catch(() => undefined);
const nodeProcess = (globalThis as { process?: { execPath: string, env: Record<string, string | undefined> } }).process;

function run(env: Record<string, string>): SpawnResult {
  if (dist === undefined || childProcess === undefined || nodeProcess === undefined) throw new Error('falta dist/: corre npm run build antes de npm test');
  // Solo PATH y las variables del caso: ni credenciales ni .env.
  return childProcess!.spawnSync(nodeProcess!.execPath, ['scripts/validate-update-reservation.mjs'], {
    env: { PATH: nodeProcess!.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('validate-update-reservation como proceso', () => {
  it('tiene dist/ y Node para correr el script', () => {
    expect(dist, 'falta dist/: corre npm run build antes de npm test (la CI lo hace)').toBeDefined();
    expect(childProcess, 'sin node:child_process').toBeDefined();
    expect(nodeProcess, 'sin process').toBeDefined();
  });

  it('SABRE_SCAN_REQUEST_TYPE=stateless corta con código 2 antes de abrir sesión', () => {
    for (const step of ['scan', 'read']) {
      const result = run({ SABRE_UPDATE_STEP: step, SABRE_SCAN_REQUEST_TYPE: 'stateless' });
      expect(result.status, step).toBe(2);
      expect(result.stderr + result.stdout, step).toMatch(/airlines only/);
      expect(result.stderr + result.stdout, step).not.toMatch(/sesión abierta|GetReservationRQ (Trip|Stateful)/);
    }
  });

  it('el seco de confirm sigue sin abrir sesión ni leer credenciales', () => {
    const result = run({ SABRE_UPDATE_STEP: 'confirm', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_EXPECTED_IDS: '8,10' });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/EN SECO: no se llama a Sabre/);
    expect(result.stdout).toMatch(/--write=confirm:ABC123:8,10/);
    expect(result.stderr).toBe('');
  });

  it('el seco de remove tampoco', () => {
    const result = run({ SABRE_UPDATE_STEP: 'remove', SABRE_UPDATE_LOCATOR: 'ABC123', SABRE_UPDATE_SEGMENT_IDS: '12' });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/EN SECO: no se llama a Sabre/);
    expect(result.stdout).toMatch(/--write=remove:ABC123:12/);
    expect(result.stderr).toBe('');
  });
});
