// Put a real cage on the local chain and tell the UI where it is.
//
// The site used to narrate deposits. This deploys the actual NightfoldCage the
// test suite exercises, funds it, and writes the address into ui/src/arcade so
// the browser can sign a real transaction against it. Nothing about the cage is
// demo-specific — it is the same contract, with the same guards.
//
//   anvil --silent &
//   node scripts/demo-deploy.mjs

import { writeFileSync } from 'node:fs';
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

import { compileCage } from '../src/evm/compile.mjs';
import { watcherAddresses } from '../src/evm/watchers.mjs';
import { chipsPerToken } from '../src/pricing.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';

// Anvil's published dev accounts. Account 0 deploys and operates; account 3 is
// the relayer, so the relayer key is NOT the deployer key even locally.
const DEPLOYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const RELAYER  = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';

const deployer = privateKeyToAccount(DEPLOYER);
const relayer = privateKeyToAccount(RELAYER);
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = createWalletClient({ account: deployer, chain: foundry, transport: http(RPC) });
const wait = (hash) => pub.waitForTransactionReceipt({ hash });

const cage = compileCage();

/** Deploy one cage, wire its watcher quorum, and fill its reserves. */
async function deployCage(label, ticker, reserveEth) {
  const { contractAddress } = await wait(await wallet.deployContract({
    abi: cage.abi,
    bytecode: cage.bytecode,
    args: [relayer.address, chipsPerToken(ticker), 10_000_000n,
           '0x0000000000000000000000000000000000000000'],
  }));

  const call = (functionName, args, value) => wallet.writeContract({
    address: contractAddress, abi: cage.abi, functionName, args, ...(value ? { value } : {}),
  });

  await wait(await call('setWatchers', [watcherAddresses, 2n]));
  await wait(await call('fund', [], parseEther(reserveEth)));

  console.log(`  ${label.padEnd(6)} ${contractAddress}  ${reserveEth} ETH reserves  ` +
              `${chipsPerToken(ticker)} chips/${ticker}`);
  return contractAddress;
}

console.log(`deploying cages to ${RPC}\n`);
const base = await deployCage('BASE', 'ETH', '50');
const sol = await deployCage('SOL', 'SOL', '50');

// Each cage must know the other before it will honour a remote receipt, and
// registration is behind a governance delay — so the demo does it up front
// rather than discovering it mid-recording.
const register = async (on, other) => {
  const call = (functionName, args) => wallet.writeContract({
    address: on, abi: cage.abi, functionName, args });
  await wait(await call('proposeCage', [other]));
};
await register(base, sol);
await register(sol, base);
await pub.request({ method: 'evm_increaseTime', params: ['0x15180'] }); // 24h
await pub.request({ method: 'evm_mine', params: [] });
for (const [on, other] of [[base, sol], [sol, base]]) {
  await wait(await wallet.writeContract({
    address: on, abi: cage.abi, functionName: 'activateCage', args: [other] }));
}
console.log('\n  both cages registered with each other (governance delay served)');

const out = {
  rpc: RPC,
  chainId: foundry.id,
  relayer: relayer.address,
  cages: { base, sol },
  abi: cage.abi,
};
writeFileSync('ui/src/arcade/deployed.json', JSON.stringify(out, null, 2) + '\n');
console.log('  wrote ui/src/arcade/deployed.json');
console.log(`\n  cage reserves: ${formatEther(await pub.getBalance({ address: base }))} ETH (base), ` +
            `${formatEther(await pub.getBalance({ address: sol }))} ETH (sol)`);
