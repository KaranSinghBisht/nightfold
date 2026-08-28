// NightfoldEscrow against a local anvil.
//
// The escrow is the half of the cross-chain claim that actually moves money,
// so the tests care about the trust boundary as much as the happy path: the
// relayer must be able to report an outcome and nothing else, and a stalled
// relayer must never trap funds.

import { createWalletClient, createPublicClient, http, parseEther, formatEther, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { compileEscrow } from './compile.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';

// anvil's deterministic accounts
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  alice:    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  bob:      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  relayer:  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  mallory:  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
};
const acct = Object.fromEntries(
  Object.entries(KEYS).map(([k, v]) => [k, privateKeyToAccount(v)])
);

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (a) => createWalletClient({ account: acct[a], chain: foundry, transport: http(RPC) });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};
const wait = (hash) => pub.waitForTransactionReceipt({ hash });

async function reverts(fn) {
  try { await fn(); return false; } catch { return true; }
}

// ---- deploy ----------------------------------------------------------------

const { abi, bytecode } = compileEscrow();
const deployHash = await wallet('deployer').deployContract({
  abi, bytecode, args: [acct.relayer.address],
});
const { contractAddress: escrow } = await wait(deployHash);
console.log(`escrow deployed at ${escrow}`);
console.log(`relayer          ${acct.relayer.address}\n`);

const call = (who, functionName, args, value) =>
  wallet(who).writeContract({ address: escrow, abi, functionName, args, ...(value ? { value } : {}) });
const read = (functionName, args) =>
  pub.readContract({ address: escrow, abi, functionName, args });

// ---- a hand that settles ---------------------------------------------------

const handId = keccak256(toHex('nightfold:hand:1'));
const STAKE = parseEther('0.05');

await wait(await call('alice', 'openHand', [handId], STAKE));
check('alice opened the hand', (await read('hands', [handId]))[0] === acct.alice.address);

check('seat 1 must match the stake',
  await reverts(() => call('bob', 'joinHand', [handId], parseEther('0.01'))));

await wait(await call('bob', 'joinHand', [handId], STAKE));
check('bob joined, hand is funded', Number((await read('hands', [handId]))[4]) === 2);

// Only the relayer may report the Midnight outcome.
check('a stranger cannot settle',
  await reverts(() => call('mallory', 'settle', [handId, 1, handId])));
check('a player cannot settle their own hand',
  await reverts(() => call('alice', 'settle', [handId, 0, handId])));

const bobBefore = await pub.getBalance({ address: acct.bob.address });
// The attestation is the exact bytes Midnight wrote, recorded so a false
// settlement is publicly checkable against Midnight's ledger.
const attestation = keccak256(toHex('nf:payout:hand1:seat1'));
await wait(await call('relayer', 'settle', [handId, 1, attestation]));
const bobAfter = await pub.getBalance({ address: acct.bob.address });

check('bob received the whole pot',
  bobAfter - bobBefore === STAKE * 2n,
  `+${formatEther(bobAfter - bobBefore)} ETH`);
check('attestation recorded on-chain', (await read('hands', [handId]))[5] === attestation);
check('cannot settle twice', await reverts(() => call('relayer', 'settle', [handId, 0, attestation])));

// ---- a split pot -----------------------------------------------------------

const splitId = keccak256(toHex('nightfold:hand:split'));
await wait(await call('alice', 'openHand', [splitId], STAKE));
await wait(await call('bob', 'joinHand', [splitId], STAKE));
const aBefore = await pub.getBalance({ address: acct.alice.address });
await wait(await call('relayer', 'settle', [splitId, 2, attestation]));
const aAfter = await pub.getBalance({ address: acct.alice.address });
check('split pot returns each stake', aAfter - aBefore === STAKE, `+${formatEther(aAfter - aBefore)} ETH`);

// ---- a stalled relayer must not trap funds ---------------------------------

const stallId = keccak256(toHex('nightfold:hand:stalled'));
await wait(await call('alice', 'openHand', [stallId], STAKE));
await wait(await call('bob', 'joinHand', [stallId], STAKE));

check('cannot time out before the deadline',
  await reverts(() => call('alice', 'timeout', [stallId])));

// jump past the 1 hour timeout
await fetch(RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_increaseTime', params: [3601] }),
});
await fetch(RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'evm_mine', params: [] }),
});

const stallBefore = await pub.getBalance({ address: acct.bob.address });
await wait(await call('alice', 'timeout', [stallId]));
const stallAfter = await pub.getBalance({ address: acct.bob.address });
check('both stakes refunded after timeout', stallAfter - stallBefore === STAKE, `bob +${formatEther(stallAfter - stallBefore)} ETH`);

check('escrow holds nothing once every hand closes',
  (await pub.getBalance({ address: escrow })) === 0n);

console.log(failures === 0 ? '\nescrow: all checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
