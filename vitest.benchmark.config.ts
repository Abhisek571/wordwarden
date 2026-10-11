import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '#': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/benchmark-evaluation.test.ts'],
    // The full run with LanguageTool takes about 35 minutes on GitHub's machines.
    testTimeout: 4_800_000,
  },
});
