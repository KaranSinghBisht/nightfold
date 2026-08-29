// Independent Compact remediation verification. Audit evidence only.
import * as rt from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  pureCircuits,
} from '../../../contracts/managed/nightfold-tc/contract/index.js';
import {
  call,
  dealHand,
  emptyPS,
  newTable,
  stage,
} from '../../../src/testkit.mjs';
import { cards } from '../../../src/witnesses.mjs';

const ADDRESS = rt.sampleContractAddress();
const COIN_PK = '0'.repeat(64);
const hv = (hand) => pureCircuits.handValue(hand);

// The per-seat distinctness checks do not establish one 52-card deck. A card
// can still occur in both players' private hands and both proofs are accepted.
{
  const table = newTable(Contract);
  const board = cards('2s 3d 4h 5c 9d');
  const seat0 = cards('As Kc');
  const seat1 = cards('As Qc'); // the same ace of spades is dealt twice
  const hand = dealHand(table, pureCircuits, { board, hole0: seat0, hole1: seat1 });

  const rank0 = call(table, 'revealHand', stage(hand.seats[0], seat0, board, hv), hand.handId, 0n, board);
  const rank1 = call(table, 'revealHand', stage(hand.seats[1], seat1, board, hv), hand.handId, 1n, board);
  const winner = call(table, 'settle', emptyPS(), hand.handId);

  console.log(
    'VULNERABLE  cross-seat duplicate card settles successfully',
    `— ranks ${rank0}/${rank1}, winner ${winner}`,
  );
}

// The real-proof harness omits both witness functions below. CI constructs a
// different, complete witness object, so its artifact check cannot catch this.
{
  const complete = newTable(Contract);
  const board = cards('Ah Kd 7c 3c 9c');
  const seat0 = cards('As Kc');
  const seat1 = cards('Qc 5c');
  const hand = dealHand(complete, pureCircuits, { board, hole0: seat0, hole1: seat1 });
  const setup = ledger(complete.state).hands.lookup(hand.handId);

  const harnessWitnesses = {
    holeCards: ({ privateState }) => [privateState, privateState.hole],
    holeSalt: ({ privateState }) => [privateState, privateState.salt],
    claimedHand: ({ privateState }) => [privateState, privateState.claimed],
    handPick: ({ privateState }) => [privateState, privateState.pick],
    // seatSecret and boardSalt are absent exactly as in realproof.mjs.
  };
  let contract;
  try {
    contract = new Contract(harnessWitnesses);
  } catch (error) {
    console.log('BROKEN      real-proof witness bundle is rejected at construction', `— ${error.message}`);
  }
  if (!contract) process.exit(0);
  const init = contract.initialState(rt.createConstructorContext(emptyPS(), COIN_PK));
  let state = init.currentContractState;
  const invoke = (name, ps, ...args) => {
    const ctx = rt.createCircuitContext(ADDRESS, COIN_PK, state, ps);
    const res = contract.impureCircuits[name](ctx, ...args);
    state = res.context.currentQueryContext.state;
    return res.result;
  };

  invoke(
    'openHand',
    emptyPS(),
    hand.handId,
    setup.deckCommit,
    setup.boardCommit,
    setup.hole0Commit,
    setup.hole1Commit,
    setup.seat0Key,
    setup.seat1Key,
  );

  let error;
  try {
    invoke('muckHand', hand.seats[0], hand.handId, 0n);
  } catch (caught) {
    error = caught;
  }
  if (!error) throw new Error('incomplete real-proof witnesses unexpectedly worked');
  console.log('BROKEN      real-proof witness bundle fails on its first private action', `— ${error.message}`);
}
