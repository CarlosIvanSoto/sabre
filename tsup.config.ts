import { defineConfig } from 'tsup';

export default defineConfig({
  // Dos entradas: el SDK y la subruta `sabre-client/testing` (el fake de colas). Sin `splitting`,
  // dist/index.js no cambia por la segunda entrada y no comparte módulos con dist/testing.js.
  entry: { index: 'src/index.ts', testing: 'src/testing/index.ts' },
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
});
