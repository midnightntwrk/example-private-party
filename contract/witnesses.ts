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

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { PartyState, type Ledger } from './managed/private-party/contract/index.js';

export type PartyPrivateState = {
    address: string,
    sk: Uint8Array,
}

export const createPartyPrivateState = (address: string, sk: Uint8Array) => ({
    address,
    sk
});

export const witnesses = {
    localStartParty: ({
        privateState
    }: WitnessContext<Ledger, PartyPrivateState>): [
        PartyPrivateState,
        number
    ] => {
        return [privateState, PartyState.READY];
    },
    localSk: ({
        privateState
    }: WitnessContext<Ledger, PartyPrivateState>): [
        PartyPrivateState,
        Uint8Array,
    ] => {
        return [privateState, privateState.sk]
    }
};
