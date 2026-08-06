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
    // Live networks (preprod/preview) are slow: block finality, proof
    // generation and wallet re-sync after each tx push a single suite well
    // past 8 hours. These ceilings are generous on purpose — a run that is
    // still making progress must never be killed by a vitest timeout.
    testTimeout: isRemote ? 60 * 60_000 : 15 * 60_000,
    // beforeAll syncs three wallets (+ NIGHT→DUST funding) from genesis; give
    // it enough headroom to cover all three sequential syncs on preprod.
    hookTimeout: isRemote ? 12 * 60 * 60_000 : 15 * 60_000,
    env: envFromFile,
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
    // Real-network tests share on-chain state and must run in order.
    sequence: { concurrent: false },
    // Stream logs live during the long run instead of buffering per-test.
    disableConsoleIntercept: true,
  },
});
