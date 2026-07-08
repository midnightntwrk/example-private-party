# Private Party Example

This repository implements a private party DApp that demonstrates the privacy boundary in Midnight DApps. The party goers send an RSVP under a pseudonym and remain anonymous until they arrive at the party. The party has an entry fee and that entry fee is paid in NIGHT -- this is the exact location of the privacy boundary for party goers. The organizer remains anonymous until they claim the fees collected from the entry cost at which time they become public (on-chain).

This example aims to demonstrate several key features of Compact and Midnight JS including:

- The privacy boundary in Compact and Midnight DApps
- Contract syntax for NIGHT deposit and payout
- MidnightJS unshielded address interaction
- MidnightJS balance checks
- MidnightJS manual contract deployment (local, prove, balance, submit, finalize)

This repository is part of the tutorial flow in the Midnight documentation. Instructions below will complete the repository.

## Set up project

```bash
git clone git@github.com:midnightntwrk/example-private-party
```

Install dependencies:  

```bash 
yarn install
```

Create the contract file:
```bash
cd contract && touch private-party.compact
```

Populate the contract file:
```
pragma language_version 0.23;
import CompactStandardLibrary;

export enum PartyState {
    NOT_STARTED,
    READY,
    STARTED,
    DOORS_CLOSED,
    FEES_CLAIMED
}

export sealed ledger organizer: Bytes<32>;
export sealed ledger maxListSize: Uint<16>;
export sealed ledger entryFee: Uint<16>;
export ledger partyState: PartyState;
export ledger hashedPartyGoers: Set<Bytes<32>>;
export ledger checkedInParty: Set<UserAddress>;

constructor (partySize: Uint<16>, fee: Uint<16>, _secret: Bytes<32>) {
    assert(partySize > 0, "The party size must be greater than zero");
    assert(fee > 0, "Fee must be greater than zero");

    const pubKey = getDappPublicKey(_secret);
    organizer = disclose(pubKey);

    entryFee = disclose(fee);
    maxListSize = disclose(partySize);
    partyState = PartyState.NOT_STARTED;
}

// called by party goers
export circuit rsvp(_address: UserAddress, _secret: Bytes<32>): [] {
    const pubKey = getDappPublicKey(_secret);
    // caller authentication check
    assert(pubKey != organizer, "Organizer cannot RSVP to the party");

    // state verification check
    assert(partyState == PartyState.NOT_STARTED, "The party has already started");
    assert(hashedPartyGoers.size() < maxListSize, "The list is full");

    // party goer address remains private
    const commitHash = commitAddress(_secret, _address.bytes);
    assert(!hashedPartyGoers.member(commitHash), "You are already on the list");
    hashedPartyGoers.insert(commitHash);// doesn't need disclose bc persistentCommit

    if (hashedPartyGoers.size() == maxListSize) {
        // @TODO -- In the future, emit an event to the organizer here (MIP-0002)
        partyState = PartyState.READY;
    }
}

// start the party (organizer)
export circuit startParty(_secret: Bytes<32>): [] {
    const pubKey = getDappPublicKey(_secret);
    assert(organizer == pubKey, "Only the organizer can start the party");
    assert(partyState == PartyState.READY || partyState == PartyState.NOT_STARTED, 
        "The party is not in the correct state for this operation");

    partyState = PartyState.STARTED;
}

// called by the party goer, so the payment can be prompted to the caller
// after the execution of this circuit, party goers are public
export circuit checkIn(address: UserAddress, _secret: Bytes<32>): [] {
    // state verification checks
    assert(partyState == PartyState.STARTED, "The party has not been started. Call the party police");
    assert(checkedInParty.size() < hashedPartyGoers.size(), "All guests have already checked in");

    const commitHash = commitAddress(_secret, address.bytes);

    // caller verification checks
    assert(hashedPartyGoers.member(commitHash), "You are not on the list");
    assert(!checkedInParty.member(disclose(address)), "You have already checked in");
   
    // take in unshielded payment, party goers are now public
    receiveUnshielded(nativeToken(), entryFee as Uint<128>);
    checkedInParty.insert(disclose(address));

    if(checkedInParty.size() == maxListSize) {
        partyState = PartyState.DOORS_CLOSED;
    }
}

export circuit closeEntry(_secret: Bytes<32>): [] {
    const pubKey = getDappPublicKey(_secret);
    assert(organizer == pubKey, "Only organizer can close the doors");
    assert(partyState == PartyState.STARTED, "Party in wrong state");

    partyState = PartyState.DOORS_CLOSED;
}

export circuit claimFees(address: UserAddress, _secret: Bytes<32>): [] {
    const pubKey = getDappPublicKey(_secret);
    assert(organizer == pubKey, "You are not the organizer");

    // state verification checks
    assert(partyState == PartyState.DOORS_CLOSED, "The doors are not yet closed");
    assert(checkedInParty.size() > 0, "No fees to claim");

    // calculate contract balance of NIGHT tokens
    const totalCollected = checkedInParty.size() * entryFee;
    assert(unshieldedBalanceGte(nativeToken(), totalCollected), "Contract balance wrong");

    // send to organizer, they are now public
    sendUnshielded(
        nativeToken(),
        disclose(totalCollected) as Uint<128>,
        right<ContractAddress, UserAddress>(disclose(address))
    );
    partyState = PartyState.FEES_CLAIMED;
}

circuit commitAddress(_address: Bytes<32>, _secret: Bytes<32>): Bytes<32> {
    return persistentCommit<Bytes<32>>(_address, _secret);
}

// hash a publicKey specific to this DApp so that users cannot be tracked
// the _secret should be a highly complex one
circuit getDappPublicKey(_secret: Bytes<32>): Bytes<32> {
    return persistentHash<Vector<2, Bytes<32>>>([pad(32, "private-party:pk:"), _secret]);
}
```

