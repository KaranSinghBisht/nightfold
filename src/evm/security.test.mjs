// The EVM exploits the 2026-08-29 audit confirmed, re-run against the fixed
// contracts. Each must now fail.
//
//   NF-001  the relayer emptied a funded cage with no deposit and no game
//   NF-006  the escrow paid whatever winner the relayer named
//   NF-008  a seat contract that rejects transfers trapped the other stake

import { createWalletClient, createPublicClient, http, parseEther, formatEther, keccak256, toHex, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { compileContract } from './compile.mjs';
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
const wait = (h) => pub.waitForTransactionReceipt({ hash: h });

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

const cage = compileContract('NightfoldCage.sol', 'NightfoldCage');
const escrow = compileContract('NightfoldEscrow.sol', 'NightfoldEscrow');
const rejecting = compileContract('RejectingSeat.sol', 'RejectingSeat');

async function deploy(art, args, who = 'deployer') {
  const hash = await wallet(who).deployContract({ abi: art.abi, bytecode: art.bytecode, args });
  return (await wait(hash)).contractAddress;
}

// ---- NF-001: the cage drain -------------------------------------------------

console.log('\nNF-001 — relayer drained a funded cage with no deposit\n');
{
  const RATE = 20_000n;
  const CAP = 10_000_000n;
  // No oracle: this suite is about the relayer's authority, not pricing.
  const addr = await deploy(cage, [acct.relayer.address, RATE, CAP, '0x0000000000000000000000000000000000000000']);
  await wait(await wallet('deployer').writeContract({
    address: addr, abi: cage.abi, functionName: 'setWatchers', args: [watcherAddresses, 2n],
  }));
  await wait(await wallet('deployer').writeContract({
    address: addr, abi: cage.abi, functionName: 'fund', value: parseEther('1'),
  }));

  const call = (who, fn, args, value) =>
    wallet(who).writeContract({ address: addr, abi: cage.abi, functionName: fn, args, ...(value ? { value } : {}) });
  const read = (fn, args) => pub.readContract({ address: addr, abi: cage.abi, functionName: fn, args });

  const funded = await pub.getBalance({ address: addr });
  check('cage is funded', funded === parseEther('1'), formatEther(funded) + ' ETH');

  // The exact audit exploit: relayer names itself and an amount, no deposit.
  check('relayer cannot cash out on behalf of anyone',
        await reverts(() => call('relayer', 'cashOut', [chipsOf(parseEther('1'), RATE)])),
        'cashOut burns the CALLER\'s chips; the relayer holds none');

  check('relayer holds no chips', (await read('chips', [acct.relayer.address])) === 0n);
  check('cage balance untouched', (await pub.getBalance({ address: addr })) === parseEther('1'));

  // The re-audit's RA-001 showed the old version of this test stopped one call
  // short of the money: the relayer credited itself, the test admired the
  // event, and nobody cashed out. Credit now needs a receipt the relayer
  // cannot author, and it may not name itself at all.
  const rc = {
    srcChainId: 999n, srcCage: acct.mallory.address, dstChainId: 31337n, dstCage: addr,
    player: acct.relayer.address, chipAmount: 1000n, nonce: 1n,
  };
  check('relayer cannot credit with no signatures',
        await reverts(() => call('relayer', 'creditRemote', [rc, []])));
  check('relayer cannot credit itself even with a full quorum',
        await reverts(async () => call('relayer', 'creditRemote', [rc, await signCredit(rc, 3)])),
        'a relayer that can pay itself can drain the cage');

  const toMallory = { ...rc, player: acct.mallory.address };
  await wait(await call('relayer', 'creditRemote', [toMallory, await signCredit(toMallory, 2)]));
  check('a quorum-signed credit is recorded with its provenance',
        (await read('chips', [acct.mallory.address])) === 1000n);
  check('the same receipt cannot be credited twice',
        await reverts(async () => call('relayer', 'creditRemote', [toMallory, await signCredit(toMallory, 2)])),
        'global replay protection');
  check('a credit that outruns reserves is refused',
        await reverts(async () => {
          const huge = { ...toMallory, chipAmount: CAP, nonce: 9n };
          return call('relayer', 'creditRemote', [huge, await signCredit(huge, 2)]);
        }),
        'solvency, not just an epoch cap');

  // Honest flow still works, and cashing out is pull-based.
  const dep = keccak256(toHex('dep:alice'));
  await wait(await call('alice', 'buyIn', [dep, 0n], parseEther('0.05')));
  await wait(await call('relayer', 'creditLocal', [dep]));
  check('a local deposit credits the depositor', (await read('chips', [acct.alice.address])) === 1000n);

  check('you cannot burn chips you do not have',
        await reverts(() => call('alice', 'cashOut', [5000n])));

  await wait(await call('alice', 'cashOut', [1000n]));
  check('chips are burned on cash-out', (await read('chips', [acct.alice.address])) === 0n);
  const owed = await read('withdrawable', [acct.alice.address]);
  check('proceeds are queued for pull withdrawal', owed === parseEther('0.05'), formatEther(owed) + ' ETH');

  const before = await pub.getBalance({ address: acct.alice.address });
  await wait(await call('alice', 'withdraw', []));
  check('withdrawal pays the holder', (await pub.getBalance({ address: acct.alice.address })) > before);
}

function chipsOf(wei, rate) { return (wei * rate) / (10n ** 18n); }

// ---- NF-006: escrow trusted any winner --------------------------------------

console.log('\nNF-006 — escrow paid whatever winner the relayer named\n');
{
  const addr = await deploy(escrow, [acct.relayer.address]);
  const call = (who, fn, args, value) =>
    wallet(who).writeContract({ address: addr, abi: escrow.abi, functionName: fn, args, ...(value ? { value } : {}) });
  const read = (fn, args) => pub.readContract({ address: addr, abi: escrow.abi, functionName: fn, args });

  const handId = keccak256(toHex('hand:nf006'));
  const STAKE = parseEther('0.05');
  await wait(await call('alice', 'openHand', [handId], STAKE));
  await wait(await call('bob', 'joinHand', [handId], STAKE));

  // The audit passed an invented attestation and the escrow paid.
  check('an invented attestation is rejected',
        await reverts(() => call('relayer', 'proposeSettlement', [handId, 1, keccak256(toHex('made up'))])),
        'must equal H("nf:payout:", handId, H(winner))');
  check('a zero attestation is rejected',
        await reverts(() => call('relayer', 'proposeSettlement', [handId, 1, `0x${'0'.repeat(64)}`])));

  // An attestation for the WRONG winner cannot be used to pay the other seat.
  const attFor0 = await read('expectedAttestation', [handId, 0]);
  check('an attestation for seat 0 cannot settle seat 1',
        await reverts(() => call('relayer', 'proposeSettlement', [handId, 1, attFor0])),
        'the attestation commits to the winner');

  const attFor1 = await read('expectedAttestation', [handId, 1]);
  await wait(await call('relayer', 'proposeSettlement', [handId, 1, attFor1]));
  check('a matching attestation is accepted', Number((await read('hands', [handId]))[5]) === 3);

  check('funds are not payable during the challenge window',
        await reverts(() => call('alice', 'finaliseSettlement', [handId])));

  await jump(601);
  await wait(await call('alice', 'finaliseSettlement', [handId]));
  check('bob is credited after the window',
        (await read('withdrawable', [acct.bob.address])) === STAKE * 2n);
  check('a stranger cannot settle', await reverts(() => call('mallory', 'proposeSettlement', [handId, 0, attFor0])));
}

// ---- NF-008: a rejecting seat blocked refunds -------------------------------

console.log('\nNF-008 — a rejecting seat trapped the honest stake\n');
{
  const addr = await deploy(escrow, [acct.relayer.address]);
  const hostile = await deploy(rejecting, []);

  const handId = keccak256(toHex('hand:nf008'));
  const STAKE = parseEther('0.01');

  // The hostile contract takes a seat.
  await wait(await wallet('mallory').writeContract({
    address: hostile, abi: rejecting.abi, functionName: 'call',
    args: [addr, encodeFunctionData({ abi: escrow.abi, functionName: 'openHand', args: [handId] })],
    value: STAKE,
  }));
  await wait(await wallet('alice').writeContract({
    address: addr, abi: escrow.abi, functionName: 'joinHand', args: [handId], value: STAKE,
  }));

  await jump(3601);

  // Previously this reverted and rolled back BOTH refunds.
  await wait(await wallet('alice').writeContract({
    address: addr, abi: escrow.abi, functionName: 'timeout', args: [handId],
  }));
  check('timeout succeeds despite a rejecting seat', true);

  const owed = await pub.readContract({ address: addr, abi: escrow.abi, functionName: 'withdrawable', args: [acct.alice.address] });
  check('the honest player is credited', owed === STAKE, formatEther(owed) + ' ETH');

  const before = await pub.getBalance({ address: acct.alice.address });
  await wait(await wallet('alice').writeContract({ address: addr, abi: escrow.abi, functionName: 'withdraw', args: [] }));
  check('and can withdraw independently', (await pub.getBalance({ address: acct.alice.address })) > before);

  check('the hostile seat can only fail its own withdrawal',
        await reverts(() => wallet('mallory').writeContract({
          address: hostile, abi: rejecting.abi, functionName: 'call',
          args: [addr, encodeFunctionData({ abi: escrow.abi, functionName: 'withdraw', args: [] })],
        })),
        'its own revert, nobody else\'s money');
}

console.log(failures === 0
  ? '\nevery confirmed EVM exploit is now rejected'
  : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
