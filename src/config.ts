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

export type NetworkConfig = {
  networkId: string;
  indexer: string;
  indexerWS: string;
  node: string;
  nodeWS: string;
  proofServer: string;
  faucet: string;
};

export const LOCAL_CONFIG: NetworkConfig = {
  networkId: 'undeployed',
  indexer: 'http://localhost:8088/api/v4/graphql',
  indexerWS: 'ws://localhost:8088/api/v4/graphql/ws',
  node: 'http://localhost:9944',
  nodeWS: 'ws://localhost:9944',
  proofServer: 'http://localhost:6300',
  faucet: '',
};


export function getConfig(): NetworkConfig {
  const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
  switch (network) {
    case 'local':
      return LOCAL_CONFIG;
    default:
      throw new Error(`Unknown network: ${network}. Use 'local'.`);
  }
}
