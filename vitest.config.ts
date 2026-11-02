import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Los ejemplos importan el paquete por su nombre: en los tests se resuelve a src/, sin build.
  // La subruta va primero: un alias por string también tomaría `sabre-client/testing`.
  resolve: {
    alias: [
      { find: /^sabre-client\/testing$/, replacement: fileURLToPath(new URL('./src/testing/index.ts', import.meta.url)) },
      { find: /^sabre-client$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
