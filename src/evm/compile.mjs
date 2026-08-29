// Compiles NightfoldEscrow.sol with solc-js.
//
// No foundry, no hardhat — one dependency and a JSON in/JSON out call, which
// keeps the EVM side of this repo to a file you can read in one sitting.

import solc from 'solc';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Compile any contract in evm/ by file and contract name. */
export function compileContract(file, contractName) {
  const source = readFileSync(join(root, 'evm', file), 'utf8');

  const input = {
    language: 'Solidity',
    sources: { [file]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };

  const out = JSON.parse(solc.compile(JSON.stringify(input)));

  const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length) {
    for (const e of errors) console.error(e.formattedMessage);
    throw new Error(`${errors.length} Solidity error(s)`);
  }
  for (const w of (out.errors ?? []).filter((e) => e.severity === 'warning')) {
    console.warn('warning:', w.formattedMessage.trim().split('\n')[0]);
  }

  const c = out.contracts[file][contractName];
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}

export const compileEscrow = () => compileContract('NightfoldEscrow.sol', 'NightfoldEscrow');
export const compileCage = () => compileContract('NightfoldCage.sol', 'NightfoldCage');

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(join(root, 'evm', 'out'), { recursive: true });
  for (const [file, name] of [
    ['NightfoldEscrow.sol', 'NightfoldEscrow'],
    ['NightfoldCage.sol', 'NightfoldCage'],
  ]) {
    const { abi, bytecode } = compileContract(file, name);
    writeFileSync(join(root, 'evm', 'out', `${name}.json`), JSON.stringify({ abi, bytecode }, null, 2));
    console.log(`\ncompiled ${name}`);
    console.log(`  bytecode : ${(bytecode.length / 2 - 1).toLocaleString()} bytes`);
    console.log(`  functions: ${abi.filter((x) => x.type === 'function').map((x) => x.name).join(', ')}`);
  }
}

export const compileFakeCage = () => compileContract('FakeCage.sol', 'FakeCage');
