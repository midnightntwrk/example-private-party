@TODO -- README

# Example Private Party

The Private Party Dapp example allows an organizer to create a private guest list for a party. Party goers are registered privately on-chain and their identities remain private until they arrive to check in to the party. After check in, the party goers identity is revealed.

This example aims to demonstrate basic concepts of Compact and MidnightJS including:
- Hiding information on the public ledger  
- Verifying hidden ledger information  
- Access control to circuits  
- Operations on a `Set`  
- Introduction to witness functions  

MidnightJS:  
- Differences in `deployContract` and `createUnprovenDeployTx`
- Succesful `submitCallTx`
- Rejected `submitCallTx`

## Set up project
```bash
yarn install
```

## Compile the contract
```bash
yarn compile
```

## Start Docker container

Ensure the docker engine is running:
```bash
yarn env:up
```

## Run the test suite
```bash
yarn test:local
```

The test script will begin to display output from your local devnet and test suite. The tests will progress the contract deployment and interaction programatically:
```
[20:28:30.898] INFO (10017): Wallet sync complete after 26 emissions
[20:28:30.905] INFO (10017): Providers initialized. Ready to test.
[20:28:30.906] INFO (10017): Bob providers successfully initialized
[20:28:30.906] INFO (10017): Claire providers successfully initialized
[20:28:30.912] INFO (10017): Deploying a contract the easy way...
[20:28:51.175] INFO (10017): Contract deployed at 97a41286a878b0431bc3a1eeb4f00ae52590e75e9f748f202b67da592a0cca35
[20:28:51.188] INFO (10017): Initial State: maxListSize: 10, partyState: 0
[20:28:51.454] INFO (10017): Adding an organizer...
[20:29:14.687] INFO (10017): New organizer added!
[20:29:14.726] INFO (10017): Alice is adding a participant...
[20:29:38.744] INFO (10017): Bob has added a participant!
[20:29:38.752] INFO (10017): Bob is adding a participant...
[20:30:02.770] INFO (10017): Bob has added a participant!
[20:30:02.780] INFO (10017): Claire (malicious) is trying to add a participant
[20:30:03.049] INFO (10017): Claire was rejected from adding a participant!
[20:30:03.049] INFO (10017): Claire (malicious) is trying to add an organizer...
[20:30:03.074] INFO (10017): Claire was rejected from adding an organizer!
[20:30:03.075] INFO (10017): Claire (malicious) is trying to start the party...
[20:30:03.100] INFO (10017): Claire was rejected from starting the party!
[20:30:03.101] INFO (10017): Starting the party...
[20:30:20.137] INFO (10017): Party started!
[20:30:20.147] INFO (10017): Alice is checking in a participant...
[20:30:38.840] INFO (10017): Alice has checked in a participant!
[20:30:38.851] INFO (10017): Bob is checking in a participant...
[20:31:02.921] INFO (10017): Bob has checked in a participant!
[20:31:02.970] INFO (10017): Unproven tx created. Pending contract address: a045fa116386ec3d20ae1a22f4e3d1dcded1e4d3500c598e85a53323eb11baa2
[20:31:02.970] INFO (10017): proven tx received from proof server
[20:31:03.655] INFO (10017): Balanced tx ready for submission
[20:31:19.207] INFO (10017): Submitted tx id: 00d0372b368600426351e97c3da4da7a82f116867af5ddbb7eb7ec3b0b22710e6e
 ✓ src/test/party.test.ts (11 tests) 172838ms
   ✓ Private Party smart contract via midnight-js > Deploys a contract (the easy way)  20279ms
   ✓ Private Party smart contract via midnight-js > Adds an organizer  23510ms
   ✓ Private Party smart contract via midnight-js > Adds a participant (Alice)  24053ms
   ✓ Private Party smart contract via midnight-js > Adds a participant (Bob)  24027ms
   ✓ Private Party smart contract via midnight-js > Blocks non-organizers from adding participants 269ms
   ✓ Private Party smart contract via midnight-js > Blocks non-organizers from adding organizers 25ms
   ✓ Private Party smart contract via midnight-js > Blocks non-organizers from starting the party 26ms
   ✓ Private Party smart contract via midnight-js > starts the party  17046ms
   ✓ Private Party smart contract via midnight-js > checks in party goers (Alice)  18704ms
   ✓ Private Party smart contract via midnight-js > checks in party goers (Bob)  24097ms
   ✓ Private Party smart contract via midnight-js > Deploys the contract(the hard way) 
```
