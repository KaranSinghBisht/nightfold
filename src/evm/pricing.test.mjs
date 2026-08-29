// A chip has to cost the same everywhere, or the cage is a faucet.
//
// If each chain picked its own rate, the rates would disagree, and disagreeing
// rates are free money: buy chips on the chain where they are cheap, cash out
// on the chain where they are dear, repeat. This file is the regression test
// for a bug that was really in the rate table — Solana was priced at 100 chips
// per SOL against Ethereum's 20,000 per ETH, which valued a chip at $0.20 going
// in and $2.00 coming out. A 10x drain, in the published numbers.
//
// Every rate now comes from one USD table, and the round trip is checked here.

import { createWalletClient, createPublicClient, http, parseEther, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { compileCage } from './compile.mjs';
import { chipsPerToken, usdOf, usdOfChips, unitsForChips, weiForChips, CHIP_USD, PRICES_USD } from '../pricing.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  alice:    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  relayer:  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  oracle:   '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
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

const { abi, bytecode } = compileCage();
const ZERO = '0x0000000000000000000000000000000000000000';
const CAP = 10_000_000n;

async function deploy(rate, oracle = ZERO) {
  const h = await wallet('deployer').deployContract({ abi, bytecode, args: [acct.relayer.address, rate, CAP, oracle] });
  const { contractAddress } = await wait(h);
  await wait(await wallet('deployer').writeContract({ address: contractAddress, abi, functionName: 'fund', value: parseEther('50') }));
  return contractAddress;
}

const ASSETS = ['ETH', 'BTC', 'SOL', 'ADA', 'NEAR'];

console.log(`a chip is $${CHIP_USD}. every rate below is derived from that, not chosen.\n`);

// ---- one dollar buys the same number of chips on every chain ---------------

for (const a of ASSETS) {
  const cage = await deploy(chipsPerToken(a));
  // Buy the same 1,000 chip stack on every chain and check what it cost.
  const wei = weiForChips(a, 1000);
  const chips = await pub.readContract({ address: cage, abi, functionName: 'chipsFor', args: [wei] });
  const spentUsd = usdOf(a, Number(wei) / 1e18);
  check(
    `1,000 chips costs ${unitsForChips(a, 1000).toPrecision(4)} ${a.padEnd(4)}`,
    chips === 1_000n && Math.abs(spentUsd - 200) < CHIP_USD,
    `$${spentUsd.toFixed(2)} for ${chips} chips`,
  );
}

check('every asset agrees on what a chip costs',
  ASSETS.every((a) => usdOf(a, 1) / Number(chipsPerToken(a)) === CHIP_USD),
  `$${CHIP_USD} everywhere`);

// ---- the round trip that used to be a drain -------------------------------

// Buy chips on the cheapest chain, cash out on the dearest. With one USD table
// there is no cheapest and no dearest, so this returns exactly what went in.
const ethCage = await deploy(chipsPerToken('ETH'));
const solCage = await deploy(chipsPerToken('SOL'));

// Whatever amount of ETH buys a 1,000 chip stack at today's snapshot.
const ethWei = weiForChips('ETH', 1000);
const ethIn = Number(ethWei) / 1e18;
const dep = keccak256(toHex('nightfold:arb:1'));
await wait(await wallet('alice').writeContract({ address: ethCage, abi, functionName: 'buyIn', args: [dep, 0n], value: ethWei }));
await wait(await wallet('relayer').writeContract({ address: ethCage, abi, functionName: 'creditLocal', args: [dep] }));

const bought = await pub.readContract({ address: ethCage, abi, functionName: 'chips', args: [acct.alice.address] });
const outWei = await pub.readContract({ address: solCage, abi, functionName: 'tokensFor', args: [bought] });

check(`${ethIn.toFixed(4)} ETH buys 1,000 chips`, bought === 1_000n, `${bought} chips = $${usdOfChips(bought)}`);

const usdIn = usdOf('ETH', ethIn);
const usdOut = usdOf('SOL', Number(outWei) / 1e18);
// Two tolerances, for two different reasons.
//
// Downward: the cage floors on the way out, so a round trip can leave up to a
// chip of dust behind. That is fine — dust belongs to the cage.
//
// Upward: these are IEEE-754 dollars, and `usdOut <= usdIn` fails on noise of
// order 1e-14 even when the two are the same number. An exact inequality is the
// wrong test on floats; what matters is that no MEANINGFUL value is created, so
// the epsilon is a billionth of a cent — far below anything an arbitrageur
// could act on, and far above the noise.
const DUST = 1e-9;
check('those chips redeem for the same USD in SOL',
  usdOut - usdIn < DUST && usdIn - usdOut < CHIP_USD,
  `$${usdOut.toFixed(2)} out vs $${usdIn.toFixed(2)} in`);

// The bug this file exists for. The rates used to be hand-picked: 20,000 chips
// per ETH against 100 per SOL. Priced at whatever SOL is actually worth today,
// that pays out many times what went in — for free, forever.
const OLD_BROKEN_SOL_RATE = 100n;
const brokenOut = (bought * 10n ** 18n) / OLD_BROKEN_SOL_RATE;
const brokenUsd = usdOf('SOL', Number(brokenOut) / 1e18);
check('the old hand-picked rates really were a drain',
  brokenUsd > usdIn * 2,
  `$${brokenUsd.toFixed(2)} out for $${usdIn.toFixed(2)} in — ${(brokenUsd / usdIn).toFixed(1)}x`);

// ---- an oracle-priced cage -------------------------------------------------

const live = await deploy(chipsPerToken('ETH'), acct.oracle.address);

/** Posts need MIN_POST_INTERVAL between them now, so walk the clock first. */
const tick = async (seconds = 600) => {
  await pub.request({ method: 'evm_increaseTime', params: [`0x${seconds.toString(16)}`] });
  await pub.request({ method: 'evm_mine', params: [] });
};
const post = async (r, who = 'oracle') => {
  await tick();
  return wallet(who).writeContract({ address: live, abi, functionName: 'postRate', args: [r] });
};

const launch = chipsPerToken('ETH');
check('a fresh oracle cage prices at its launch rate',
  (await pub.readContract({ address: live, abi, functionName: 'rate' })) === launch);

// A 5% move is an ordinary day; doubling is not, and the cage knows which.
const nudge = launch + launch / 20n;
await wait(await post(nudge));
check('the oracle can move the rate', (await pub.readContract({ address: live, abi, functionName: 'rate' })) === nudge,
  `${launch} -> ${nudge}`);

check('nobody else can post a rate', await reverts(() => post(nudge, 'alice')));
check('a rate cannot jump more than 20% in one post', await reverts(() => post(launch * 2n)));
check('a zero rate is refused', await reverts(() => post(0n)));

check('two posts in the same block are refused',
  await reverts(async () => {
    await wallet('oracle').writeContract({ address: live, abi, functionName: 'postRate', args: [nudge + 1n] });
    return wallet('oracle').writeContract({ address: live, abi, functionName: 'postRate', args: [nudge + 2n] });
  }),
  'RA-004: a per-call bound is no bound without a clock');

// Walk time past MAX_PRICE_AGE and the cage stops minting chips.
await tick(7200);

check('a stale price cannot mint chips',
  await reverts(() => pub.readContract({ address: live, abi, functionName: 'chipsFor', args: [parseEther('1')] })));
check('a stale price can still redeem them',
  (await pub.readContract({ address: live, abi, functionName: 'tokensFor', args: [1_000n] })) > 0n);

console.log(failures
  ? `\n${failures} FAILED`
  : '\none USD table, one chip price, no chain to arbitrage against another');
process.exit(failures ? 1 : 0);
