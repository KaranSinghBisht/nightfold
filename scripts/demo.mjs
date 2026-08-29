// One command for the terminal half of the demo.
//
// Runs the two things worth watching, live, in the order they make sense:
// what a published rank actually leaks, and then a whole hand moving across
// three chains. Nothing here is pre-recorded and nothing is stubbed — it is
// the same code `npm run check` runs, printed at a pace a camera can follow.
//
//   npm run demo          # needs anvil on :8545
//
// Real ZK proofs are deliberately NOT in here: they take about two minutes and
// deserve their own shot. That is `npm run proof:real`.

import { spawn } from 'node:child_process';

const BAR = '━'.repeat(72);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = (script) =>
  new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', script], { stdio: 'inherit' });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)));
    child.on('error', reject);
  });

async function beat(title, subtitle, script) {
  console.log(`\n${BAR}\n  ${title}\n  ${subtitle}\n${BAR}\n`);
  await sleep(1200);
  await run(script);
  await sleep(1800);
}

console.log(`
   ▄▖▄▖▄▖▖▖▄▖▄▖▖ ▄▖
   ▙ ▐ ▌▌▙▌▐ ▌▌▌ ▌▌   NIGHTFOLD
   ▌ ▟▖▙▌▌▌▐ ▙▌▙▖▙▌   cross-chain hold'em where the losing hand is never revealed
`);
await sleep(1500);

try {
  await beat(
    '1 · WHY PUBLISHING A RANK IS NOT PRIVACY',
    'a rank is decoded back into the hand, then the muck leaves nothing behind',
    'check:muck');

  await beat(
    '2 · ONE HAND, END TO END, ACROSS THREE CHAINS',
    'ETH and SOL in · betting on chain · showdown on Midnight · out on a chain the winner never used',
    'check:loop');

  console.log(`\n${BAR}`);
  console.log('  that was live. two more, if there is time:');
  console.log('    npm run check        348 assertions, every exploit the audits executed');
  console.log('    npm run proof:real   the same hand with real ZK proofs (~108s)');
  console.log(`${BAR}\n`);
} catch (err) {
  // A demo that fails should say so loudly rather than look like it ended.
  console.error(`\n  DEMO FAILED: ${err.message}`);
  console.error('  is anvil running on :8545?  ->  anvil --silent &\n');
  process.exit(1);
}