## Compile the contract

```bash
yarn compile
```

## Start Docker container

```bash
yarn env:up
```

## Run the test suite

```bash
yarn test:local
```

The test script will begin to display output from your local devnet and test suite. The tests will progress the contract deployment and interaction programmatically:
```
[19:24:30.625] INFO (16883): Wallet sync [47]: shielded=true, unshielded=true, dust=true
[19:24:30.625] INFO (16883): Wallet sync complete after 47 emissions
[19:24:30.628] INFO (16883): Providers initialized. Ready to test.
[19:24:30.629] INFO (16883): Bob providers successfully initialized
[19:24:30.629] INFO (16883): Claire providers successfully initialized
[19:24:30.630] INFO (16883): Deploying a contract the easy way...
[19:24:50.702] INFO (16883): Contract deployed at e6937e30874b075e4bc693f7e23791b308c4d4eb2de8a86e644ea0a1cbe8e996
[19:24:50.805] INFO (16883): Bob is sending an RSVP...
[19:25:07.918] INFO (16883): Bob rsvp'd successfully!
[19:25:07.926] INFO (16883): Alice tries to rsvp...
[19:25:07.949] INFO (16883): Alice was rejected!
[19:25:08.037] INFO (16883): Claire is attempting to rsvp...
[19:25:25.976] INFO (16883): Claire successfully rsvp'd!
[19:25:25.982] INFO (16883): Bob tries to start the party...
[19:25:26.004] INFO (16883): Bob was rejected!
[19:25:26.009] INFO (16883): Alice starts the party...
[19:25:43.999] INFO (16883): Alice started the party successfully!
[19:25:44.006] INFO (16883): Bob is checking in...
[19:26:02.719] INFO (16883): Bob has successfully checked in and is now public!
[19:26:02.726] INFO (16883): Bob is attempting to close the doors...
[19:26:02.750] INFO (16883): Bob was rejected!
[19:26:02.756] INFO (16883): Alice is closing the doors...
[19:26:20.796] INFO (16883): Alice has successfully closed the doors!
[19:26:20.807] INFO (16883): Alice NIGHT balance before claimFees: 250000000000055
[19:26:20.807] INFO (16883): Alice is claiming fees...
[19:26:38.811] INFO (16883): Alice has successfully claimed fees!
[19:26:47.349] INFO (16883): Alice NIGHT balance after claimFees:  250000000000060
[19:26:47.349] INFO (16883): Alice NIGHT balance delta:            5
[19:26:47.373] INFO (16883): Unproven tx created. Pending contract address: 683870f23a626fbb90493e238afbb156711753a886f3a63dbf2497e21d6840e7
[19:26:47.373] INFO (16883): proven tx received from proof server
[19:26:47.791] INFO (16883): Balanced tx ready for submission
[19:27:07.893] INFO (16883): Submitted tx id: 00e232030e6183c74e83c0342d02ea4a9d9a12a1094473fc29fba33a638ef2af98
 ✓ src/test/party.test.ts (11 tests) 173684ms
   ✓ Private Party smart contract via midnight-js > Deploys a contract (the easy way)  22072ms
   ✓ Private Party smart contract via midnight-js > Allows Bob to rsvp (privately)  17211ms
   ✓ Private Party smart contract via midnight-js > Blocks organizers from rsvp 25ms
   ✓ Private Party smart contract via midnight-js > Allows Claire to rsvp(privately)  20028ms
   ✓ Private Party smart contract via midnight-js > Blocks non-organizers from starting the party 27ms
   ✓ Private Party smart contract via midnight-js > starts the party  20022ms
   ✓ Private Party smart contract via midnight-js > Allows Bob to check in  18721ms
   ✓ Private Party smart contract via midnight-js > Blocks non-organizers from closing the doors 30ms
   ✓ Private Party smart contract via midnight-js > Closes the doors to the party  20039ms
   ✓ Private Party smart contract via midnight-js > Allows Alice to claimFees  28580ms
   ✓ Private Party smart contract via midnight-js > Deploys the contract(the hard way)  23555ms
```

