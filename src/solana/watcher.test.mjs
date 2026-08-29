// The Solana watcher, against the real chain.
//
// The point of this file is that it does not test a mock. It pulls live
// transactions off Solana devnet and runs the parser over them, because the
// bug this whole path replaces was precisely a thing that looked right and had
// never met real data.
//
// Devnet is a third party, so the network-dependent checks SKIP rather than
// fail when it is unreachable — a flaky endpoint is not a regression. The
// parser checks and the end-to-end cage credit run regardless.

import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { rpc, reachable, DEVNET, SolanaRpcError } from './rpc.mjs';
import { readDeposits, parseDeposit, chipsForLamports, receiptFor, LAMPORTS } from './watcher.mjs';
import { DEPOSIT_ADDRESS, MEMO_PROGRAM, SOLANA_DEVNET_CAIP2 } from './config.mjs';
import { compileCage } from '../evm/compile.mjs';
import { watcherAddresses, signCredit } from '../evm/watchers.mjs';
import { chipsPerToken } from '../pricing.mjs';
import { keccak256, toHex } from 'viem';

let failures = 0;
let skipped = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? '  — ' + detail : ''}`);
};
const skip = (name, why) => { skipped++; console.log(`  --  ${name}  — skipped: ${why}`); };

const EVM = '0x9F2cA1E4B6d3705e8AC0f2b21B4Dd7C0E1a94d81';
const RATE = chipsPerToken('SOL');

// ---- the parser, on shapes that must never be credited ----------------------
{
  const transfer = (dest, lamports, memo) => ({
    slot: 1, meta: { err: null },
    transaction: { message: { instructions: [
      { program: 'system', parsed: { type: 'transfer', info: { source: 'PLAYER', destination: dest, lamports } } },
      ...(memo === undefined ? [] : [{ program: 'spl-memo', parsed: memo }]),
    ] } },
  });

  check('a transfer in with a valid memo is a deposit',
        parseDeposit(transfer('CAGE', 5_000_000, EVM), 'CAGE')?.lamports === 5_000_000n);
  check('a transfer to somewhere else is not',
        parseDeposit(transfer('ELSEWHERE', 5_000_000, EVM), 'CAGE') === null);
  check('a transfer with no memo is not',
        parseDeposit(transfer('CAGE', 5_000_000, undefined), 'CAGE') === null,
        'there is nobody to credit, and guessing is how money goes to the wrong account');
  check('a memo that is not an address is not',
        parseDeposit(transfer('CAGE', 5_000_000, 'hello'), 'CAGE') === null);
  check('a memo that is nearly an address is not',
        parseDeposit(transfer('CAGE', 5_000_000, EVM.slice(0, -1)), 'CAGE') === null,
        'one character short');
  check('a failed transaction is not',
        parseDeposit({ ...transfer('CAGE', 5_000_000, EVM), meta: { err: { some: 'error' } } }, 'CAGE') === null);
  check('a zero-value transfer is not',
        parseDeposit(transfer('CAGE', 0, EVM), 'CAGE') === null);

  // Two transfers in one transaction should be summed, not counted once.
  const doubled = transfer('CAGE', 1_000_000, EVM);
  doubled.transaction.message.instructions.unshift(
    { program: 'system', parsed: { type: 'transfer', info: { source: 'PLAYER', destination: 'CAGE', lamports: 2_000_000 } } });
  check('multiple transfers in one transaction are summed',
        parseDeposit(doubled, 'CAGE')?.lamports === 3_000_000n);
}

// ---- conversion floors, like the cage does ---------------------------------
{
  check('a whole SOL converts at the published rate',
        chipsForLamports(LAMPORTS, RATE) === BigInt(RATE), `1 SOL = ${RATE} chips`);
  check('dust floors rather than rounding up',
        chipsForLamports(1n, RATE) === 0n,
        'a lamport is not a chip; the cage keeps the remainder');
  check('half a SOL is half the chips',
        chipsForLamports(LAMPORTS / 2n, RATE) === BigInt(RATE) / 2n);
}

// ---- the real chain --------------------------------------------------------
const live = await reachable();

if (!live) {
  skip('reads real devnet transactions', 'devnet unreachable');
  skip('parses a real memo instruction', 'devnet unreachable');
  skip('reads the cage deposit address', 'devnet unreachable');
} else {
  const slot = await rpc('getSlot');
  check('devnet is live', typeof slot === 'number' && slot > 0, `slot ${slot}`);

  // Pull real transactions that used the memo program and confirm the parser
  // reads the memo the same way the chain records it.
  const sigs = await rpc('getSignaturesForAddress', [MEMO_PROGRAM, { limit: 5 }]);
  const usable = (sigs ?? []).filter((s) => !s.err).slice(0, 3);

  if (usable.length === 0) {
    skip('parses a real memo instruction', 'no recent memo transactions');
  } else {
    let sawMemo = 0;
    let sawTransfer = 0;
    for (const s of usable) {
      const tx = await rpc('getTransaction',
        [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      const ixs = tx?.transaction?.message?.instructions ?? [];
      if (ixs.some((i) => i.program === 'spl-memo')) sawMemo++;
      if (ixs.some((i) => i.program === 'system' && i.parsed?.type === 'transfer')) sawTransfer++;

      // Whatever these transactions are, none of them is a deposit to our cage,
      // and the parser has to say so on real data rather than only on fixtures.
      check(`a real transaction is not mistaken for a deposit (${s.signature.slice(0, 8)}…)`,
            parseDeposit(tx, DEPOSIT_ADDRESS) === null);
    }
    check('the parser reads real memo instructions', sawMemo > 0,
          `${sawMemo}/${usable.length} carried a memo the chain encoded`);
  }

  // And the cage's own address, live.
  const deposits = await readDeposits(DEPOSIT_ADDRESS, { limit: 10 });
  check('reads the cage deposit address without error', Array.isArray(deposits),
        deposits.length === 0
          ? 'no deposits yet — fund the player and run npm run solana:deposit'
          : `${deposits.length} real deposit(s) found`);

  for (const d of deposits) {
    check(`a real deposit names an EVM account (${d.signature.slice(0, 8)}…)`,
          /^0x[0-9a-fA-F]{40}$/.test(d.player),
          `${Number(d.lamports) / Number(LAMPORTS)} SOL -> ${chipsForLamports(d.lamports, RATE)} chips`);
  }
}

// ---- a Solana deposit becomes chips on the EVM cage -------------------------
//
// This is the join the whole path exists for: a receipt built from Solana data,
// signed by watchers, credited by the cage, and cashed out.
{
  const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
  const KEYS = {
    deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    relayer: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  };
  const acct = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, privateKeyToAccount(v)]));
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
  const wallet = (a) => createWalletClient({ account: acct[a], chain: foundry, transport: http(RPC) });
  const wait = (h) => pub.waitForTransactionReceipt({ hash: h });

  const { abi, bytecode } = compileCage();
  const ZERO = '0x0000000000000000000000000000000000000000';
  const { contractAddress: cage } = await wait(await wallet('deployer').deployContract({
    abi, bytecode, args: [acct.relayer.address, chipsPerToken('ETH'), 10_000_000n, ZERO] }));
  await wait(await wallet('deployer').writeContract({
    address: cage, abi, functionName: 'setWatchers', args: [watcherAddresses, 2n] }));
  await wait(await wallet('deployer').writeContract({
    address: cage, abi, functionName: 'fund', value: parseEther('5') }));

  // A deposit as the watcher reports it. Where devnet gave us a real one we use
  // it; otherwise the shape is identical and the signature is a real devnet
  // signature format, so the only thing standing in is the funding.
  const realDeposits = live ? await readDeposits(DEPOSIT_ADDRESS, { limit: 1 }) : [];
  const deposit = realDeposits[0] ?? {
    signature: '4RwT1kZ8xN6qBvHy2mJc9dLpQfWnXeSrAtGuYoPiKbVc3ZhMdNjEwUxFgTrLsQaBcDeFgHiJkLmNoPqRsTuVwXyZ',
    slot: 0, from: 'CKAWFC49YwmeQ2oe4X4GjKeXgKSzimH24yqc5wG7gK5a',
    lamports: 50_000_000n, player: EVM, memo: EVM,
  };

  const receipt = receiptFor(deposit, {
    srcChainId: BigInt(keccak256(toHex(`caip2:${SOLANA_DEVNET_CAIP2}`))),
    srcCage: acct.deployer.address,
    dstChainId: 31337n,
    dstCage: cage,
    chipsPerSol: RATE,
    nonce: 1n,
  });

  check('a deposit converts to a whole number of chips',
        receipt.chipAmount === chipsForLamports(deposit.lamports, RATE),
        `${Number(deposit.lamports) / Number(LAMPORTS)} SOL -> ${receipt.chipAmount} chips`);
  check('the receipt names the Solana transaction that caused it',
        typeof receipt.solanaSignature === 'string' && receipt.solanaSignature.length > 40,
        realDeposits[0] ? 'a real devnet signature' : 'shape verified; fund the address for a live one');

  const { solanaSignature, ...signable } = receipt;
  await wait(await wallet('relayer').writeContract({
    address: cage, abi, functionName: 'creditRemote', args: [signable, await signCredit(signable, 2)] }));

  const chips = await pub.readContract({ address: cage, abi, functionName: 'chips', args: [EVM] });
  check('the EVM cage credits a Solana deposit', chips === receipt.chipAmount,
        `${chips} chips on chain`);

  // And the same deposit cannot be credited twice.
  let replayed = false;
  try {
    await wait(await wallet('relayer').writeContract({
      address: cage, abi, functionName: 'creditRemote', args: [signable, await signCredit(signable, 2)] }));
    replayed = true;
  } catch { /* expected */ }
  check('and cannot be credited twice', !replayed, 'one Solana transaction, one credit');
}

console.log(failures
  ? `\n${failures} FAILED`
  : `\nsolana watcher: reads the real chain${skipped ? ` (${skipped} network check(s) skipped)` : ''}`);
process.exit(failures ? 1 : 0);
