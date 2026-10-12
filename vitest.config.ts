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
    // Tests that start the real engine load the dictionaries and word pairs; on a busy machine that
    // can pass the default 5 seconds.
    testTimeout: 20_000,
  },
});
