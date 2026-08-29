// NightfoldEscrow against a local anvil.
//
// The escrow is the half of the cross-chain claim that moves money, so these
// tests care about the trust boundary as much as the happy path. After the
// 2026-08-29 audit that boundary is: the relayer PROPOSES an outcome whose
// attestation the contract recomputes, a challenge window opens, and payouts
// are pulled rather than pushed.

import { createWalletClient, createPublicClient, http, parseEther, formatEther, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { watcherAddresses, signSettle } from './watchers.mjs';
import { compileEscrow } from './compile.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';

const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  alice:    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  bob:      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  relayer:  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  mallory:  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
};
const acct = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, privateKeyToAccount(v)]));
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (a) => createWalletClient({ account: acct[a], chain: foundry, transport: http(RPC) });
const wait = (hash) => pub.waitForTransactionReceipt({ hash });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};
const reverts = async (fn) => { try { await fn(); return false; } catch { return true; } };
const jump = async (secs) => {
  for (const [method, params] of [['evm_increaseTime', [secs]], ['evm_mine', []]]) {
    await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  }
};

const { abi, bytecode } = compileEscrow();
const { contractAddress: escrow } = await wait(
  await wallet('deployer').deployContract({ abi, bytecode, args: [acct.relayer.address] })
);
// Two of three watchers must sign any settlement; the relayer is not one.
await wait(await wallet('deployer').writeContract({
  address: escrow, abi, functionName: 'setWatchers', args: [watcherAddresses, 2n],
}));

const sign = (handId, winner, count = 2) =>
  signSettle({ chainId: 31337n, escrow, handId, winner }, count);

console.log(`escrow deployed at ${escrow}`);
console.log(`relayer          ${acct.relayer.address}\n`);

const call = (who, fn, args, value) =>
  wallet(who).writeContract({ address: escrow, abi, functionName: fn, args, ...(value ? { value } : {}) });
const read = (fn, args) => pub.readContract({ address: escrow, abi, functionName: fn, args });

const STAKE = parseEther('0.05');

// ---- a hand that settles ---------------------------------------------------

const handId = keccak256(toHex('nightfold:hand:1'));

await wait(await call('alice', 'openHand', [handId], STAKE));
check('alice opened the hand', (await read('hands', [handId]))[0] === acct.alice.address);
check('seat 1 must match the stake',
      await reverts(() => call('bob', 'joinHand', [handId], parseEther('0.01'))));

await wait(await call('bob', 'joinHand', [handId], STAKE));
check('bob joined, hand is funded', Number((await read('hands', [handId]))[5]) === 2);

check('a stranger cannot propose a settlement',
      await reverts(async () => call('mallory', 'proposeSettlement', [handId, 1, await sign(handId, 1)])));
check('a player cannot settle their own hand',
      await reverts(async () => call('alice', 'proposeSettlement', [handId, 0, await sign(handId, 0)])));

check('the relayer alone cannot settle',
      await reverts(() => call('relayer', 'proposeSettlement', [handId, 1, []])),
      'RA-002: a quorum it is not part of has to sign');
await wait(await call('relayer', 'proposeSettlement', [handId, 1, await sign(handId, 1)]));
check('the relayer proposes a matching outcome', Number((await read('hands', [handId]))[5]) === 3);
check('nobody is paid during the challenge window',
      (await read('withdrawable', [acct.bob.address])) === 0n);

await jump(601);
await wait(await call('alice', 'finaliseSettlement', [handId]));
check('bob is credited the pot after the window',
      (await read('withdrawable', [acct.bob.address])) === STAKE * 2n,
      formatEther(STAKE * 2n) + ' ETH');

const before = await pub.getBalance({ address: acct.bob.address });
await wait(await call('bob', 'withdraw', []));
check('bob pulls his winnings', (await pub.getBalance({ address: acct.bob.address })) > before);
check('cannot settle twice',
      await reverts(async () => call('relayer', 'proposeSettlement', [handId, 0, await sign(handId, 0)])));

// ---- a split pot -----------------------------------------------------------

const splitId = keccak256(toHex('nightfold:hand:split'));
await wait(await call('alice', 'openHand', [splitId], STAKE));
await wait(await call('bob', 'joinHand', [splitId], STAKE));
await wait(await call('relayer', 'proposeSettlement', [splitId, 2, await sign(splitId, 2)]));
await jump(601);
await wait(await call('bob', 'finaliseSettlement', [splitId]));
check('a split pot credits each seat its stake',
      (await read('withdrawable', [acct.alice.address])) === STAKE);

// ---- a stalled relayer must not trap funds ---------------------------------

const stallId = keccak256(toHex('nightfold:hand:stalled'));
await wait(await call('alice', 'openHand', [stallId], STAKE));
await wait(await call('bob', 'joinHand', [stallId], STAKE));
check('cannot time out before the deadline',
      await reverts(() => call('alice', 'timeout', [stallId])));

await jump(3601);
// Balances accumulate across hands, so measure the delta this timeout adds.
const bobOwedBefore = await read('withdrawable', [acct.bob.address]);
const aliceOwedBefore = await read('withdrawable', [acct.alice.address]);
await wait(await call('alice', 'timeout', [stallId]));
check('both stakes are credited back on timeout',
      (await read('withdrawable', [acct.bob.address])) - bobOwedBefore === STAKE &&
      (await read('withdrawable', [acct.alice.address])) - aliceOwedBefore === STAKE,
      'each seat gets its own stake back');

await wait(await call('alice', 'withdraw', []));
await wait(await call('bob', 'withdraw', []));
check('escrow holds nothing once every hand closes',
      (await pub.getBalance({ address: escrow })) === 0n);

// ---- RA-002: the challenge window can now be challenged --------------------
console.log('\na disputed settlement refunds instead of paying\n');
{
  const id = keccak256(toHex('nf:hand:disputed'));
  await wait(await call('alice', 'openHand', [id], parseEther('0.05')));
  await wait(await call('bob', 'joinHand', [id], parseEther('0.05')));
  await wait(await call('relayer', 'proposeSettlement', [id, 0, await sign(id, 0)]));

  check('a stranger cannot challenge',
        await reverts(() => call('mallory', 'challenge', [id])));

  // Bob thinks the reported winner is wrong. Before, there was a ten minute
  // window with no way to act in it, so waiting paid the liar.
  await wait(await call('bob', 'challenge', [id]));
  check('a challenged hand cannot be finalised',
        await reverts(() => call('bob', 'finaliseSettlement', [id])),
        'the named winner is not paid');

  await pub.request({ method: 'evm_increaseTime', params: ['0x1E848'] }); // 5 days
  await pub.request({ method: 'evm_mine', params: [] });
  await wait(await call('bob', 'timeout', [id]));

  const a = await read('withdrawable', [acct.alice.address]);
  const b = await read('withdrawable', [acct.bob.address]);
  check('both stakes go back when a settlement is disputed',
        a >= parseEther('0.05') && b >= parseEther('0.05'),
        'a liar cannot be paid; the disagreement leaves the chain');
}

console.log(failures === 0 ? '\nescrow: all checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
