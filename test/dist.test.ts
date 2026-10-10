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
