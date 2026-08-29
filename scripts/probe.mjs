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
const witnesses = { secret: ({ privateState }) => [privateState, privateState.secret] };

const wallet = await buildWallet();
const providers = buildProviders(wallet, { privateStateDir: '.probe-state' });

const compiledContract = CompiledContract.make('probe', probe.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('contracts/managed/probe')
);

const initial = { secret: randomBytes(32) };
logger.info('deploying probe...');
const deployed = await deployContract(providers, {
  compiledContract,
  privateStateId: PS_ID,
  initialPrivateState: initial,
});
logger.info(`deployed at ${deployed.deployTxData.public.contractAddress}`);

for (const [name, args] of [['bump', []], ['mapPut', [randomBytes(32)]]]) {
  try {
    await providers.privateStateProvider.set(PS_ID, initial);
    const t0 = Date.now();
    await deployed.callTx[name](...args);
    console.log(`\n  PASS  ${name} — proved and submitted in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    const root = e?.cause?.message ?? e.message;
    console.log(`\n  FAIL  ${name} — ${String(root).slice(0, 150)}`);
  }
}

await wallet.stop?.();
process.exit(0);
