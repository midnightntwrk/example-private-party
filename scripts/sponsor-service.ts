// This file is part of example-private-party.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Standalone DUST fee sponsorship service.
 * ----------------------------------------
 * Shows the production shape of sponsorship: the user's client builds, proves,
 * balances and BINDS its own transaction, then POSTs the resulting hex here; this
 * service attaches a DUST fee offer paid from its own wallet and submits.
 *
 * All the sponsorship logic lives in `src/sponsor.ts` — this file is only transport.
 *
 *   GET  /health   -> { status, dust }
 *   POST /sponsor  -> { tx: "<hex>" }  =>  { success: true, txId }
 *
 * ⚠️  DEMO-GRADE. This service sponsors ANY transaction it is handed, from anyone.
 * A real sponsor MUST additionally: authenticate callers, rate-limit them, cap total
 * and per-transaction fee spend, and verify that the transaction actually targets its
 * own contract before paying for it. None of that is implemented here.
 */

import { createServer } from 'node:http';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { getConfig } from '../src/config.js';
import { MidnightWalletProvider, syncWallet } from '../src/wallet.js';
import { sponsorAndSubmit } from '../src/sponsor.js';

// Genesis Alice on the local devnet — she is the party organizer, and the sponsor.
const DEFAULT_SPONSOR_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const MAX_BODY_BYTES = 25 * 1024 * 1024; // proven transactions are large

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const port = Number(process.env['SPONSOR_PORT'] ?? 3001);
const config = getConfig();
setNetworkId(config.networkId);
const envConfig: EnvironmentConfiguration = { walletNetworkId: config.networkId, ...config };

const sponsor = await MidnightWalletProvider.build(logger, envConfig, {
  kind: 'seed',
  value: process.env['MIDNIGHT_SPONSOR_SEED'] ?? DEFAULT_SPONSOR_SEED,
});
await sponsor.start();
await syncWallet(logger, sponsor.wallet, 300_000);

const dust = await sponsor.getDustBalance();
logger.info(`Sponsor DUST balance: ${dust} SPECK`);
if (dust === 0n) {
  logger.warn(
    'Sponsor has ZERO DUST and cannot pay for anything. Its NIGHT must be registered ' +
      'for DUST generation — plain NIGHT is not enough. Run `yarn wait:dust` locally.',
  );
}

function send(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { status: 'ok', dust: (await sponsor.getDustBalance()).toString() });
      return;
    }

    if (req.method === 'POST' && req.url === '/sponsor') {
      let txHex: unknown;
      try {
        ({ tx: txHex } = JSON.parse(await readBody(req)) as { tx?: unknown });
      } catch (err) {
        send(res, 400, { success: false, error: `Invalid request body: ${String(err)}` });
        return;
      }
      if (typeof txHex !== 'string' || !/^[0-9a-fA-F]+$/.test(txHex) || txHex.length % 2 !== 0) {
        send(res, 400, {
          success: false,
          error: "Field 'tx' must be a hex-encoded FinalizedTransaction (no 0x prefix).",
        });
        return;
      }

      try {
        // The one line that matters. Everything else here is plumbing.
        const txId = await sponsorAndSubmit(logger, sponsor, txHex);
        send(res, 200, { success: true, txId });
      } catch (err) {
        logger.error(`Sponsorship failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        send(res, 500, { success: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    send(res, 404, { success: false, error: 'Not found. Try GET /health or POST /sponsor.' });
  })();
});

server.listen(port, () => logger.info(`Sponsor service listening on http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down...`);
    server.close(() => {
      void sponsor.stop().finally(() => process.exit(0));
    });
  });
}
