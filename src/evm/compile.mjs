// Compiles NightfoldEscrow.sol with solc-js.
//
// No foundry, no hardhat — one dependency and a JSON in/JSON out call, which
// keeps the EVM side of this repo to a file you can read in one sitting.

import solc from 'solc';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = 'NightfoldEscrow.sol';

export function compileEscrow() {
  const source = readFileSync(join(root, 'evm', SOURCE), 'utf8');

  const input = {
    language: 'Solidity',
    sources: { [SOURCE]: { content: source } },
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

  const c = out.contracts[SOURCE].NightfoldEscrow;
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { abi, bytecode } = compileEscrow();
  mkdirSync(join(root, 'evm', 'out'), { recursive: true });
  writeFileSync(
    join(root, 'evm', 'out', 'NightfoldEscrow.json'),
    JSON.stringify({ abi, bytecode }, null, 2)
  );
  console.log(`compiled NightfoldEscrow`);
  console.log(`  bytecode : ${(bytecode.length / 2 - 1).toLocaleString()} bytes`);
  console.log(`  functions: ${abi.filter((x) => x.type === 'function').map((x) => x.name).join(', ')}`);
  console.log(`  events   : ${abi.filter((x) => x.type === 'event').map((x) => x.name).join(', ')}`);
}
