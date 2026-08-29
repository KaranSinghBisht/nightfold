// Plays a hand of Nightfold on a real local devnet with real ZK proofs.
//
// Everything else in this repo runs the circuit logic in JavaScript. This is
// the only harness that actually proves: each call goes to the Docker proof
// server, lands in a block, and is read back from the indexer.
//
// It exists because the failures that matter only appear here — proving-time
// alignment errors, indexer panics on historic reads, and the real cost of a
// transaction. Simulator green means the logic is right, not that it works.

import { randomBytes } from 'node:crypto';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

import { buildWallet, buildProviders, logger } from './providers.mjs';
import { LOCAL, ZK_CONFIG_PATH as ZK_ASSETS } from './config.mjs';
import * as nightfold from '../../contracts/managed/nightfold/contract/index.js';
import { emptyPrivateState, stage, cards, showHand, bestFive } from '../witnesses.mjs';

const PS_ID = 'nightfold';
const timings = [];

/** Stage this player's private state, then run the circuit with a real proof. */
async function proved(label, providers, deployed, circuit, ps, ...args) {
  await providers.privateStateProvider.set(PS_ID, ps);
  const t0 = Date.now();
  const tx = await deployed.callTx[circuit](...args);
  const secs = (Date.now() - t0) / 1000;
  timings.push({ label, secs, tx: tx.public?.txHash?.slice(0, 18) ?? '' });
  logger.info(`  ${label} proved + submitted in ${secs.toFixed(1)}s`);
  return tx;
}

async function main() {
  const wallet = await buildWallet();
  const providers = buildProviders(wallet, { env: LOCAL });

  // midnight-js 4.x wants a CompiledContract: the generated constructor, the
  // witnesses, and the path to the compiled assets, bound together.
  const compiledContract = CompiledContract.make('nightfold', nightfold.Contract).pipe(
    CompiledContract.withWitnesses(witnessBundle()),
    CompiledContract.withCompiledFileAssets(ZK_ASSETS)
  );

  logger.info('deploying nightfold...');
  const t0 = Date.now();
  const deployed = await deployContract(providers, {
    compiledContract,
    privateStateId: PS_ID,
    initialPrivateState: emptyPrivateState(),
  });
  const deploySecs = (Date.now() - t0) / 1000;
  const address = deployed.deployTxData.public.contractAddress;
  logger.info(`deployed in ${deploySecs.toFixed(1)}s at ${address}`);

  // ---- one hand, on chain ----
  const handId = randomBytes(32);
  const board = cards('Ah Kd 7c 3c 9c');
  const alice = { seat: 0n, hole: cards('As Kc'), ps: emptyPrivateState() };
  const bob = { seat: 1n, hole: cards('Qc 5c'), ps: emptyPrivateState() };

  logger.info(`board ${showHand(board)}`);

  for (const p of [alice, bob]) {
    p.ps = stage(p.ps, { hole: p.hole });
    await proved(`commitDeal seat ${p.seat}`, providers, deployed, 'commitDeal', p.ps, handId, p.seat);
  }

  // Bob shows; Alice mucks and reveals nothing.
  const bBest = bestFive(bob.hole, board, (h) => nightfold.pureCircuits.handValue(h));
  bob.ps = stage(bob.ps, { claimed: bBest.hand, pick: bBest.idx });
  await proved('revealHand seat 1', providers, deployed, 'revealHand', bob.ps, handId, bob.seat, board);
  await proved('muckHand seat 0', providers, deployed, 'muckHand', alice.ps, handId, alice.seat);
  await proved('settle', providers, deployed, 'settle', alice.ps, handId);

  // ---- read the ledger back from the indexer ----
  const state = await providers.publicDataProvider.queryContractState(address);
  const l = nightfold.ledger(state.data);
  logger.info(`ledger: ${l.holeCommits.size()} commitments, ${l.shownRanks.size()} rank, ` +
              `${l.muckedSeats.size()} muck, ${l.settledHands.size()} settled`);

  console.log('\n  real proving times on a local devnet');
  console.log('  ' + '-'.repeat(46));
  console.log(`  ${'deploy'.padEnd(24)} ${deploySecs.toFixed(1).padStart(7)}s`);
  for (const t of timings) console.log(`  ${t.label.padEnd(24)} ${t.secs.toFixed(1).padStart(7)}s`);
  const total = timings.reduce((a, b) => a + b.secs, 0);
  console.log('  ' + '-'.repeat(46));
  console.log(`  ${'hand total'.padEnd(24)} ${total.toFixed(1).padStart(7)}s  (${timings.length} transactions)`);

  await wallet.stop?.();
  process.exit(0);
}

/** Witnesses read the staged private state the provider holds. */
function witnessBundle() {
  return {
    holeCards: ({ privateState }) => [privateState, privateState.hole],
    holeSalt: ({ privateState }) => [privateState, privateState.salt],
    claimedHand: ({ privateState }) => [privateState, privateState.claimed],
    handPick: ({ privateState }) => [privateState, privateState.pick],
  };
}

main().catch((e) => {
  logger.error(e?.message ?? e);
  if (e?.stack) console.error(e.stack.split('\n').slice(0, 12).join('\n'));
  process.exit(1);
});
