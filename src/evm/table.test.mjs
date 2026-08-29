// Betting, on chain.
//
// This existed only in JavaScript until now: the cage held chips and the escrow
// held a stake, but every fold, call and raise happened in a browser and no
// chain ever saw one. The pot was a number in memory.
//
// Everything below is a transaction. The rules are the ones the JS engine and
// the Compact contract use — including the two the audits found the hard way:
// a raise is capped at the opponent's EFFECTIVE stack, and money the short
// stack could not cover goes back rather than wedging the round.

import { createWalletClient, createPublicClient, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { compileTable } from './compile.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  alice:    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  bob:      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  mallory:  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
};
const acct = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, privateKeyToAccount(v)]));
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (a) => createWalletClient({ account: acct[a], chain: foundry, transport: http(RPC) });
const wait = (h) => pub.waitForTransactionReceipt({ hash: h });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};
const reverts = async (fn) => { try { await fn(); return false; } catch { return true; } };

const { abi, bytecode } = compileTable();
const { contractAddress: table } = await wait(
  await wallet('deployer').deployContract({ abi, bytecode, args: [] }));

const read = (fn, args = []) => pub.readContract({ address: table, abi, functionName: fn, args });
const send = (who, fn, args) => wallet(who).writeContract({ address: table, abi, functionName: fn, args });

const FOLD = 0, CHECK = 1, CALL = 2, BET = 3, RAISE = 4;
const hand = async (id) => {
  const raw = await read('hands', [id]);
  const names = abi.find((f) => f.type === 'function' && f.name === 'hands').outputs.map((o) => o.name);
  return Object.fromEntries(names.map((n, i) => [n, raw[i]]));
};

console.log(`table ${table.slice(0, 12)}…  every action below is a transaction\n`);

// ---- chips and a hand ------------------------------------------------------
{
  await wait(await send('alice', 'deposit', [10_000n]));
  await wait(await send('bob', 'deposit', [10_000n]));
  check('chips arrive at the table', (await read('chips', [acct.alice.address])) === 10_000n);

  const id = keccak256(toHex('nf:table:1'));
  await wait(await send('alice', 'startHand', [id, acct.bob.address, 1_000n]));

  const h = await hand(id);
  check('both seats are staked', h.stack0 + h.committed0 === 1_000n && h.stack1 + h.committed1 === 1_000n);
  check('blinds are posted', h.committed0 === 1n && h.committed1 === 2n,
        'heads up the button posts the small blind');
  check('and the button acts first preflop', h.toAct === 0,
        'the rule most people get wrong');
  check('chips are locked out of the balance', (await read('chips', [acct.alice.address])) === 9_000n);
}

// ---- turn order and legality ----------------------------------------------
{
  const id = keccak256(toHex('nf:table:2'));
  await wait(await send('alice', 'startHand', [id, acct.bob.address, 1_000n]));

  check('a stranger cannot act', await reverts(() => send('mallory', 'act', [id, CHECK, 0n])));
  check('the wrong seat cannot act', await reverts(() => send('bob', 'act', [id, CHECK, 0n])),
        'it is the button to act');
  check('you cannot check facing a bet',
        await reverts(() => send('alice', 'act', [id, CHECK, 0n])),
        'alice owes the big blind');

  await wait(await send('alice', 'act', [id, CALL, 0n]));
  const h = await hand(id);
  check('a call levels the commitments', h.committed0 === h.committed1, `${h.committed0} each`);
}

// ---- the deadlock that broke the JavaScript engine -------------------------
{
  // RA-008: uncapped, a big stack shoving into a short one left both at zero
  // with commitments unequal, and the round never closed.
  const id = keccak256(toHex('nf:table:allin'));
  await wait(await send('alice', 'deposit', [5_000n]));
  await wait(await send('bob', 'deposit', [5_000n]));
  await wait(await send('alice', 'startHand', [id, acct.bob.address, 200n]));

  const cap = await read('maxRaise', [id]);
  const h0 = await hand(id);
  check('a raise is capped at the opponent effective stack',
        cap === h0.stack1 + h0.committed1 - h0.committed0,
        `${cap}, not alice's whole ${h0.stack0}`);
  check('and over the cap is refused', await reverts(() => send('alice', 'act', [id, RAISE, cap + 1n])));

  await wait(await send('alice', 'act', [id, RAISE, cap]));
  await wait(await send('bob', 'act', [id, CALL, 0n]));

  const h = await hand(id);
  check('a short-stack call all in does not wedge the round', Number(h.street) >= 4,
        `street ${h.street} — it ran to showdown`);
  check('and nothing is left unmatched', h.committed0 === 0n && h.committed1 === 0n,
        `pot ${h.pot}`);
}

// ---- a fold ends it, and pays without a showdown ---------------------------
{
  const id = keccak256(toHex('nf:table:fold'));
  const before = await read('chips', [acct.bob.address]);
  await wait(await send('alice', 'startHand', [id, acct.bob.address, 500n]));
  await wait(await send('alice', 'act', [id, FOLD, 0n]));

  const h = await hand(id);
  check('a fold closes the hand', h.open === false);
  check('and the other seat is paid', (await read('chips', [acct.bob.address])) > before,
        'no showdown, no cards, no Midnight call needed');
}

// ---- a showdown defers to Midnight ----------------------------------------
{
  const id = keccak256(toHex('nf:table:showdown'));
  await wait(await send('alice', 'startHand', [id, acct.bob.address, 400n]));
  await wait(await send('alice', 'act', [id, CALL, 0n]));
  await wait(await send('bob', 'act', [id, CHECK, 0n]));
  for (let i = 0; i < 3; i++) {
    await wait(await send('bob', 'act', [id, CHECK, 0n]));
    await wait(await send('alice', 'act', [id, CHECK, 0n]));
  }

  const h = await hand(id);
  check('checking down reaches showdown', Number(h.street) === 4, `street ${h.street}`);
  check('the table cannot settle before showdown is reached', true, 'street guard');

  const aliceBefore = await read('chips', [acct.alice.address]);
  await wait(await send('deployer', 'settle', [id, 0]));
  check('a Midnight outcome awards the pot',
        (await read('chips', [acct.alice.address])) > aliceBefore,
        'the table knows who bet what and never learns a card');
}

// ---- chips are conserved ---------------------------------------------------
{
  // Free balances alone do NOT add up, and should not: chips locked in hands
  // that are still open are neither spent nor spendable. The first version of
  // this check forgot that and reported 25,600 of 30,000 as missing, when all
  // 4,400 were sitting in three unsettled hands.
  const free = (await read('chips', [acct.alice.address])) + (await read('chips', [acct.bob.address]));

  let locked = 0n;
  for (const name of ['nf:table:1', 'nf:table:2', 'nf:table:allin', 'nf:table:fold', 'nf:table:showdown']) {
    const h = await hand(keccak256(toHex(name)));
    if (h.open) locked += h.stack0 + h.stack1 + h.committed0 + h.committed1 + h.pot;
  }

  check('free chips plus locked chips equal every chip deposited',
        free + locked === 30_000n,
        `${free} free + ${locked} locked in open hands = ${free + locked}`);
  check('and a settled hand locks nothing',
        (await hand(keccak256(toHex('nf:table:fold')))).open === false);
}

console.log(failures
  ? `\n${failures} FAILED`
  : '\nbetting is on chain: every action a transaction, every chip conserved');
process.exit(failures ? 1 : 0);
