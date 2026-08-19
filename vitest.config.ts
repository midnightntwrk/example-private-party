import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';

// For remote networks, source secrets (e.g. MIDNIGHT_PREVIEW_ALICE_SEED) from
// .env.<network> so they don't need to be passed on the command line.
// Shell env still wins over file values.
const envFromFile = isRemote ? loadEnv(network, process.cwd(), '') : {};

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15 * 60_000,
    hookTimeout: isRemote ? 90 * 60_000 : 15 * 60_000,
    env: envFromFile,
    include: ['src/**/*.test.ts'],
    // Two suites share one devnet and one Alice wallet. Vitest runs test files in
    // parallel by default, and concurrent spends of the same UTXOs produce
    // nondeterministic balancing failures. Keep the whole run sequential.
    fileParallelism: false,
    reporters: ['default'],
  },
});
