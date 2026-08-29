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
// MUST come from the protocol package's re-export, not '@midnight-ntwrk/compact-js'
// directly. compact-js keys its context with a bare Symbol() rather than
// Symbol.for(), so two copies of the module have different keys and the SDK
// silently fails to find the contract context.
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

import { buildWallet, buildProviders, logger } from './providers.mjs';
import { LOCAL, ZK_CONFIG_PATH as ZK_ASSETS } from './config.mjs';
import * as nightfold from '../../contracts/managed/nightfold/contract/index.js';
// NFV-004, again: this file had its OWN witness bundle, missing four of the
// six the contract requires. The CI check added for that constructed the
// SHARED bundle and passed while this one could not build the contract at all —
// testing the thing next to the thing under test. There is one bundle.
import { witnesses, emptyPrivateState, stage, cards, showHand, bestFive } from '../witnesses.mjs';

const PS_ID = 'nightfold';

// The proof server's 400 body carries the real reason; the SDK surfaces only
// "Bad Request". Set NIGHTFOLD_TRACE=1 to see what it actually said.
if (process.env.NIGHTFOLD_TRACE) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const res = await realFetch(...args);
    if (!res.ok) {
      const body = await res.clone().text();
      console.error(`\n>>> ${res.status} from ${args[0]}\n>>> ${body.slice(0, 800)}\n`);
    }
    return res;
  };
}
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
    CompiledContract.withWitnesses(witnesses),
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
  //
  // RA-012: this harness used to call commitDeal and read holeCommits, neither
  // of which the contract has had since the first audit. It was proving a
  // contract that no longer existed, which made "real ZK validated" mean
  // nothing. It now opens a hand the way the hardened contract requires.
  const board = cards('Ah Kd 7c 3c 9c');
  const boardSalt = randomBytes(32);
  const alice = { seat: 0n, hole: cards('As Kc'), ps: { ...emptyPrivateState(), boardSalt } };
  const bob = { seat: 1n, hole: cards('Qc 5c'), ps: { ...emptyPrivateState(), boardSalt } };

  const pc = nightfold.pureCircuits;
  const deckCommit = randomBytes(32);
  const boardCommit = pc.boardCommitment(board, boardSalt);
  const hole0Commit = pc.holeCommitment(alice.hole, alice.ps.salt);
  const hole1Commit = pc.holeCommitment(bob.hole, bob.ps.salt);
  const seat0Key = pc.seatAuthKey(alice.ps.secret);
  const seat1Key = pc.seatAuthKey(bob.ps.secret);
  // The id binds its own setup, so it cannot be claimed with other content.
  const handId = pc.handIdFor(deckCommit, boardCommit, hole0Commit, hole1Commit, seat0Key, seat1Key);

  logger.info(`board ${showHand(board)}`);

  // openHand proves the deal is possible, so the dealer brings all nine cards
  // and the three salts (NFV-003).
  const dealerPS = {
    ...emptyPrivateState(),
    dealt: [...alice.hole, ...bob.hole, ...board],
    dealSalts: [alice.ps.salt, bob.ps.salt, boardSalt],
  };

  await proved('openHand', providers, deployed, 'openHand', dealerPS,
    handId, deckCommit, boardCommit, hole0Commit, hole1Commit, seat0Key, seat1Key);

  alice.ps = stage(alice.ps, { hole: alice.hole });
  bob.ps = stage(bob.ps, { hole: bob.hole });

  // Bob shows; Alice mucks and reveals nothing.
  const bBest = bestFive(bob.hole, board, (h) => pc.handValue(h));
  bob.ps = stage(bob.ps, { claimed: bBest.hand, pick: bBest.idx });
  await proved('revealHand seat 1', providers, deployed, 'revealHand', bob.ps, handId, bob.seat, board);
  await proved('muckHand seat 0', providers, deployed, 'muckHand', alice.ps, handId, alice.seat);
  await proved('settle', providers, deployed, 'settle', alice.ps, handId);

  // ---- read the ledger back from the indexer ----
  const state = await providers.publicDataProvider.queryContractState(address);
  const l = nightfold.ledger(state.data);
  logger.info(`ledger: ${l.hands.size()} hand, ${l.shownRanks.size()} rank, ` +
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

main().catch((e) => {
  // The SDK wraps failures several layers deep; the useful message is usually
  // at the bottom of the cause chain, not the top.
  let err = e, depth = 0;
  while (err && depth < 6) {
    console.error(`\n[cause ${depth}] ${err.constructor?.name}: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
    err = err.cause; depth++;
  }
  process.exit(1);
});
