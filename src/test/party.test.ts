// This file is part of example-battleship.
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
import { networkId, contracts } from '@midnight-ntwrk/midnight-js';
import type { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { sampleUserAddress } from '@midnight-ntwrk/compact-runtime';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type PartyProviders } from '../providers.js';
import {
    CompiledPartyContract,
    ledger,
    PartyState,
    zkConfigPath
} from '../../contract/index.js';
import { createPartyPrivateState } from '../../contract/witnesses.js'
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';

const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: { target: 'pino-pretty' },
});

describe('Private Party smart contract via midnight-js', () => {
    let aliceWallet: MidnightWalletProvider;
    let bobWallet: MidnightWalletProvider;
    let claireWallet: MidnightWalletProvider;
    let aliceProviders: PartyProviders;
    let bobProviders: PartyProviders;
    let claireProviders: PartyProviders;
    let contractAddress: ContractAddress;


    const config = getConfig();
    // Genesis seed(s) for local dev node — pre-funded with tokens, up to 3
    const seed1 ='0000000000000000000000000000000000000000000000000000000000000001';
    const seed2 = '0000000000000000000000000000000000000000000000000000000000000002';
    const seed3 = '0000000000000000000000000000000000000000000000000000000000000003';
    const ALICE_PRIVATE_ID = 'PartyPrivateState';
    const BOB_PRIVATE_ID = 'BobPartyPrivateState';
    const CLAIRE_PRIVATE_ID = 'ClairePartyPrivateState';

    const partier1 = randomBytes(32);
    const partier2 = randomBytes(32);
    const partier3 = randomBytes(32);

    async function queryLedger(providers: PartyProviders) {
        const state = 
            await providers.publicDataProvider.queryContractState(contractAddress);
        expect(state).not.toBeNull();
        return ledger(state!.data);
    }

    // setup before tests
    beforeAll(async () => {

        networkId.setNetworkId(config.networkId);
        
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

        aliceWallet = await MidnightWalletProvider.build(logger, envConfig, seed1!);
        await aliceWallet.start();
        await syncWallet(logger, aliceWallet.wallet, 600_000);

        bobWallet = await MidnightWalletProvider.build(logger, envConfig, seed2!);
        await bobWallet.start();
        await syncWallet(logger, bobWallet.wallet, 600_000);

        claireWallet = await MidnightWalletProvider.build(logger, envConfig, seed3!);
        await claireWallet.start();
        await syncWallet(logger, claireWallet.wallet, 600_000);

        aliceProviders = buildProviders(aliceWallet, zkConfigPath, config);
        logger.info('Providers initialized. Ready to test.');

        bobProviders = buildProviders(bobWallet, zkConfigPath, config);
        logger.info(`Bob providers successfully initialized`);

        claireProviders = buildProviders(claireWallet, zkConfigPath, config);
        logger.info(`Claire providers successfully initialized`);
    });

    afterAll(async () => {
        if(aliceWallet) {
            logger.info('Stopping wallet...');
            await aliceWallet.stop();
        }
    });
    it('Deploys a contract (the easy way)', async () => {
        const PARTY_SIZE = BigInt(10);
        const aliceAddress = sampleUserAddress();
        const alicePrivateState = createPartyPrivateState(aliceAddress, randomBytes(32));

        logger.info(`Deploying a contract the easy way...`);
        const deployed: any = await (contracts.deployContract as any)(aliceProviders, {
            compiledContract: CompiledPartyContract,
            privateStateId: ALICE_PRIVATE_ID,
            initialPrivateState: alicePrivateState,
            args: [PARTY_SIZE]
        });

        contractAddress = deployed.deployTxData.public.contractAddress;
        logger.info(`Contract deployed at ${contractAddress}`);
        expect(contractAddress).toBeDefined();
        expect(contractAddress.length).toBeGreaterThan(0);

        // verify initial ledger state (constructor execution)
        const state = await queryLedger(aliceProviders);
        expect(state.maxListSize).toEqual(PARTY_SIZE);
        expect(state.partyState).toEqual(PartyState.NOT_READY);
        logger.info(`Initial State: maxListSize: ${state.maxListSize}, partyState: ${state.partyState}`);
    });
    it('Adds an organizer', async () => {
        // bob stuff
        const bobPrivateState = createPartyPrivateState(sampleUserAddress(), randomBytes(32));
        bobProviders.privateStateProvider.setContractAddress(contractAddress)
        await bobProviders.privateStateProvider.set(BOB_PRIVATE_ID, bobPrivateState);

        // need to have type signatures correct in the args because the errors are bad
        logger.info(`Adding an organizer...`);
        const txData1: any = await (contracts.submitCallTx as any)(aliceProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            privateStateId: ALICE_PRIVATE_ID,
            circuitId: 'addOrganizer',
            args: [bobPrivateState.sk]
        });
        logger.info(`New organizer added!`);


        const state = await queryLedger(aliceProviders);
        expect(state.organizers.size()).toEqual(2n);
        expect(state.partyState).toEqual(PartyState.NOT_READY);
    });
    it('Adds a participant (Alice)', async () => {

        // @TODO -- this is how you get the private state value
        // @TODO -- this is not being used here
        const alicePrivateState = await aliceProviders.privateStateProvider.get(ALICE_PRIVATE_ID);
        // alicePrivateState.sk
        logger.info(`Alice is adding a participant...`);
        const txData2: any = await (contracts.submitCallTx as any)(aliceProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            privateStateId: ALICE_PRIVATE_ID,// does this matter?
            circuitId: 'addParticipant',
            args: [partier1],
        });
        logger.info(`Bob has added a participant!`);


        const state = await queryLedger(aliceProviders);
        expect(state.hashedPartyGoers.size()).toEqual(1n);
    });// end of 'Adds a participant (Alice)'
    it('Adds a participant (Bob)', async () => {

        logger.info(`Bob is adding a participant...`);
        const txData2: any = await (contracts.submitCallTx as any)(bobProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            privateStateId: BOB_PRIVATE_ID,// does this matter?
            circuitId: 'addParticipant',
            args: [partier2],
        });
        logger.info(`Bob has added a participant!`);

        const state = await queryLedger(bobProviders);
        expect(state.hashedPartyGoers.size()).toEqual(2n);
    });
    it('Blocks non-organizers from adding participants', async () => {
        
        logger.info(`Claire (malicious) is trying to add a participant`);
        await expect(async () => {
            await (contracts.submitCallTx as any)(claireProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: CLAIRE_PRIVATE_ID,
                circuitId: 'addParticipant',
                args: [partier3]
            })
        }).rejects.toThrow();
        logger.info(`Claire was rejected from adding a participant!`);

    });
    it('Blocks non-organizers from adding organizers', async () => {
        
        logger.info(`Claire (malicious) is trying to add an organizer...`);
        await expect(async () => {
            await (contracts.submitCallTx as any)(claireProviders, {
                compiledContract: CompiledPartyContract,
                contractAddress,
                privateStateId: CLAIRE_PRIVATE_ID,
                circuitId: 'addOrganizer',
                args: [randomBytes(32)]
            })
        }).rejects.toThrow();
        logger.info(`Claire was rejected from adding an organizer!`);

    });
    it('Blocks non-organizers from starting the party', async () => {

        logger.info(`Claire (malicious) is trying to start the party...`);
        await expect(async () => {
            await (contracts.submitCallTx as any)(claireProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            privateStateId: CLAIRE_PRIVATE_ID,
            circuitId: 'chainStartParty',
            args: [],
        });
        }).rejects.toThrow();
        logger.info(`Claire was rejected from starting the party!`);


    });
    it('starts the party', async () => {

        logger.info(`Starting the party...`);
        const txData4: any = await (contracts.submitCallTx as any)(aliceProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            privateStateId: ALICE_PRIVATE_ID,
            circuitId: 'chainStartParty',
            args: [],
        });
        logger.info(`Party started!`);


        const state = await queryLedger(aliceProviders);
        expect(state.partyState).toEqual(PartyState.READY);
        expect(state.checkedInParty.size()).toEqual(0n);
    });
    it('checks in party goers (Alice)', async () => {
        
        logger.info(`Alice is checking in a participant...`);
        const txData5: any = await (contracts.submitCallTx as any)(aliceProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            privateStateId: ALICE_PRIVATE_ID,
            circuitId: 'checkIn',
            args: [partier1]
        });
        logger.info(`Alice has checked in a participant!`);


        const state = await queryLedger(aliceProviders);
        expect(state.partyState).toEqual(PartyState.READY);
        expect(state.checkedInParty.size()).toEqual(1n);
        expect(state.checkedInParty.member(partier1)).toBeTruthy();
    });
    it('checks in party goers (Bob)', async () => {
                
        logger.info(`Bob is checking in a participant...`);
        const txData5: any = await (contracts.submitCallTx as any)(bobProviders, {
            compiledContract: CompiledPartyContract,
            contractAddress,
            privateStateId: BOB_PRIVATE_ID,
            circuitId: 'checkIn',
            args: [partier2]
        });
        logger.info(`Bob has checked in a participant!`);

        const state = await queryLedger(bobProviders);
        expect(state.partyState).toEqual(PartyState.READY);
        expect(state.checkedInParty.size()).toEqual(2n);
        expect(state.checkedInParty.member(partier2)).toBeTruthy();
    });
    it('Deploys the contract(the hard way)', async () => {
        const PARTY_SIZE = BigInt(5);
        const aliceAddress = sampleUserAddress();
        const alicePrivateState = createPartyPrivateState(aliceAddress, randomBytes(32));
    
        // Step 1: Local circuit execution
        const unprovenData: any = await (contracts.createUnprovenDeployTx as any)(aliceProviders, {
            compiledContract: CompiledPartyContract,
            privateStateId: ALICE_PRIVATE_ID,
            initialPrivateState: alicePrivateState,
            args: [PARTY_SIZE]
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