// The remediation-verification exploits, as regressions.
//
// Every scenario here was executed against this repo and drained it. Each one
// now has to fail, and — the part the previous attempt got wrong — has to fail
// for the RIGHT REASON. `check:exploits` once "passed" by crediting 20,000
// chips against a cage backing 12,175: it stopped at the solvency ceiling and
// never reached the check it claimed to test. At the exact backed amount the
// cage emptied.
//
// So each case here asserts the revert reason, and every cap is probed at its
// boundary: one unit over must fail, the cap itself must succeed, and the cage
// must still be whole afterwards.

import { createWalletClient, createPublicClient, http, parseEther, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { compileCage, compileFakeCage } from './compile.mjs';
import { watcherAddresses, signCredit } from './watchers.mjs';
import { chipsPerToken, weiForChips } from '../pricing.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  alice:    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  bob:      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  relayer:  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  mallory:  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
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

/** Reverts, AND with the error we meant. A revert for another reason is a miss. */
async function revertsWith(fn, needle) {
  try {
    await fn();
    return { ok: false, why: 'did not revert' };
  } catch (e) {
    const msg = String(e?.message ?? e);
    return { ok: msg.includes(needle), why: msg.split('\n')[0].slice(0, 90) };
  }
}

const day = async () => {
  await pub.request({ method: 'evm_increaseTime', params: ['0x15180'] });
  await pub.request({ method: 'evm_mine', params: [] });
};

const { abi, bytecode } = compileCage();
const fake = compileFakeCage();
const ZERO = '0x0000000000000000000000000000000000000000';
const RATE = chipsPerToken('ETH');
const CAP = 10_000_000n;

async function deploy({ oracle = ZERO, float = '1' } = {}) {
  const h = await wallet('deployer').deployContract({ abi, bytecode, args: [acct.relayer.address, RATE, CAP, oracle] });
  const { contractAddress: c } = await wait(h);
  await wait(await wallet('deployer').writeContract({ address: c, abi, functionName: 'setWatchers', args: [watcherAddresses, 2n] }));
  if (float !== '0') {
    await wait(await wallet('deployer').writeContract({ address: c, abi, functionName: 'fund', value: parseEther(float) }));
  }
  return c;
}
const read = (c, fn, args = []) => pub.readContract({ address: c, abi, functionName: fn, args });
const send = (c, who, fn, args, value) =>
  wallet(who).writeContract({ address: c, abi, functionName: fn, args, ...(value ? { value } : {}) });

const receipt = (over) => ({
  srcChainId: 999n, srcCage: acct.mallory.address, dstChainId: 31337n,
  player: acct.mallory.address, chipAmount: 1000n, nonce: 1n, ...over,
});

console.log('every case below drained this cage before. each must now fail, and fail correctly.\n');

// ---- NFV-001a: a quorum-signed receipt cannot take the whole float ---------
{
  const cage = await deploy({ float: '1' });
  const held = await pub.getBalance({ address: cage });
  const backed = await read(cage, 'chipsFor', [held]);
  const ceiling = (await read(cage, 'chipsFor', [await read(cage, 'unencumbered')])) * 2000n / 10_000n;

  console.log(`  cage holds ${held} wei = ${backed} chips; one credit may claim ${ceiling}\n`);

  // The exact amount the old test missed by overshooting.
  const atBacked = receipt({ chipAmount: backed, dstCage: cage, nonce: 1n });
  const r1 = await revertsWith(async () => send(cage, 'relayer', 'creditRemote', [atBacked, await signCredit(atBacked, 2)]), 'TooLarge');
  check('a receipt for the whole backed float is refused', r1.ok, `${backed} chips — ${r1.why}`);

  const over = receipt({ chipAmount: ceiling + 1n, dstCage: cage, nonce: 2n });
  const r2 = await revertsWith(async () => send(cage, 'relayer', 'creditRemote', [over, await signCredit(over, 2)]), 'TooLarge');
  check('one chip over the reserve cap is refused', r2.ok, `${ceiling + 1n} chips`);

  // At the cap it must succeed — otherwise the two checks above prove nothing
  // about the cap and everything about some unrelated ceiling.
  const at = receipt({ chipAmount: ceiling, dstCage: cage, nonce: 3n });
  await wait(await send(cage, 'relayer', 'creditRemote', [at, await signCredit(at, 2)]));
  check('at the cap it is accepted', (await read(cage, 'chips', [acct.mallory.address])) === ceiling,
        'so the cap is what the two refusals were about');

  await wait(await send(cage, 'mallory', 'cashOut', [ceiling]));
  await wait(await send(cage, 'mallory', 'withdraw', []));
  const left = await pub.getBalance({ address: cage });
  check('and the worst one receipt can do is bounded', left > (held * 7n) / 10n,
        `${left} of ${held} wei still held`);
}

// ---- NFV-001b: an arbitrary contract that answers the interface -----------
{
  const cage = await deploy({ float: '1' });
  const { contractAddress: liar } = await wait(
    await wallet('mallory').deployContract({ abi: fake.abi, bytecode: fake.bytecode, args: [] }));

  const rc = receipt({ srcChainId: 31337n, srcCage: liar, dstCage: cage, chipAmount: 100n, nonce: 1n });
  const r = await revertsWith(() => send(cage, 'relayer', 'creditRemote', [rc, []]), 'UnknownCage');
  check('a same-chain source the cage does not know is refused', r.ok, `issuedReceipt() returns true — ${r.why}`);
  check('the cage is untouched', (await pub.getBalance({ address: cage })) === parseEther('1'));

  // Registration is delayed, so even an admin cannot bless it and use it now.
  await wait(await send(cage, 'deployer', 'proposeCage', [liar]));
  const r2 = await revertsWith(() => send(cage, 'deployer', 'activateCage', [liar]), 'TooEarly');
  check('a freshly proposed cage cannot be activated', r2.ok, 'governance delay');
}

// ---- NFV-002: a pending deposit is owed, not spare ------------------------
{
  const cage = await deploy({ float: '0' });
  const dep = keccak256(toHex('nfv:pending'));
  const wei = weiForChips('ETH', 1000);
  await wait(await send(cage, 'alice', 'buyIn', [dep, 0n], wei));

  const held = await pub.getBalance({ address: cage });
  check('an uncredited deposit counts as a liability',
        (await read(cage, 'liabilities')) >= held,
        `${await read(cage, 'liabilities')} owed against ${held} held`);
  check('and is therefore not unencumbered', (await read(cage, 'unencumbered')) === 0n);

  const rc = receipt({ dstCage: cage, player: acct.bob.address, chipAmount: 1n, nonce: 1n });
  const r = await revertsWith(async () => send(cage, 'relayer', 'creditRemote', [rc, await signCredit(rc, 2)]), 'TooLarge');
  check('nobody can be credited against it', r.ok, "alice's deposit cannot back bob's chips");

  await pub.request({ method: 'evm_increaseTime', params: ['0x1C20'] });
  await pub.request({ method: 'evm_mine', params: [] });
  await wait(await send(cage, 'alice', 'reclaim', [dep]));
  await wait(await send(cage, 'alice', 'withdraw', []));
  check('so the depositor can always get it back', (await pub.getBalance({ address: cage })) === 0n,
        'reclaimed in full');
}

// ---- NFV-005: two cages, both starting their nonces at one ----------------
{
  const dst = await deploy({ float: '5' });
  const srcA = await deploy({ float: '1' });
  const srcB = await deploy({ float: '1' });

  for (const src of [srcA, srcB]) {
    await wait(await send(dst, 'deployer', 'proposeCage', [src]));
  }
  await day();
  for (const src of [srcA, srcB]) {
    await wait(await send(dst, 'deployer', 'activateCage', [src]));
  }

  // Give alice chips on both sources, then burn from each. Both burns are
  // nonce 1, which used to collide and lock the second source out forever.
  for (const [src, tag] of [[srcA, 'a'], [srcB, 'b']]) {
    const dep = keccak256(toHex('nfv:collide:' + tag));
    await wait(await send(src, 'alice', 'buyIn', [dep, 0n], weiForChips('ETH', 500)));
    await wait(await send(src, 'relayer', 'creditLocal', [dep]));
    await wait(await send(src, 'alice', 'burnForRemote', [500n, 31337n, dst]));
  }

  let credited = 0n;
  for (const src of [srcA, srcB]) {
    const rc = { srcChainId: 31337n, srcCage: src, dstChainId: 31337n, dstCage: dst,
                 player: acct.alice.address, chipAmount: 500n, nonce: 1n };
    await wait(await send(dst, 'relayer', 'creditRemote', [rc, []]));
    credited += 500n;
  }
  check('two cages can both send their first transfer',
        (await read(dst, 'chips', [acct.alice.address])) === credited,
        'replay is keyed by the whole receipt, not (chain, nonce)');
}

// ---- NFV-008: changing the oracle cannot strand the cage ------------------
{
  const cage = await deploy({ oracle: acct.oracle.address, float: '1' });
  const dep = keccak256(toHex('nfv:oracle'));
  await wait(await send(cage, 'alice', 'buyIn', [dep, 0n], weiForChips('ETH', 1000)));
  await wait(await send(cage, 'relayer', 'creditLocal', [dep]));

  // Walk the live rate down as far as the guards allow, so switching the oracle
  // off would jump every chip back up to the launch rate.
  for (let i = 0; i < 3; i++) {
    await pub.request({ method: 'evm_increaseTime', params: ['0x258'] });
    await pub.request({ method: 'evm_mine', params: [] });
    const now = await read(cage, 'exitRate');
    try { await wait(await send(cage, 'oracle', 'postRate', [(now * 85n) / 100n])); } catch { break; }
  }

  const before = await read(cage, 'liabilities');
  await wait(await send(cage, 'deployer', 'setOracle', [ZERO]));
  const after = await read(cage, 'liabilities');
  const held = await pub.getBalance({ address: cage });
  check('turning the oracle off leaves the cage solvent', after <= held,
        `${after} owed against ${held} held (was ${before})`);
}

// ---- NFV-010: a burn that never lands comes home --------------------------
{
  const src = await deploy({ float: '1' });
  const dep = keccak256(toHex('nfv:burnback'));
  await wait(await send(src, 'alice', 'buyIn', [dep, 0n], weiForChips('ETH', 500)));
  await wait(await send(src, 'relayer', 'creditLocal', [dep]));

  // Sent to a destination that does not exist.
  const nowhere = '0x000000000000000000000000000000000000dEaD';
  await wait(await send(src, 'alice', 'burnForRemote', [500n, 424242n, nowhere]));
  check('the chips are gone at first', (await read(src, 'chips', [acct.alice.address])) === 0n);

  const early = await revertsWith(() => send(src, 'alice', 'reclaimBurn', [1n, 424242n, nowhere]), 'TooEarly');
  check('and cannot be taken back immediately', early.ok, 'the window is what protects the destination');

  await pub.request({ method: 'evm_increaseTime', params: ['0x69780'] }); // 7h
  await pub.request({ method: 'evm_mine', params: [] });
  await wait(await send(src, 'alice', 'reclaimBurn', [1n, 424242n, nowhere]));
  check('after the window they come back', (await read(src, 'chips', [acct.alice.address])) === 500n);

  const twice = await revertsWith(() => send(src, 'alice', 'reclaimBurn', [1n, 424242n, nowhere]), 'NothingToDo');
  check('but only once', twice.ok);
}

console.log(failures
  ? `\n${failures} FAILED`
  : '\nevery verified exploit is refused, and refused for the reason claimed');
process.exit(failures ? 1 : 0);
