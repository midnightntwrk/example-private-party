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
// // WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// // See the License for the specific language governing permissions and
// // limitations under the License.

// Workaround for an upstream incompatibility between @effect/platform's
// FetchHttpClient (used by @midnight-ntwrk/wallet-sdk-prover-client to talk to
// the proof server) and Node's undici.
//
// When the prover client POSTs a binary proving payload, FetchHttpClient sets
// an explicit `content-length` header. undici then rejects the request with
// `UND_ERR_INVALID_ARG: invalid content-length header` before it ever reaches
// the proof server, surfacing as "Wallet.Proving: Failed to prove transaction".
// Reproduces on both Node 22 (undici 6) and Node 24 (undici 7).
//
// Dropping the explicit content-length lets undici compute it from the body,
// and proving succeeds. We only strip it for binary-body requests so normal
// (text/JSON) requests are untouched.
//
// This is fixed in Undici 7.27.1 -- but there is no Node version that bundles
// this yet, so this workaround will be in place until there is.
//
// Upstream tracking issue:
// https://github.com/midnightntwrk/servicedesk/issues/38

import { fetch as undiciFetch } from 'undici';
globalThis.fetch = undiciFetch as unknown as typeof fetch;