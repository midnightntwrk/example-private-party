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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createUnprovenCallTx, deployContract, submitCallTx, type DeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type EnvironmentConfiguration, waitForFunds } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet, type WalletSecret } from '../wallet.js';
import { buildProviders, type PartyProviders } from '../providers.js';
import { prepareSponsoredCall, sponsorAndSubmit } from '../sponsor.js';
import {
    CompiledPartyContract,
    Contract,
    ledger,
    PartyState,
    zkConfigPath
} from '../../contract/index.js';
import { createPartyPrivateState } from '../../contract/witnesses.js';

const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: { target: 'pino-pretty' },
});

type Role = 'ALICE' | 'DAVE';

// Genesis seeds for the local dev node — pre-funded, used only on `local`.
// Dave is deliberately NOT a genesis seed: he starts with no NIGHT and no DUST,
// and Alice funds him with NIGHT (only) during setup.
const LOCAL_SEEDS: Record<Role, string> = {
    ALICE: '0000000000000000000000000000000000000000000000000000000000000001',
    DAVE:  '000000000000000000000000000000000000000000000000000000000000000d',
};

function resolveSecret(net: string, role: Role): WalletSecret {
    if (net === 'local') return { kind: 'seed', value: LOCAL_SEEDS[role] };

    const upper = net.toUpperCase();
    const mnemonicEnv = `MIDNIGHT_${upper}_${role}_MNEMONIC`;
    const seedEnv = `MIDNIGHT_${upper}_${role}_SEED`;
    const mnemonic = process.env[mnemonicEnv]?.trim().replace(/\s+/g, ' ');
    const seedHex = process.env[seedEnv]?.trim();

    if (mnemonic && seedHex) {
        throw new Error(
            `Set only one of ${mnemonicEnv} or ${seedEnv} (both are defined).`,
        );
    }
    if (mnemonic) {
        return { kind: 'mnemonic', value: mnemonic };
    }
    if (seedHex) {
        if (!/^[0-9a-fA-F]+$/.test(seedHex) || seedHex.length % 2 !== 0) {
            throw new Error(
                `${seedEnv} must be a hex string of even length (no 0x prefix).`,
            );
        }
        return { kind: 'seed', value: seedHex };
    }
    throw new Error(
        `Either ${mnemonicEnv} or ${seedEnv} is required for network '${net}'. ` +
            `Set one in .env.${net} or the shell.`,
    );
}

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

