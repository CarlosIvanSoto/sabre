import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Los ejemplos importan el paquete por su nombre: en los tests se resuelve a src/, sin build.
  resolve: { alias: { 'sabre-client': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
