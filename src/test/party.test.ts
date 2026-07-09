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
import { createUnprovenDeployTx, deployContract, submitCallTx, type DeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type ContractAddress, encodeUserAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet, type WalletSecret } from '../wallet.js';
import { buildProviders, type PartyProviders } from '../providers.js';
import {
    CompiledPartyContract,
    Contract,
    ledger,
    PartyState,
    zkConfigPath
} from '../../contract/index.js';
import { createPartyPrivateState } from '../../contract/witnesses.js'
import { type EnvironmentConfiguration, waitForFunds } from '@midnight-ntwrk/testkit-js';
import type { FinalizedCallTxData, UnsubmittedDeployTxData } from '@midnight-ntwrk/midnight-js-contracts';
import type { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk';

const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: { target: 'pino-pretty' },
});

type Role = 'ALICE' | 'BOB' | 'CHARLIE';

// Genesis seeds for the local dev node — pre-funded, used only on `local`.
const LOCAL_SEEDS: Record<Role, string> = {
    ALICE: '0000000000000000000000000000000000000000000000000000000000000001',
    BOB:   '0000000000000000000000000000000000000000000000000000000000000002',
    CHARLIE:'0000000000000000000000000000000000000000000000000000000000000003',
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

describe(`Private Party smart contract via midnight-js (${network})`, () => {
    let aliceWallet: MidnightWalletProvider;
    let bobWallet: MidnightWalletProvider;
    let charlieWallet: MidnightWalletProvider;
    let aliceProviders: PartyProviders;
    let bobProviders: PartyProviders;
    let charlieProviders: PartyProviders;
    let contractAddress: ContractAddress;

    const config = getConfig();
    const aliceSecret = resolveSecret(network, 'ALICE');
    const bobSecret = resolveSecret(network, 'BOB');
    const charlieSecret = resolveSecret(network, 'CHARLIE');
    const isRemote = network !== 'local';
    const syncTimeoutMs = Number(
        process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ??
            (isRemote ? 60 * 60_000 : 10 * 60_000),
    );

    const ALICE_PRIVATE_ID = 'PartyPrivateState';
    const BOB_PRIVATE_ID = 'BobPartyPrivateState';
    const CHARLIE_PRIVATE_ID = 'CharliePartyPrivateState';

    async function queryLedger(providers: PartyProviders) {
        const state =
            await providers.publicDataProvider.queryContractState(contractAddress);
        expect(state).not.toBeNull();
        return ledger(state!.data);
    }

    // NIGHT token type is the all-zero raw token type
    const NIGHT_TOKEN_TYPE = '0000000000000000000000000000000000000000000000000000000000000000';

    async function getNightBalance(walletProvider: MidnightWalletProvider): Promise<bigint> {
        const facadeState = await walletProvider.wallet.waitForSyncedState();
        return facadeState.unshielded.balances[NIGHT_TOKEN_TYPE] ?? 0n;
    }

    // setup before tests
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

        bobWallet = await MidnightWalletProvider.build(logger, envConfig, bobSecret);
        await bobWallet.start();
        await syncWallet(logger, bobWallet.wallet, syncTimeoutMs);

        charlieWallet = await MidnightWalletProvider.build(logger, envConfig, charlieSecret);
        await charlieWallet.start();
        await syncWallet(logger, charlieWallet.wallet, syncTimeoutMs);

        if (isRemote) {
            // NIGHT→DUST registration per wallet. Seeds are pre-funded; idempotent.
            for (const [name, w] of [
                ['Alice', aliceWallet],
                ['Bob', bobWallet],
                ['Charlie', charlieWallet],
            ] as const) {
                const nightBalance = await waitForFunds(
                    w.wallet,
                    envConfig,
                    false,
                    w.unshieldedKeystore,
                );
                logger.info(`${name} NIGHT balance on '${network}': ${nightBalance}`);
            }
        }

        aliceProviders = buildProviders(aliceWallet, zkConfigPath, config);
        logger.info(`Providers initialized on '${network}'. Ready to test.`);

        bobProviders = buildProviders(bobWallet, zkConfigPath, config);
        logger.info(`Bob providers successfully initialized`);

        charlieProviders = buildProviders(charlieWallet, zkConfigPath, config);
        logger.info(`Charlie providers successfully initialized`);
    });

    afterAll(async () => {
        if(aliceWallet) {
            logger.info('Stopping Alice wallet...');
            await aliceWallet.stop();
        }
        if(bobWallet) {
            logger.info('Stopping Bob wallet...');
            await bobWallet.stop();
        }
        if(charlieWallet) {
            logger.info('Stopping Charlie wallet...');
            await charlieWallet.stop();
        }
    });
    it('Deploys a contract (the easy way)', async () => {
        const PARTY_SIZE = BigInt(10);
        const FEE = BigInt(5);
        const alicePrivateState = createPartyPrivateState(randomBytes(32));

        logger.info(`Deploying a contract the easy way...`);
        const deployed: DeployedContract<Contract> = 
            await (deployContract<Contract>)(aliceProviders, {
                compiledContract: CompiledPartyContract,
                privateStateId: ALICE_PRIVATE_ID,
                initialPrivateState: alicePrivateState,
                args: [PARTY_SIZE, FEE, alicePrivateState.secret]
            });

        contractAddress = deployed.deployTxData.public.contractAddress;
        logger.info(`Contract deployed at ${contractAddress}`);
        expect(contractAddress).toBeDefined();
        expect(contractAddress.length).toBeGreaterThan(0);

        // verify initial ledger state (constructor execution)
        const state = await queryLedger(aliceProviders);
        expect(state.maxListSize).toEqual(PARTY_SIZE);
        expect(state.partyState).toEqual(PartyState.NOT_STARTED);
        expect(state.entryFee).toEqual(FEE);
        expect(state.hashedPartyGoers.size()).toEqual(0n);
    });
    it('Allows Bob to rsvp (privately)', async () => {

        const bobInitialPrivateState = createPartyPrivateState(randomBytes(32));
        bobProviders.privateStateProvider.setContractAddress(contractAddress);
        await bobProviders.privateStateProvider.set(BOB_PRIVATE_ID, bobInitialPrivateState);
        const bobPrivateState = await bobProviders.privateStateProvider.get(BOB_PRIVATE_ID);

        const bobUnshielded = await bobWallet.wallet.unshielded.getAddress();
        const bobAddress = { bytes: new Uint8Array(bobUnshielded.data) };

        logger.info(`Bob is sending an RSVP...`);
        const txData: FinalizedCallTxData<Contract, 'rsvp'> = 
            await (submitCallTx<Contract, 'rsvp'>)(bobProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: BOB_PRIVATE_ID,
                circuitId: 'rsvp',
                args: [bobAddress, bobPrivateState.secret]
            });
        logger.info(`Bob rsvp'd successfully!`);

        // state verification checks here
        const state = await queryLedger(aliceProviders);
        expect(state.hashedPartyGoers.size()).toEqual(1n);
        expect(state.partyState).toEqual(PartyState.NOT_STARTED);
    });
    it('Blocks organizers from rsvp', async () => {

        const aliceUnshielded: UnshieldedAddress = await aliceWallet.wallet.unshielded.getAddress();
        const aliceAddress: Uint8Array = encodeUserAddress(aliceUnshielded.hexString);
        const alicePrivateState = await aliceProviders.privateStateProvider.get(ALICE_PRIVATE_ID);

        logger.info(`Alice tries to rsvp...`);
        await expect(async () => {
            await (submitCallTx<Contract, 'rsvp'>)(aliceProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: ALICE_PRIVATE_ID,
                circuitId: 'rsvp',
                args: [{ bytes: aliceAddress }, alicePrivateState.secret]
            });
        }).rejects.toThrow();
        logger.info(`Alice was rejected!`);
    });
    it('Allows Charlie to rsvp(privately)', async () => {

        const charlieInitialPrivateState = createPartyPrivateState(randomBytes(32));
        charlieProviders.privateStateProvider.setContractAddress(contractAddress);
        await charlieProviders.privateStateProvider.set(CHARLIE_PRIVATE_ID, charlieInitialPrivateState);
        const charliePrivateState = await charlieProviders.privateStateProvider.get(CHARLIE_PRIVATE_ID);

        const charlieUnshielded: UnshieldedAddress = await charlieWallet.wallet.unshielded.getAddress();
        const charlieAddress: Uint8Array = encodeUserAddress(charlieUnshielded.hexString);

        logger.info(`Charlie is attempting to rsvp...`);
        const txData: FinalizedCallTxData<Contract, 'rsvp'> = 
            await (submitCallTx<Contract, 'rsvp'>)(charlieProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: CHARLIE_PRIVATE_ID,
                circuitId: 'rsvp',
                args: [{ bytes: charlieAddress }, charliePrivateState.secret]
            });
        logger.info(`Charlie successfully rsvp'd!`);

        const state = await queryLedger(charlieProviders);
        expect(state.hashedPartyGoers.size()).toEqual(2n);
        expect(state.partyState).toEqual(PartyState.NOT_STARTED);
    });
    it('Blocks non-organizers from starting the party', async () => {

        const bobPrivateState = await bobProviders.privateStateProvider.get(BOB_PRIVATE_ID);

        logger.info(`Bob tries to start the party...`);
        await expect(async () => {
            await (submitCallTx<Contract, 'startParty'>)(bobProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: BOB_PRIVATE_ID,
                circuitId: 'startParty',
                args: [bobPrivateState.secret]
            });
        }).rejects.toThrow();
        logger.info(`Bob was rejected!`);

        const state = await queryLedger(bobProviders);
        expect(state.partyState).toEqual(PartyState.NOT_STARTED);
    });
    it('starts the party', async () => {

        const alicePrivateState = await aliceProviders.privateStateProvider.get(ALICE_PRIVATE_ID);

        logger.info(`Alice starts the party...`);
        const txData: FinalizedCallTxData<Contract, 'startParty'> =
            await (submitCallTx<Contract, 'startParty'>)(aliceProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: ALICE_PRIVATE_ID,
                circuitId: 'startParty',
                args: [alicePrivateState.secret]
            });
        logger.info(`Alice started the party successfully!`);

        const state = await queryLedger(aliceProviders);
        expect(state.partyState).toEqual(PartyState.STARTED);
    });
    it('Allows Bob to check in', async () => {

        const bobUnshielded = await bobWallet.wallet.unshielded.getAddress();
        const bobAddress = { bytes: new Uint8Array(bobUnshielded.data) };
        const bobPrivateState = await bobProviders.privateStateProvider.get(BOB_PRIVATE_ID);
        
        logger.info(`Bob is checking in...`);
        const txData: FinalizedCallTxData<Contract, 'checkIn'> = 
            await (submitCallTx<Contract, 'checkIn'>)(bobProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: BOB_PRIVATE_ID,
                circuitId: 'checkIn',
                args: [bobAddress, bobPrivateState.secret]
            });
        logger.info(`Bob has successfully checked in and is now public!`);

        const state = await queryLedger(bobProviders);
        expect(state.partyState).toEqual(PartyState.STARTED);
        expect(state.checkedInParty.size()).toEqual(1n);
        expect(state.checkedInParty.member(bobAddress)).toBeTruthy();
    });
    it('Blocks non-organizers from closing the doors', async () => {

        const bobPrivateState = await bobProviders.privateStateProvider.get(BOB_PRIVATE_ID);

        logger.info(`Bob is attempting to close the doors...`);
        await expect(async () => {
            await (submitCallTx<Contract, 'closeEntry'>)(bobProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: BOB_PRIVATE_ID,
                circuitId: 'closeEntry',
                args: [bobPrivateState.secret]
            });
        }).rejects.toThrow();
        logger.info(`Bob was rejected!`);

        const state = await queryLedger(bobProviders);
        expect(state.partyState).toEqual(PartyState.STARTED);
    });
    it('Closes the doors to the party', async () => {

        const alicePrivateState = await aliceProviders.privateStateProvider.get(ALICE_PRIVATE_ID);

        logger.info(`Alice is closing the doors...`);
        const txData: FinalizedCallTxData<Contract, 'closeEntry'> =
            await (submitCallTx<Contract, 'closeEntry'>)(aliceProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: ALICE_PRIVATE_ID,
                circuitId: 'closeEntry',
                args: [alicePrivateState.secret]
            });
        logger.info(`Alice has successfully closed the doors!`);

        const state = await queryLedger(aliceProviders);
        expect(state.partyState).toEqual(PartyState.DOORS_CLOSED);
    });
    it('Allows Alice to claimFees', async () => {

        const aliceUnshielded: UnshieldedAddress = await aliceWallet.wallet.unshielded.getAddress();
        const aliceAddress: Uint8Array = encodeUserAddress(aliceUnshielded.hexString);
        const alicePrivateState = await aliceProviders.privateStateProvider.get(ALICE_PRIVATE_ID);

        const balanceBefore = await getNightBalance(aliceWallet);
        logger.info(`Alice NIGHT balance before claimFees: ${balanceBefore}`);

        logger.info(`Alice is claiming fees...`);
        const txData: FinalizedCallTxData<Contract, 'claimFees'> =
            await (submitCallTx<Contract, 'claimFees'>)(aliceProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: ALICE_PRIVATE_ID,
                circuitId: 'claimFees',
                args: [{ bytes: aliceAddress }, alicePrivateState.secret]
            });
        logger.info(`Alice has successfully claimed fees!`);

        const balanceAfter = await getNightBalance(aliceWallet);
        logger.info(`Alice NIGHT balance after claimFees:  ${balanceAfter}`);
        logger.info(`Alice NIGHT balance delta:            ${balanceAfter - balanceBefore}`);

        const state = await queryLedger(aliceProviders);
        expect(state.partyState).toEqual(PartyState.FEES_CLAIMED);
    })
    it('Deploys the contract(the hard way)', async () => {
        const PARTY_SIZE = BigInt(5);
        const FEE = BigInt(10);
        const alicePrivateState = createPartyPrivateState(randomBytes(32));
    
        // Step 1: Local circuit execution
        const unprovenData: UnsubmittedDeployTxData<Contract> = 
            await (createUnprovenDeployTx as any)(aliceProviders, {
                compiledContract: CompiledPartyContract,
                privateStateId: ALICE_PRIVATE_ID,
                initialPrivateState: alicePrivateState,
                args: [PARTY_SIZE, FEE, alicePrivateState.secret]
            });
        
        const pendingAddress = unprovenData.public?.contractAddress;
        logger.info(`Unproven tx created. Pending contract address: ${pendingAddress}`);

        // Step 2: Prove (send to proof server, get ZK proof back)
        const provenTx = await aliceProviders.proofProvider.proveTx(unprovenData.private.unprovenTx);
        logger.info('proven tx received from proof server');

        // Step 3: Balance wallet
        const balancedTx = await aliceProviders.walletProvider.balanceTx(provenTx);
        logger.info('Balanced tx ready for submission');

        // Step 4: Submit (send to network node)
        const txId = await aliceProviders.midnightProvider.submitTx(balancedTx);
        logger.info(`Submitted tx id: ${txId}`);

        // Step 5: Watch for finalized txn
        const finalizedTxData = await aliceProviders.publicDataProvider.watchForTxData(txId);
        logger.info(`Finalized! Status: ${finalizedTxData.status}, block: ${finalizedTxData.blockHeight}`);
    
        // Store private state (normally done inside deployContract)
        aliceProviders.privateStateProvider.setContractAddress(pendingAddress);
        await aliceProviders.privateStateProvider.set(ALICE_PRIVATE_ID, alicePrivateState);

        const contract2Address = pendingAddress;
        logger.info(`Contract2 address: ${contract2Address}`);
        expect(contract2Address).toBeDefined();
        expect(contract2Address.length).toBeGreaterThan(0);
    });
});