describe(`DUST fee sponsorship — Alice pays Dave's fees (${network})`, () => {
    let aliceWallet: MidnightWalletProvider;
    let daveWallet: MidnightWalletProvider;
    let aliceProviders: PartyProviders;
    let daveProviders: PartyProviders;
    let contractAddress: ContractAddress;
    let daveAddressArg: { bytes: Uint8Array };

    const config = getConfig();
    const aliceSecret = resolveSecret(network, 'ALICE');
    const daveSecret = resolveSecret(network, 'DAVE');
    const isRemote = network !== 'local';
    const syncTimeoutMs = Number(
        process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ??
            (isRemote ? 60 * 60_000 : 10 * 60_000),
    );

    const ALICE_PRIVATE_ID = 'SponsorAlicePrivateState';
    const DAVE_PRIVATE_ID = 'SponsorDavePrivateState';

    const PARTY_SIZE = 10n;
    const FEE = 5n;
    // Comfortably covers the entry fee. Dave only ever needs `FEE`; the surplus
    // just keeps re-runs from needing a top-up every time.
    const DAVE_NIGHT = 1_000n;

    // NIGHT token type is the all-zero raw token type. Redeclared here rather than
    // shared, so this suite stays independent of party.test.ts.
    const NIGHT_TOKEN_TYPE = '0000000000000000000000000000000000000000000000000000000000000000';

    async function queryLedger(providers: PartyProviders) {
        const state =
            await providers.publicDataProvider.queryContractState(contractAddress);
        expect(state).not.toBeNull();
        return ledger(state!.data);
    }

    async function getNightBalance(walletProvider: MidnightWalletProvider): Promise<bigint> {
        const facadeState = await walletProvider.wallet.waitForSyncedState();
        return facadeState.unshielded.balances[NIGHT_TOKEN_TYPE] ?? 0n;
    }

    /**
     * `unshielded.balances` is derived from confirmed coins, so it can dip while a
     * change UTXO is still pending. Poll until it settles before asserting on a delta.
     */
    async function waitForStableNightBalance(
        walletProvider: MidnightWalletProvider,
        attempts = 40,
    ): Promise<bigint> {
        let previous = await getNightBalance(walletProvider);
        let stableFor = 0;
        for (let i = 0; i < attempts; i++) {
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            const current = await getNightBalance(walletProvider);
            stableFor = current === previous ? stableFor + 1 : 0;
            previous = current;
            if (stableFor >= 2) break;
        }
        return previous;
    }

    beforeAll(async () => {
        setNetworkId(config.networkId);

        const envConfig: EnvironmentConfiguration = {
            walletNetworkId: config.networkId,
            networkId: config.networkId,
            indexer: config.indexer,
            indexerWS: config.indexerWS,
            node: config.node,
            nodeWS: config.nodeWS,
            faucet: config.faucet,
            proofServer: config.proofServer,
        };

        aliceWallet = await MidnightWalletProvider.build(logger, envConfig, aliceSecret);
        await aliceWallet.start();
        await syncWallet(logger, aliceWallet.wallet, syncTimeoutMs);

        daveWallet = await MidnightWalletProvider.build(logger, envConfig, daveSecret);
        await daveWallet.start();
        await syncWallet(logger, daveWallet.wallet, syncTimeoutMs);

        if (isRemote) {
            // Alice is the sponsor: she must be registered for DUST generation.
            const aliceNight = await waitForFunds(
                aliceWallet.wallet,
                envConfig,
                false,
                aliceWallet.unshieldedKeystore,
            );
            logger.info(`Alice NIGHT balance on '${network}': ${aliceNight}`);
        }

        // Two different address shapes are in play, so they get two different names:
        //   - `daveUnshielded` is the UnshieldedAddress instance `transferNight` wants
        //   - `daveAddressArg`  is the UserAddress struct every circuit argument wants
        const daveUnshielded = await daveWallet.wallet.unshielded.getAddress();
        daveAddressArg = { bytes: new Uint8Array(daveUnshielded.data) };

        if (!isRemote) {
            // On the local devnet Dave's seed is not a genesis wallet, so Alice funds
            // him. Crucially she sends NIGHT only — DUST cannot be transferred at all.
            const daveNightBefore = await getNightBalance(daveWallet);
            if (daveNightBefore < DAVE_NIGHT) {
                logger.info(`Alice is funding Dave with ${DAVE_NIGHT} NIGHT (entry-fee money only)...`);
                const aliceDustBefore = await aliceWallet.getDustBalance();
                await aliceWallet.transferNight(daveUnshielded, DAVE_NIGHT);

                for (let i = 0; i < 60; i++) {
                    await new Promise((resolve) => setTimeout(resolve, 3_000));
                    if ((await getNightBalance(daveWallet)) > daveNightBefore) break;
                }
                const aliceDustAfter = await aliceWallet.getDustBalance();
                logger.info(
                    `Alice DUST before/after funding Dave: ${aliceDustBefore} -> ${aliceDustAfter}`,
                );
            }
        }

        aliceProviders = buildProviders(aliceWallet, zkConfigPath, config);
        daveProviders = buildProviders(daveWallet, zkConfigPath, config);
        logger.info(`Providers initialized on '${network}'. Ready to test sponsorship.`);

        // A fresh contract, so this suite never depends on party.test.ts's state.
        const alicePrivateState = createPartyPrivateState(randomBytes(32));
        logger.info('Alice is deploying a party contract for the sponsorship demo...');
        const deployed: DeployedContract<Contract> =
            await (deployContract<Contract>)(aliceProviders, {
                compiledContract: CompiledPartyContract,
                privateStateId: ALICE_PRIVATE_ID,
                initialPrivateState: alicePrivateState,
                args: [PARTY_SIZE, FEE, alicePrivateState.secret]
            });
        contractAddress = deployed.deployTxData.public.contractAddress;
        logger.info(`Contract deployed at ${contractAddress}`);

        // Dave's own private state — Alice never sees this secret.
        const davePrivateState = createPartyPrivateState(randomBytes(32));
        daveProviders.privateStateProvider.setContractAddress(contractAddress);
        await daveProviders.privateStateProvider.set(DAVE_PRIVATE_ID, davePrivateState);
    });

    afterAll(async () => {
        if (aliceWallet) {
            logger.info('Stopping Alice wallet...');
            await aliceWallet.stop();
        }
        if (daveWallet) {
            logger.info('Stopping Dave wallet...');
            await daveWallet.stop();
        }
    });

    it('Dave holds NIGHT but has zero DUST', async () => {
        const state = await daveWallet.wallet.waitForSyncedState();

        const night = state.unshielded.balances[NIGHT_TOKEN_TYPE] ?? 0n;
        logger.info(`Dave NIGHT: ${night}`);
        expect(night).toBeGreaterThan(0n);

        // DUST generation is registered per NIGHT public key, and Dave has never
        // registered — so the NIGHT he received generates nothing.
        for (const coin of state.unshielded.availableCoins) {
            expect(coin.meta.registeredForDustGeneration).toBe(false);
        }

        const dust = await daveWallet.getDustBalance();
        logger.info(`Dave DUST: ${dust}`);
        expect(dust).toBe(0n);
        if (dust !== 0n) {
            throw new Error(
                'Dave has DUST — the sponsorship demo requires a wallet with none. ' +
                    `Fund MIDNIGHT_${network.toUpperCase()}_DAVE_SEED with tNIGHT but do not delegate DUST to it.`,
            );
        }
    });

    it("Dave cannot pay for his own RSVP", async () => {
        const davePrivateState = await daveProviders.privateStateProvider.get(DAVE_PRIVATE_ID);

        const unsubmitted = await createUnprovenCallTx<Contract, 'rsvp'>(daveProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            privateStateId: DAVE_PRIVATE_ID,
            circuitId: 'rsvp',
            args: [daveAddressArg, davePrivateState.secret],
        });
        const unboundTx = await daveProviders.proofProvider.proveTx(unsubmitted.private.unprovenTx);

        // The ordinary path balances everything, DUST included. Dave has none, so
        // there is no fee he can offer and balancing cannot succeed.
        logger.info('Dave tries to pay his own fees...');
        await expect(daveWallet.balanceTx(unboundTx)).rejects.toThrow();
        logger.info('Dave was rejected — he has no DUST to pay a fee with.');
    });

    it("Alice sponsors Dave's RSVP", async () => {
        const davePrivateState = await daveProviders.privateStateProvider.get(DAVE_PRIVATE_ID);
        const before = await queryLedger(aliceProviders);

        // USER SIDE — runs with Dave's keys. No DUST anywhere in this call.
        const txHex = await prepareSponsoredCall<Contract, 'rsvp'>(logger, daveWallet, daveProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            circuitId: 'rsvp',
            privateStateId: DAVE_PRIVATE_ID,
            args: [daveAddressArg, davePrivateState.secret],
        });

        // SPONSOR SIDE — runs with Alice's keys, on her DUST.
        const txId = await sponsorAndSubmit(logger, aliceWallet, txHex);
        await aliceProviders.publicDataProvider.watchForTxData(txId);

        const after = await queryLedger(aliceProviders);
        expect(after.hashedPartyGoers.size()).toEqual(before.hashedPartyGoers.size() + 1n);
        expect(after.partyState).toEqual(PartyState.NOT_STARTED);

        // Dave still has no DUST — he never paid a fee.
        expect(await daveWallet.getDustBalance()).toBe(0n);
        logger.info("Dave RSVP'd without ever holding a single unit of DUST.");
    });

    it('Alice starts the party', async () => {
        const alicePrivateState = await aliceProviders.privateStateProvider.get(ALICE_PRIVATE_ID);

        // Alice has DUST of her own, so she needs no sponsor here — this is the
        // ordinary self-paying path, exactly as in party.test.ts.
        await (submitCallTx<Contract, 'startParty'>)(aliceProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            privateStateId: ALICE_PRIVATE_ID,
            circuitId: 'startParty',
            args: [alicePrivateState.secret]
        });

        const state = await queryLedger(aliceProviders);
        expect(state.partyState).toEqual(PartyState.STARTED);
    });

    it('Alice cannot check in as Dave', async () => {
        // Alice pays for every transaction here, and she still cannot act as Dave.
        // `checkIn` recomputes commitAddress(_secret, address.bytes) and requires the
        // result to be on the RSVP list. That commitment binds Dave's SECRET, which
        // Alice does not have — paying the fee confers no authority whatsoever.
        const alicePrivateState = await aliceProviders.privateStateProvider.get(ALICE_PRIVATE_ID);

        logger.info("Alice tries to check in as Dave, using her own secret...");
        await expect(
            createUnprovenCallTx<Contract, 'checkIn'>(aliceProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: ALICE_PRIVATE_ID,
                circuitId: 'checkIn',
                args: [daveAddressArg, alicePrivateState.secret],
            }),
        ).rejects.toThrow(/You are not on the list/);
        logger.info('Alice was rejected — the fee payer is not the authenticated caller.');
    });

    it("Alice sponsors Dave's check-in — Dave pays the entry fee, Alice pays the DUST", async () => {
        const davePrivateState = await daveProviders.privateStateProvider.get(DAVE_PRIVATE_ID);

        const daveNightBefore = await waitForStableNightBalance(daveWallet);
        const daveDustBefore = await daveWallet.getDustBalance();
        const aliceDustBefore = await aliceWallet.getDustBalance();

        const txHex = await prepareSponsoredCall<Contract, 'checkIn'>(logger, daveWallet, daveProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            circuitId: 'checkIn',
            privateStateId: DAVE_PRIVATE_ID,
            args: [daveAddressArg, davePrivateState.secret],
        });
        const txId = await sponsorAndSubmit(logger, aliceWallet, txHex);
        await aliceProviders.publicDataProvider.watchForTxData(txId);

        const daveNightAfter = await waitForStableNightBalance(daveWallet);
        const daveDustAfter = await daveWallet.getDustBalance();
        const aliceDustAfter = await aliceWallet.getDustBalance();

        // Deliberately console.log, not logger.info: pino's pino-pretty transport runs
        // in a worker that vitest tears down at end-of-file, so logs emitted from the
        // last test are lost. This summary is the point of the whole suite — it has to
        // render. vitest captures console output synchronously.
        console.log(
            [
                '',
                '=================== fee sponsorship ===================',
                `  Dave  NIGHT (STAR) : ${daveNightBefore} -> ${daveNightAfter}  (delta ${daveNightAfter - daveNightBefore})`,
                `  Dave  DUST (SPECK) : ${daveDustBefore} -> ${daveDustAfter}`,
                `  Alice DUST (SPECK) : ${aliceDustBefore} -> ${aliceDustAfter}  (delta ${aliceDustAfter - aliceDustBefore})`,
                '  Dave paid the entry fee; Alice paid the transaction fee.',
                '=======================================================',
                '',
            ].join('\n'),
        );

        // The call really executed.
        const state = await queryLedger(aliceProviders);
        expect(state.checkedInParty.member(daveAddressArg)).toBeTruthy();

        // Dave paid for his own ticket...
        expect(daveNightAfter).toEqual(daveNightBefore - FEE);
        // ...but never paid a transaction fee.
        expect(daveDustBefore).toBe(0n);
        expect(daveDustAfter).toBe(0n);
        // Alice did.
        expect(aliceDustAfter).toBeLessThan(aliceDustBefore);
    });
});