To run the zkir linter, from the project root run:
```bash
npx compact-zkir-lint -r contract/managed/private-party/zkir
```

Successful output:
```bash
zkir-lint: scanned 5 file(s)

  checkIn (v2, k=11): clean
    instructions: 260  inputs: 2  constrain_bits: 4  cond_select: 6
    guarded regions: 0 (max depth 0)  proof payload: ~96KB

  claimFees (v2, k=11): clean
    instructions: 305  inputs: 2  constrain_bits: 4  cond_select: 2
    guarded regions: 0 (max depth 0)  proof payload: ~96KB

  closeEntry (v2, k=11): clean
    instructions: 65  inputs: 0  constrain_bits: 2  cond_select: 1
    guarded regions: 0 (max depth 0)  proof payload: ~96KB

  rsvp (v2, k=12): clean
    instructions: 181  inputs: 2  constrain_bits: 4  cond_select: 7
    guarded regions: 0 (max depth 0)  proof payload: ~192KB

  startParty (v2, k=11): clean
    instructions: 86  inputs: 0  constrain_bits: 2  cond_select: 8
    guarded regions: 0 (max depth 1)  proof payload: ~96KB

0 error(s), 0 warning(s), 0 info(s) | 5/5 clean
```

## Deploy to Live Testnet

The test suite uses three wallets (Alice, Bob, Claire). On the local devnet, all three are pre-funded genesis wallets. On a live testnet you must supply and fund three distinct wallets — one per role.

To run this test script on Preview or Preprod:
1. Generate three wallets on the given network and fund each manually via the network's faucet page — [Preview](https://midnight-tmnight-preview.nethermind.dev/) or [Preprod](https://midnight-tmnight-preprod.nethermind.dev/). The faucet is a human-facing web page (no programmatic drip endpoint), so the test suite assumes each seed you supply is already funded with tNIGHT. tDUST can be delegated in 1AM or Lace Carbon (coming soon). See [Environments and endpoints](https://docs.midnight.network/relnotes/network) for reference.
1. Create `.env.<network>` and populate it based on `.env.<network>.example` in this repository. Each role (`ALICE`, `BOB`, `CLAIRE`) needs ONE of `MIDNIGHT_<NETWORK>_<ROLE>_MNEMONIC` or `MIDNIGHT_<NETWORK>_<ROLE>_SEED`.
1. Start the proof server: `yarn proof:up`
1. Start the test: `yarn test:preview` or `yarn test:preprod` — each wallet will sync to the network, register NIGHT→DUST if needed, and the test suite will advance programmatically.
