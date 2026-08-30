// Does a real deposit get credited on this machine, right now?
//
// The browser's deposit and this one take the same path — payable buyIn, then
// a relayer holding a different key calls creditLocal. If this passes, the one
// on camera will too. It deliberately stops before the Solana leg, which
// spends real devnet SOL.

import { createWalletClient, createPublicClient, http, keccak256, toHex, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { readFileSync } from 'node:fs';
import { weiForChips } from '../src/pricing.mjs';

const d = JSON.parse(readFileSync('ui/src/arcade/deployed.json', 'utf8'));
// Anvil account 9 — not a seat any other script uses, so a preflight never
// disturbs the balance the demo is about to show on camera.
const player = privateKeyToAccount('0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6');
const pub = createPublicClient({ chain: foundry, transport: http(d.rpc) });
const w = createWalletClient({ account: player, chain: foundry, transport: http(d.rpc) });
const chips = () => pub.readContract({
  address: d.cages.base, abi: d.abi, functionName: 'chips', args: [player.address] });

const WANT = 5n;
const before = await chips();
const value = weiForChips('ETH', WANT);

await pub.waitForTransactionReceipt({
  hash: await w.writeContract({
    address: d.cages.base, abi: d.abi, functionName: 'buyIn',
    args: [keccak256(toHex(`preflight-${Date.now()}`)), 0n], value }),
});

for (let i = 0; i < 30; i++) {
  if ((await chips()) >= before + WANT) {
    console.log(`${formatEther(value)} ETH credited as ${WANT} chips in under ${i + 1}s`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.error('the relayer did not credit the deposit within 30s');
process.exit(1);
