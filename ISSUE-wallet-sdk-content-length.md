# [Bug]: Wallet SDK proving fails with `UND_ERR_INVALID_ARG: invalid content-length header` (proof-server request never sent)

> Target repo: `midnightntwrk/servicedesk` — Bug Report template
> This report follows the [AI reporting guidelines](https://github.com/midnightntwrk/servicedesk/blob/main/ai-reports.md): it includes the branch/commit tested, exact versions, file/line references, a runnable verified test, expected/actual, and full logs.

## Component
App/SDK — Wallet SDK (midnight-wallet)

## Network
Not applicable (local devnet / `undeployed`)

## Severity
P3 Medium — Feature degraded, workaround available, non-critical bug.
(Blocks **all** transaction proving via the wallet SDK in this dependency configuration, but a client-side workaround exists — see below.)

## First seen where?
Internal test / QA

## Bug Description
When the Wallet SDK proves a transaction, `@midnight-ntwrk/wallet-sdk-prover-client`'s `HttpProverClient` (built on `@effect/platform`'s `FetchHttpClient`) POSTs the binary proving payload to the proof server. `FetchHttpClient` sets an explicit `content-length` request header. Node's `fetch` (undici) then rejects the request with `TypeError: fetch failed` / `cause: UND_ERR_INVALID_ARG: invalid content-length header` **before the request is ever sent** — the proof server logs show no `/prove` request arriving.

The failure surfaces to the application as the heavily-wrapped:

```
Wallet.Proving: Failed to prove transaction
```

…with the real cause buried three layers deep (`ProvingError` → `ClientError` → WASM-stringified `RequestError`).

Reproduces on **both Node 22 (undici 6.24.1) and Node 24 (undici 7.24.4)**.

## Expected Behavior
`wallet.balanceUnboundTransaction(...)` / the proving step should POST the payload to the proof server and return a proven transaction. The proof server is healthy and accepts the request when it actually receives it (a manual `curl`/`fetch` POST to `/prove` reaches the server and returns HTTP 400 only because of a deliberately-bad payload).

## Actual Behavior
`fetch` throws at request-construction time and the payload never leaves the process:

```
TypeError: fetch failed
  cause: UND_ERR_INVALID_ARG: invalid content-length header
```

Captured request (via a `globalThis.fetch` interceptor) at the moment of failure:

```
POST http://localhost:6300/prove   duplex=undefined
body: Uint8Array length=1487 byteLength=1487 byteOffset=0 buffer=ArrayBuffer(1487)
headers: {
  "content-type": "application/octet-stream",
  "content-length": "1487",
  "b3": "…-…-1",
  "traceparent": "00-…-…-01"
}
```

The `content-length` value (`"1487"`) matches the body length exactly, yet undici rejects it.

## Steps to Reproduce
**Verified, runnable reproduction (the full project test):**

1. Clone `git@github.com:midnightntwrk/example-private-party.git`, branch `tutorial`.
2. Use the dependency set below (`midnight-js-*@4.1.1`, `testkit-js@4.1.1`, `@midnight-ntwrk/wallet-sdk@1.0.0`; this resolves `wallet-sdk-prover-client@1.2.2`, `@effect/platform@0.96.1`, `effect@3.21.2`, `ledger-v8@8.1.0`), `yarn install`.
3. Start a local devnet incl. the proof server (`yarn env:up`; `proof-server:8.0.3`).
4. Run `MIDNIGHT_NETWORK=local yarn test`.
5. **Observed:** 9/10 tests fail. The deploy test fails at proving (~85 ms, client-side) with `Wallet.Proving: Failed to prove transaction`; the rest cascade (`contractAddress` never set → `Input string must have non-zero length`).

**Confirmed fix / workaround (proves the root cause):** install a `globalThis.fetch` shim that deletes the `content-length` header for binary-body requests, letting undici recompute it. With the shim in place, **all 10 tests pass on Node 24** (verified on the `4.1.1` dependency set above), and an in-process retry of the exact failing request with `content-length` removed returns **HTTP 200** and the deploy succeeds.

```ts
// vitest setupFiles shim — strips content-length so undici recomputes it
const realFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const body = init?.body;
  const isBinary = body != null && (body instanceof Uint8Array || ArrayBuffer.isView(body));
  if (isBinary && init?.headers) {
    const headers = new Headers(init.headers);
    if (headers.has('content-length')) {
      headers.delete('content-length');
      return realFetch(input, { ...init, headers });
    }
  }
  return realFetch(input, init);
};
```

