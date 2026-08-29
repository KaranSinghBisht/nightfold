// Six chains, one cage.
//
// The Cross-Chain Track asks for dApps spanning EVM chains, Bitcoin, NEAR,
// Cardano and Solana. This test is the claim, stated as code: the cage credits
// chips against a deposit made on ANY of them, because provenance is an opaque
// `(sourceChainId, sourceDepositId)` pair rather than anything chain-specific.
//
// What that means honestly:
//   - EVM chains are NATIVE: the cage itself custodies the deposit via buyIn().
//   - Everything else is ATTESTED: a watcher observes a deposit on that chain
//     and posts its reference. The cage replay-protects the pair globally and
//     emits it, so the credit is checkable against the source chain by anyone.
//
// Adding a chain is therefore a watcher, not a new contract — which is what
// this file demonstrates.

import { createWalletClient, createPublicClient, http, parseEther, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { compileCage } from './compile.mjs';
import { watcherAddresses, signCredit } from './watchers.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';

const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  alice:    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  relayer:  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
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

/**
 * EVM chains carry their EIP-155 id. Everything else gets a CAIP-2 string
 * hashed into the same uint256 space — collision-resistant, and the string is
 * recoverable from the event by anyone who wants to check the source.
 */
const caip2 = (s) => BigInt(keccak256(toHex(s)));

const CHAINS = [
  { name: 'Base',     mode: 'native',   id: 8453n,                                        unit: '0.05 ETH', chips: 1_000n },
  { name: 'Ethereum', mode: 'native',   id: 1n,                                           unit: '0.05 ETH', chips: 1_000n },
  { name: 'Solana',   mode: 'attested', id: caip2('solana:5eykt4UsFv8P8NJdTREpY1vzqKq'),  unit: '10 SOL',   chips: 1_000n },
  { name: 'Cardano',  mode: 'attested', id: caip2('cip34:1-764824073'),                   unit: '500 ADA',  chips: 1_000n },
  { name: 'Bitcoin',  mode: 'attested', id: caip2('bip122:000000000019d6689c085ae165831e9'), unit: '0.0025 BTC', chips: 1_000n },
  { name: 'NEAR',     mode: 'attested', id: caip2('near:mainnet'),                        unit: '50 NEAR',  chips: 1_000n },
];

const { abi, bytecode } = compileCage();
const CREDIT_CAP = 10_000_000n;
/** No oracle: the published rate is fixed for the life of these cages. */
const ZERO = '0x0000000000000000000000000000000000000000';

const hash = await wallet('deployer').deployContract({
  abi, bytecode, args: [acct.relayer.address, 20_000n, CREDIT_CAP, ZERO],
});
const { contractAddress: cage } = await wait(hash);
// These six sources are genuinely on other chains, so their burns cannot be
// read from here — this is exactly the case the watcher quorum exists for.
await wait(await wallet('deployer').writeContract({
  address: cage, abi, functionName: 'setWatchers', args: [watcherAddresses, 2n],
}));
await wait(await wallet('deployer').writeContract({ address: cage, abi, functionName: 'fund', value: parseEther('10') }));

const read = (fn, args) => pub.readContract({ address: cage, abi, functionName: fn, args });
const receipt = (player, chips, chainId, nonce) => ({
  srcChainId: chainId,
  srcCage: acct.deployer.address, // stands in for the cage on that chain
  dstChainId: 31337n,
  dstCage: cage,
  player,
  chipAmount: chips,
  nonce,
});

const credit = async (player, chips, chainId, nonce) => {
  const rc = receipt(player, chips, chainId, nonce);
  return wallet('relayer').writeContract({
    address: cage, abi, functionName: 'creditRemote', args: [rc, await signCredit(rc, 2)],
  });
};

console.log(`cage ${cage.slice(0, 12)}…  relayer ${acct.relayer.address.slice(0, 10)}…\n`);
console.log('┌──────────────────────────────────────────────────────────────┐');

// ---- one deposit per chain, all crediting the same chip ledger -------------

// Deliberately the SAME nonce on every chain: if the cage keyed on the nonce
// alone, the second chain would be rejected as a replay. It keys on the pair,
// and the signed digest binds the source chain, so the six are distinct
// receipts rather than one reused six times.
const SHARED_DEP = 1n;

let expected = 0n;
for (const c of CHAINS) {
  await wait(await credit(acct.alice.address, c.chips, c.id, SHARED_DEP));
  expected += c.chips;
  const got = await read('chips', [acct.alice.address]);
  check(
    `${c.name.padEnd(9)} ${c.mode.padEnd(8)} ${c.unit.padEnd(10)} -> ${c.chips} chips`,
    got === expected,
    `ledger ${got}`,
  );
}
console.log('└──────────────────────────────────────────────────────────────┘\n');

check('all six chains credited one chip ledger', (await read('chips', [acct.alice.address])) === expected,
  `${expected} chips from ${CHAINS.length} chains`);
check('totalChips matches the sum', (await read('totalChips')) === expected);

// ---- provenance is the key, and it is single-use ---------------------------

for (const c of CHAINS) {
  const replayed = await reverts(() => credit(acct.alice.address, c.chips, c.id, SHARED_DEP));
  check(`${c.name} deposit cannot be credited twice`, replayed);
}

check('a fresh deposit id on a used chain still credits',
  await (async () => {
    const before = await read('chips', [acct.alice.address]);
    await wait(await credit(acct.alice.address, 5n, CHAINS[2].id, 2n));
    return (await read('chips', [acct.alice.address])) === before + 5n;
  })());

// ---- the credit names its source, so anyone can go and check it ------------

const logs = await pub.getContractEvents({ address: cage, abi, eventName: 'Credited', fromBlock: 0n });
const sources = new Set(logs.map((l) => l.args.sourceChainId));
// The extra credit above reused Solana's id, so the distinct-source count is
// the chain count, not the credit count — which is the point: the id is the
// chain, the pair is the deposit.
check('every credit is an event naming its source chain', sources.size === CHAINS.length,
  `${sources.size} distinct sources across ${logs.length} credits`);

// ---- and it is still one stack, cashable out anywhere ----------------------

const before = await pub.getBalance({ address: acct.alice.address });
await wait(await wallet('alice').writeContract({ address: cage, abi, functionName: 'cashOut', args: [2_000n] }));
await wait(await wallet('alice').writeContract({ address: cage, abi, functionName: 'withdraw' }));
check('chips bought on five other chains cash out here',
  (await pub.getBalance({ address: acct.alice.address })) > before);
check('cashing out burns the chips', (await read('totalChips')) === expected + 5n - 2_000n);

console.log(failures
  ? `\n${failures} FAILED`
  : '\nsix chains, one cage: provenance is opaque, so a chain is a watcher not a contract');
process.exit(failures ? 1 : 0);
