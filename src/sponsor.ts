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
 * DUST fee sponsorship — reference implementation.
 * ------------------------------------------------
 * On Midnight, transaction fees are paid in DUST, and DUST is *generated* by NIGHT
 * that has been registered for DUST generation. It is not transferable. So a wallet
 * holding unregistered NIGHT — or no NIGHT at all — has zero DUST and cannot submit
 * any transaction, even one that moves no funds.
 *
 * Sponsorship lets a second wallet pay that fee without gaining any ability to act
 * on the first wallet's behalf. The split is enforced by `tokenKindsToBalance`:
 *
 *   USER     balances ['shielded', 'unshielded']   — its own value, then signs + binds
 *   SPONSOR  balances ['dust']                     — the fee only, then signs + submits
 *
 * Order matters. The user proves, balances, signs and FINALIZES first. What crosses
 * the wire is a bound `FinalizedTransaction`: the sponsor can add a DUST fee offer to
 * it, and nothing else. The sponsor never sees the user's private circuit inputs,
 * because the user — not the sponsor — generated the proof.
 *
 * The two halves are deliberately split into two functions with a hex string between
 * them. That string is the network boundary: in production `prepareSponsoredCall`
 * runs in the user's browser and `sponsorAndSubmit` runs on the sponsor's server.
 */

import {
  createUnprovenCallTx,
  type CallTxOptionsWithPrivateStateId,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { Contract } from '@midnight-ntwrk/midnight-js-protocol/compact-js/effect/Contract';
import {
  type Binding,
  type Proof,
  type SignatureEnabled,
  Transaction,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex } from '@midnight-ntwrk/midnight-js-utils';
import type { Logger } from 'pino';
import type { PartyProviders } from './providers.js';
import type { MidnightWalletProvider } from './wallet.js';

/**
 * USER SIDE. Runs wherever the user's keys live — a browser wallet, a CLI, a test.
 *
 * Builds the circuit call, proves it, balances only the user's own value side, signs
 * and binds it. Returns hex: an opaque, tamper-evident blob to hand to a sponsor.
 *
 * Note what is NOT here: no DUST, no fee estimation, no sponsor keys. A wallet with
 * zero DUST can run every line of this function.
 */
export async function prepareSponsoredCall<
  C extends Contract.Any,
  PCK extends Contract.ProvableCircuitId<C>,
>(
  logger: Logger,
  user: MidnightWalletProvider,
  providers: PartyProviders,
  call: CallTxOptionsWithPrivateStateId<C, PCK>,
): Promise<string> {
  logger.info(`[user] building ${String(call.circuitId)}()...`);
  const unsubmitted = await createUnprovenCallTx<C, PCK>(providers, call);

  // The USER generates the proof. This is what keeps the sponsor out of the user's
  // private inputs — the secret that authenticates the caller never leaves here.
  logger.info(`[user] proving ${String(call.circuitId)}()...`);
  const unboundTx = await providers.proofProvider.proveTx(unsubmitted.private.unprovenTx);

  // Balance the user's OWN value side only (for checkIn, this pays the entry fee),
  // then sign and bind. After this the transaction is sealed.
  logger.info('[user] balancing own value side (no DUST) and binding...');
  const finalized = await user.balanceOwnValueAndFinalize(unboundTx);

  return toHex(finalized.serialize());
}

/**
 * SPONSOR SIDE. Runs wherever the sponsor's DUST lives — typically a backend service.
 *
 * Takes the user's bound transaction, attaches a DUST fee offer paid by the sponsor,
 * and submits it. The sponsor is a payer, never an author.
 */
export async function sponsorAndSubmit(
  logger: Logger,
  sponsor: MidnightWalletProvider,
  userTxHex: string,
): Promise<string> {
  // The marker triple matches `FinalizedTransaction = Transaction<SignatureEnabled, Proof, Binding>`.
  const userTx = Transaction.deserialize<SignatureEnabled, Proof, Binding>(
    'signature',
    'proof',
    'binding',
    fromHex(userTxHex),
  );

  logger.info('[sponsor] attaching DUST fee offer...');
  const sponsored = await sponsor.addDustFeesAndFinalize(userTx);

  const txId = await sponsor.wallet.submitTransaction(sponsored);
  logger.info(`[sponsor] submitted sponsored tx: ${txId}`);
  return txId;
}
