// Verifica la salida ESM real de tsup. Requiere `npm run build` antes (la CI lo hace).
import { describe, expect, it } from 'vitest';

// Ruta en variable para que el typecheck no dependa de que dist/ exista.
const distPath = '../dist/index.js';
const dist: typeof import('../src/index.js') | undefined = await import(/* @vite-ignore */ distPath).catch(
  () => undefined,
);

describe.skipIf(dist === undefined)('build ESM (dist/)', () => {
  it('instanceof funciona sobre las clases exportadas por dist', () => {
    const { SabreError, SabreGatewayError } = dist!;
    const err = new SabreGatewayError('x', { protocol: 'rest', retryable: false });
    expect(err).toBeInstanceOf(SabreGatewayError);
    expect(err).toBeInstanceOf(SabreError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SabreGatewayError');
  });
});

// La subruta `sabre-client/testing` (#98): segunda entrada de tsup, fuera del bundle principal.
const testingPath = '../dist/testing.js';
const testing: typeof import('../src/testing/index.js') | undefined = await import(/* @vite-ignore */ testingPath).catch(
  () => undefined,
);

describe.skipIf(dist === undefined || testing === undefined)('build ESM de sabre-client/testing (dist/)', () => {
  it('el bundle principal no incluye el fake ni las fixtures', async () => {
    // Sin tipos de Node en el typecheck: se importa por una ruta en variable.
    const fsPath = 'node:fs/promises';
    const { readFile } = (await import(/* @vite-ignore */ fsPath)) as { readFile: (path: URL, encoding: 'utf8') => Promise<string> };
    const index = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
    expect(index).not.toContain('createQueueFake');
    expect(index).not.toContain('sabre-client/testing');
    expect(index).not.toMatch(/from ["']\.\/[^"']*testing/);
    expect(dist).not.toHaveProperty('createQueueFake');
  });

  it('el fake de dist/testing.js funciona con el SabreLegacy de dist/index.js', async () => {
    const fake = testing!.createQueueFake({ queues: { '12': [{ locator: 'AAAAAA' }] } });
    const legacy = new dist!.SabreLegacy({
      environment: 'production',
      authVersion: 'v2',
      credentials: { username: 'V1:7971:ABCD:AA', password: 'x' },
      fetch: fake.fetch,
    });
    const result = await legacy.withSession((session) => session.queue.process({ queue: 12 }, () => ({ action: 'remove' })));
    expect(result).toEqual({ visited: 1, ended: 'end-of-display' });
    expect(Object.keys(testing!.queueFixtures)).toContain('walk');
  });

  it('dist/testing.js exporta la anonimización y queueFakePnrs, y el bundle principal no', () => {
    expect(testing!.createAnonymizer().anonymize('<UniqueID ID="QWERTY"/>')).toBe('<UniqueID ID="AAAAAA"/>');
    expect(testing!.isSafeHostLine('REMARKS')).toBe(true);
    expect(dist).not.toHaveProperty('createAnonymizer');
    expect(testing!.queueFakePnrs(testing!.queueFixtures.walk).map((pnr) => pnr.locator)).toEqual(['AAAAAA', 'AAAAAB', 'AAAAAC', 'AAAAAD']);
  });
});