**Note on isolation:** a *minimal* standalone script using `@effect/platform` `FetchHttpClient` + `HttpClientRequest.bodyUint8Array(new Uint8Array(1487))` posting to a throwaway server does **not** reproduce (succeeds on both `@effect/platform@0.95.0` and `0.96.1`). The trigger therefore appears to depend on process state established during the full wallet proving flow (it is reliably reproducible there). This is itself a useful diagnostic clue and is included for honesty.

## File / Line References (installed packages)
- `@midnight-ntwrk/wallet-sdk-prover-client@1.2.2` — `dist/effect/HttpProverClient.js:59` — `RequestError` → `new ClientError({ message: 'Failed to connect to Proof Server: ' + err.message })`; `proveTransaction` wraps it as `Failed to prove transaction`.
- `@effect/platform@0.96.1` (nested under `wallet-sdk-prover-client`) — `dist/cjs/internal/httpClientRequest.js:171` — `headers = Headers.set(headers, "content-length", contentLength.toString())` (sets the rejected header).
- `@effect/platform@0.96.1` — `dist/cjs/internal/httpBody.js:83-84` — `get contentLength() { return this.body.length; }`.
- `@effect/platform@0.96.1` — `dist/cjs/internal/fetchHttpClient.js:20-34` — merges `request.headers` into the `fetch(url, {...})` init.
- `@midnight-ntwrk/wallet-sdk-capabilities` — `dist/proving/provingService.js:29-30` — outer `ProvingError` wrap.

## Logs and Error Messages
```
(FiberFailure) Wallet.Proving: Failed to prove transaction
  [cause]: ClientError: Failed to prove transaction
    [cause]: Error: 'prove' returned an error: (FiberFailure) ClientError: Failed to connect to Proof Server: Transport error (POST http://localhost:6300/prove)
        at Object.RequestError (…/@midnight-ntwrk/wallet-sdk-prover-client/dist/effect/HttpProverClient.js:59:36)
        at __wbg_Error_… (…/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_bg.js:9728:17)
        at wasm://wasm/…

Underlying fetch error (captured via globalThis.fetch interceptor):
  TypeError: fetch failed
    cause: UND_ERR_INVALID_ARG: invalid content-length header
```

## Operating System
Ubuntu 24.04.4 LTS (WSL2, kernel 6.6.87.2-microsoft-standard-WSL2)

## SDK Version
Direct deps: `@midnight-ntwrk/midnight-js-*@4.1.1` (protocol, contracts, http-client-proof-provider, indexer-public-data-provider, level-private-state-provider, node-zk-config-provider), `@midnight-ntwrk/testkit-js@4.1.1`, `@midnight-ntwrk/wallet-sdk@1.0.0`.

Resolved (the actual failing component): `@midnight-ntwrk/wallet-sdk-prover-client@1.2.2` (via `@midnight-ntwrk/wallet-sdk-facade@4.0.1`), `@effect/platform@0.96.1` (nested under prover-client) / `0.95.0` (top-level), `effect@3.21.2`, `@midnight-ntwrk/ledger-v8@8.1.0`.

## Build Environment
Native (yarn / vitest) for the test; Docker Compose for the proof server (`midnightntwrk/proof-server:8.0.3`).

## Language Context
TypeScript / JavaScript

## Additional Context
- **JavaScript runtime** (not midnight-node): reproduced on Node.js `v24.15.0` (undici 7.24.4) **and** `v22.22.3` (undici 6.24.1).
- example-private-party branch `tutorial`, base commit `2c43bd712309063061685f0a088f5fd24adbf9f0` **plus uncommitted working-tree changes** that bump the dependency set to the `4.1.1` line (`package.json`/`yarn.lock`). Re-verified against this `4.1.1` set: deploy still fails at proving (~85 ms, client-side) without the fetch shim, and all 10 tests pass with it.
- Proof server is healthy and reachable; failure is entirely client-side at `fetch` request construction.
- Suggested upstream fix: have `FetchHttpClient` / the prover client **not** set an explicit `content-length` header for `Uint8Array`/binary bodies (undici computes it correctly), or verify the header value passes undici's validation for the request shapes the prover produces.

## Pre-submission checklist
- [x] Searched existing issues for duplicates
- [x] Provided enough information to reproduce
- [x] Not a security vulnerability
- [ ] Using a supported version of the software (Node 24 is above the project's `engines: node >=22`; bug also reproduces on Node 22)
