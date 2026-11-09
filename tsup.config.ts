import { defineConfig } from 'tsup';

export default defineConfig({
  // Tres entradas: el SDK, la subruta `sabre-client/testing` (el fake de colas) y
  // `sabre-client/anonymize` (solo la anonimización, #192). Sin `splitting`, cada archivo de dist/
  // es independiente: dist/index.js no cambia por las otras entradas, y dist/anonymize.js no
  // arrastra el fake ni las fixtures.
  entry: { index: 'src/index.ts', testing: 'src/testing/index.ts', anonymize: 'src/anonymize/index.ts' },
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
});
