import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '#': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    coverage: {
      reporter: ['text', 'html'],
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/production-evaluation.test.ts', 'tests/benchmark-evaluation.test.ts'],
  },
});
