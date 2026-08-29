// The cage, and the claim that makes Nightfold cross-chain:
//
//     buy in with one asset, play in chips, cash out in another.
//
// Two cages are deployed with different published rates, standing in for two
// chains. Both run on the same local EVM here — that is a limitation of the
// test rig, not of the design; the contract is per-chain and identical.

import { createWalletClient, createPublicClient, http, parseEther, formatEther, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { compileCage } from './compile.mjs';
import { chipsPerToken, weiForChips, unitsForChips } from '../pricing.mjs';
import { watcherAddresses, signCredit } from './watchers.mjs';

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

const { abi, bytecode } = compileCage();

/** Published rates, derived from the one USD table so they cannot disagree.
    A rate chosen per chain is free money — see src/evm/pricing.test.mjs. */
const BASE_RATE = chipsPerToken('ETH');   // 1 ETH -> 20,000 chips
const SOL_RATE = chipsPerToken('SOL');    // 1 SOL ->  1,000 chips

const CREDIT_CAP = 10_000_000n;
/** No oracle: the published rate is fixed for the life of these cages. */
const ZERO = '0x0000000000000000000000000000000000000000';

async function deployCage(rate) {
  const hash = await wallet('deployer').deployContract({ abi, bytecode, args: [acct.relayer.address, rate, CREDIT_CAP, ZERO] });
  const { contractAddress } = await wait(hash);
  // Two of three watchers must sign anything arriving from another cage.
  await wait(await wallet('deployer').writeContract({
    address: contractAddress, abi, functionName: 'setWatchers', args: [watcherAddresses, 2n],
  }));
  // seed the house float so this cage can pay out chips bought elsewhere
  await wait(await wallet('deployer').writeContract({
    address: contractAddress, abi, functionName: 'fund', value: parseEther('10'),
  }));
  return contractAddress;
}

const baseCage = await deployCage(BASE_RATE);
const solCage = await deployCage(SOL_RATE);

console.log(`base cage   ${baseCage.slice(0, 12)}…  1 ETH = ${BASE_RATE} chips`);
console.log(`solana cage ${solCage.slice(0, 12)}…  1 SOL = ${SOL_RATE} chips\n`);

const read = (cage, fn, args) => pub.readContract({ address: cage, abi, functionName: fn, args });
const call = (cage, who, fn, args, value) =>
  wallet(who).writeContract({ address: cage, abi, functionName: fn, args, ...(value ? { value } : {}) });

// ---- buy in on two different chains ---------------------------------------

const aliceDep = keccak256(toHex('nightfold:dep:alice'));
const bobDep = keccak256(toHex('nightfold:dep:bob'));

// Both buy the same 1,000 chip stack. What that COSTS differs per chain and
// per day; what it buys does not, which is the whole point of a cage.
const aliceWei = weiForChips('ETH', 1000);
const bobWei = weiForChips('SOL', 1000);

await wait(await call(baseCage, 'alice', 'buyIn', [aliceDep, 0n], aliceWei));
await wait(await call(solCage, 'bob', 'buyIn', [bobDep, 0n], bobWei));

const aliceChips = await read(baseCage, 'chipsFor', [aliceWei]);
const bobChips = await read(solCage, 'chipsFor', [bobWei]);

check('alice buys chips with ETH on base', aliceChips === 1000n,
      `${unitsForChips('ETH', 1000).toPrecision(4)} ETH → ${aliceChips} chips`);
check('bob buys chips with SOL on solana', bobChips === 1000n,
      `${unitsForChips('SOL', 1000).toPrecision(4)} SOL → ${bobChips} chips`);
check('both sit down with the SAME stack', aliceChips === bobChips,
      'different assets, different chains, one unit of account');

await wait(await call(baseCage, 'relayer', 'creditLocal', [aliceDep]));
await wait(await call(solCage, 'relayer', 'creditLocal', [bobDep]));
check('deposits credited to the depositor', (await read(baseCage, 'chips', [acct.alice.address])) === 1000n);
check('chip supply is tracked', (await read(baseCage, 'totalChips', [])) === 1000n);

// ---- the cross-chain moment ------------------------------------------------
// Bob won the hand. He bought in with SOL; he cashes out in ETH.
//
// Leaving a cage is a BURN that issues a receipt; arriving requires that
// receipt, signed by watchers. The relayer carries it and nothing else — it
// cannot author one, and RA-005's double-issue is impossible because the chips
// stopped existing on the source before they existed here.

const moved = 1000n; // exactly what he burns; a cage cannot mint on the way in

const burnTx = await wait(await call(solCage, 'bob', 'burnForRemote', [moved, 31337n, baseCage]));
check('leaving a cage burns the chips there',
      (await read(solCage, 'chips', [acct.bob.address])) === 0n,
      'no balance left behind on the source');

const rc = {
  srcChainId: 31337n,
  srcCage: solCage,
  dstChainId: 31337n,
  dstCage: baseCage,
  player: acct.bob.address,
  chipAmount: moved,
  nonce: 1n,
};
const sigs = await signCredit(rc, 2);
await wait(await wallet('relayer').writeContract({
  address: baseCage, abi, functionName: 'creditRemote', args: [rc, sigs],
}));
check('credited on base against a signed receipt',
      (await read(baseCage, 'chips', [acct.bob.address])) === moved);
check('chips exist in exactly one cage at a time',
      (await read(solCage, 'chips', [acct.bob.address])) === 0n &&
      (await read(baseCage, 'chips', [acct.bob.address])) === moved,
      'burned on solana before they existed on base');
check('a receipt cannot be replayed',
      await reverts(() => wallet('relayer').writeContract({
        address: baseCage, abi, functionName: 'creditRemote', args: [rc, sigs],
      })));
check('a receipt nobody issued is refused',
      await reverts(async () => wallet('relayer').writeContract({
        address: baseCage, abi, functionName: 'creditRemote',
        args: [{ ...rc, nonce: 2n }, await signCredit({ ...rc, nonce: 2n }, 3)],
      })),
      'a same-chain source is read, not taken on trust');

const before = await pub.getBalance({ address: acct.bob.address });
await wait(await call(baseCage, 'bob', 'cashOut', [moved]));
await wait(await call(baseCage, 'bob', 'withdraw', []));
const after = await pub.getBalance({ address: acct.bob.address });

const expected = await read(baseCage, 'tokensFor', [moved]);
check('bob cashes out on a chain he never deposited to',
      after > before,
      `bought in with SOL, left with ~${formatEther(expected)} ETH`);
// The cage floors on the way out, so an exit is worth at most what those chips
// cost and at least one chip less. It must never pay out more.
const fair = weiForChips('ETH', Number(moved));
check('the rate is the published one',
      expected <= fair && fair - expected <= 10n ** 18n / BASE_RATE,
      `${formatEther(expected)} ETH for ${moved} chips`);
check('chips are burned on cash-out', (await read(baseCage, 'chips', [acct.bob.address])) === 0n);

// ---- the cage's guarantees -------------------------------------------------

check('a stranger holding no chips cannot cash out',
      await reverts(() => call(baseCage, 'mallory', 'cashOut', [1000n])));
check('the relayer cannot move funds at all',
      await reverts(() => call(baseCage, 'relayer', 'cashOut', [moved])),
      'cashOut burns the CALLER\'s chips');
check('the relayer cannot credit itself',
      await reverts(async () => {
        const self = { ...rc, player: acct.relayer.address, nonce: 3n };
        return wallet('relayer').writeContract({
          address: baseCage, abi, functionName: 'creditRemote', args: [self, await signCredit(self, 2)],
        });
      }),
      'even with a full quorum behind it');
check('a deposit id cannot be reused',
      await reverts(() => call(baseCage, 'alice', 'buyIn', [aliceDep, 0n], parseEther('0.01'))));
check('a credited deposit cannot be reclaimed',
      await reverts(() => call(baseCage, 'alice', 'reclaim', [aliceDep])));

// an un-credited deposit is recoverable once the relayer has clearly stalled
const stuck = keccak256(toHex('nightfold:dep:stuck'));
await wait(await call(baseCage, 'alice', 'buyIn', [stuck, 0n], parseEther('0.02')));
check('cannot reclaim before the window', await reverts(() => call(baseCage, 'alice', 'reclaim', [stuck])));

for (const [method, params] of [['evm_increaseTime', [7201]], ['evm_mine', []]]) {
  await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}
const preReclaim = await pub.getBalance({ address: acct.alice.address });
await wait(await call(baseCage, 'alice', 'reclaim', [stuck]));
await wait(await call(baseCage, 'alice', 'withdraw', []));
const postReclaim = await pub.getBalance({ address: acct.alice.address });
check('a stalled relayer never costs you your buy-in',
      postReclaim > preReclaim, `recovered ${formatEther(postReclaim - preReclaim)} ETH (less gas)`);
check('someone else cannot reclaim your deposit',
      await reverts(() => call(baseCage, 'mallory', 'reclaim', [stuck])));
// Conservation: the recorded supply equals the sum of what people hold.
// Alice still holds her 1,000 — she never cashed out, which is correct.
{
  const holders = [acct.alice.address, acct.bob.address, acct.relayer.address, acct.mallory.address];
  let held = 0n;
  for (const h of holders) held += await read(baseCage, 'chips', [h]);
  const supply = await read(baseCage, 'totalChips', []);
  check('chip supply equals the sum of balances', supply === held,
        `${supply} recorded, ${held} held — nothing minted from nowhere`);
}

console.log(failures === 0
  ? '\ncage: buy in anywhere, cash out anywhere — all checks passed'
  : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
