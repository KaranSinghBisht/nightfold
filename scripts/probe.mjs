// Minimal probe: does ANY circuit call pass /check on this stack?
//
// Nightfold's deploys succeed and /prove works, but every circuit call is
// rejected by the proof server with "bad input". This isolates the variable:
// bump() touches only a Counter, mapPut() touches a Map. If bump passes, the
// stack is fine and the problem is a specific ledger ADT.

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { randomBytes } from 'node:crypto';

import { buildWallet, buildProviders, logger } from '../src/midnight/providers.mjs';
import * as probe from '../contracts/managed/probe/contract/index.js';

const PS_ID = 'probe';
// bump() takes no private input at all — the smallest surface there is.
const witnesses = {};

const wallet = await buildWallet();
const providers = buildProviders(wallet, {
  privateStateDir: '.probe-state',
  zkConfigPath: 'contracts/managed/probe',
});

const compiledContract = CompiledContract.make('probe', probe.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('contracts/managed/probe')
);

logger.info('deploying probe...');
const deployed = await deployContract(providers, {
  compiledContract,
  privateStateId: PS_ID,
  initialPrivateState: {},
});
const address = deployed.deployTxData.public.contractAddress;
logger.info(`probe deployed at ${address}`);

logger.info('calling bump() — the smallest circuit that touches state...');
const t0 = Date.now();
const result = await deployed.callTx.bump();
logger.info(`bump() SUCCEEDED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
logger.info(`tx ${result.public.txId ?? '(no id)'}`);

const state = await providers.publicDataProvider.queryContractState(address);
logger.info(`ledger now: ${probe.ledger(state.data).hits} hit(s)`);
process.exit(0);
