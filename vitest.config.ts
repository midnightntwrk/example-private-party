import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15 * 60_000,
    hookTimeout: 10 * 60_000,
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    reporters: ['default'],
  },
});
