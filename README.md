# Private Party Example

This repository implements a private party DApp that demonstrates the privacy boundary in Midnight DApps. The party goers send an RSVP under a pseudonym and remain anonymous until they arrive at the party. The party has an entry fee and that entry fee is paid in NIGHT -- this is the exact location of the privacy boundary for party goers. The organizer remains anonymous until they claim the fees collected from the entry cost at which time they become public (on-chain).

This example aims to demonstrate several key features of Compact and Midnight JS including:

- The privacy boundary in Compact and Midnight DApps
- Contract syntax for NIGHT deposit and payout
- MidnightJS unshielded address interaction
- MidnightJS balance checks
- MidnightJS manual contract deployment (local, prove, balance, submit, finalize)

## Set up project

```bash
git clone git@github.com:midnightntwrk/example-private-party
```

Install dependencies:  

```bash 
yarn install
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

The output should look like this:

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

This repository is currently only set up to support a local devnet running via Docker. The configurations for other networks and handling of those configs can be set up in `config.ts` and supporting files to enable their operation.
