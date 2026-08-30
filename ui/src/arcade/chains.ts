/**
 * The chains the cage knows about.
 *
 * The split is not a ranking, it is a fact about where code can run.
 * NightfoldCage.sol is Solidity, so it deploys unchanged to any EVM chain and
 * genuinely custodies the deposit there. No other chain can run it: Solana
 * needs a Rust program, Cardano needs Plutus, NEAR needs its own contract, and
 * Bitcoin cannot hold one at all. Until those exist, a deposit on those chains
 * is vouched for rather than held.
 *
 * `mode` is the honest distinction, and it is a property of the cage contract
 * rather than marketing:
 *
 *   native     — the cage contract itself custodies the deposit. `buyIn()` is
 *                payable, so the chips are minted against value the cage holds.
 *                Every EVM chain shares one bytecode, so this is one adapter.
 *   attested   — a watcher observes a deposit on that chain and calls
 *                `credit(player, chips, sourceChainId, sourceDepositId)`. The
 *                cage replay-protects that pair globally and emits it, so the
 *                claim is checkable on the source chain by anyone.
 *
 * The cage never needed to know which chain a deposit came from — provenance is
 * just a pair of opaque values — which is why adding a chain is a watcher and
 * not a new contract.
 */

import pricing from '../../../pricing.json';

/**
 * Rates are DERIVED, never chosen. A chip is the unit of account, so every
 * chain's rate is its asset's USD price over the chip price. Rates chosen per
 * chain would disagree, and disagreeing rates are free money — buy chips where
 * they are cheap, cash out where they are dear. src/evm/pricing.test.mjs is the
 * regression test, and it reads this same file.
 */
export const CHIP_USD = pricing.chipUsd;
const USD: Record<string, number> = pricing.assets;

const chipsPerToken = (ticker: string) => Math.round(USD[ticker] / CHIP_USD);

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Three honest states, not two.
 *
 *   native    NightfoldCage.sol runs on this chain and holds the deposit.
 *   watched   No cage here, but a real watcher reads the chain and reports
 *             deposits it has actually seen. src/solana/watcher.mjs.
 *   attested  Neither. The cage would accept a signed claim about this chain;
 *             nothing produces those claims yet.
 */
export type ChainMode = 'native' | 'watched' | 'attested';

export interface Chain {
  id: string;
  name: string;
  ticker: string;
  /** short label for the ASCII lanes, where two chains can share a ticker */
  short: string;
  colour: string;
  mode: ChainMode;
  mark: string[];
}

const BITCOIN = [
  '..#..#......',
  '..#..#......',
  '.#######....',
  '.##....##...',
  '.##....##...',
  '.#######....',
  '.##....##...',
  '.##....##...',
  '.#######....',
  '..#..#......',
  '..#..#......',
  '............',
];

const ETHEREUM = [
  '.....##.....',
  '....####....',
  '...######...',
  '..########..',
  '.##########.',
  '...######...',
  '............',
  '.##########.',
  '..########..',
  '...######...',
  '....####....',
  '.....##.....',
];

const BASE = [
  '............',
  '...#####....',
  '..#######...',
  '.########...',
  '#########...',
  '#########...',
  '#########...',
  '#########...',
  '.########...',
  '..#######...',
  '...#####....',
  '............',
];

const CARDANO = [
  '............',
  '...#....#...',
  '............',
  '.#...##...#.',
  '.....##.....',
  '..#.####.#..',
  '..#.####.#..',
  '.....##.....',
  '.#...##...#.',
  '............',
  '...#....#...',
  '............',
];

const SOLANA = [
  '............',
  '..#########.',
  '.#########..',
  '............',
  '............',
  '.#########..',
  '..#########.',
  '............',
  '............',
  '..#########.',
  '.#########..',
  '............',
];

const NEAR = [
  '............',
  '##########..',
  '#........#..',
  '#.#....#.#..',
  '#.##...#.#..',
  '#.#.#..#.#..',
  '#.#..#.#.#..',
  '#.#...##.#..',
  '#.#....#.#..',
  '#........#..',
  '##########..',
  '............',
];

export const MIDNIGHT_MARK = [
  '...#####....',
  '.##.....##..',
  '.#...#...#..',
  '#....#....#.',
  '#....#....#.',
  '#.........#.',
  '#....#....#.',
  '#....#....#.',
  '.#...#...#..',
  '.##.....##..',
  '...#####....',
  '............',
];

export const CHAINS: Chain[] = [
  { id: 'base', short: 'BASE', name: 'Base', ticker: 'ETH', colour: '#0052FF', mode: 'native', mark: BASE },
  { id: 'ethereum', short: 'ETH', name: 'Ethereum', ticker: 'ETH', colour: '#627EEA', mode: 'native', mark: ETHEREUM },
  { id: 'solana', short: 'SOL', name: 'Solana', ticker: 'SOL', colour: '#9945FF', mode: 'watched', mark: SOLANA },
  { id: 'cardano', short: 'ADA', name: 'Cardano', ticker: 'ADA', colour: '#3468D1', mode: 'attested', mark: CARDANO },
  { id: 'bitcoin', short: 'BTC', name: 'Bitcoin', ticker: 'BTC', colour: '#F7931A', mode: 'attested', mark: BITCOIN },
  { id: 'near', short: 'NEAR', name: 'NEAR', ticker: 'NEAR', colour: '#00EC97', mode: 'attested', mark: NEAR },
];

/** "1 SOL = 1,000 chips" — the string the rail shows, derived not typed. */
export const rateOf = (c: Chain) => {
  const n = chipsPerToken(c.ticker);
  return `1 ${c.ticker} = ${fmt(n)} ${n === 1 ? 'chip' : 'chips'}`;
};

/** "$103.20" — what one unit of that asset is worth at the snapshot. */
export const usdOf = (c: Chain) => `$${fmt(USD[c.ticker])}`;

/**
 * "1.94 SOL" — how much of an asset buys `chips`. Derived, so the examples on
 * the page cannot drift away from the rates beside them the way hand-typed
 * ones did.
 */
export function rawUnitsForChips(ticker: string, chips: number): number {
  return (chips * CHIP_USD) / USD[ticker];
}

export function unitsForChips(ticker: string, chips: number): string {
  const units = rawUnitsForChips(ticker, chips);
  const dp = units < 0.01 ? 4 : units < 1 ? 3 : 2;
  return `${Number(units.toFixed(dp))} ${ticker}`;
}

/** How many chips `units` of an asset buys. The cage floors, so this does too. */
export function chipsForUnits(ticker: string, units: number): number {
  return Math.floor((units * USD[ticker]) / CHIP_USD);
}

/** What a chip stack is worth, as "$200". */
export const usdOfChips = (chips: number) => `$${fmt(Math.round(chips * CHIP_USD))}`;

export const SNAPSHOT = pricing.snapshotUtc;

const CHANGE: Record<string, number> = pricing.change24h ?? {};
const SPARK: Record<string, number[]> = pricing.spark ?? {};

/** Signed 24h move for a chain's asset, at the snapshot. */
export const changeOf = (c: Chain) => CHANGE[c.ticker] ?? 0;

/** Seven days of price for the picker's sparkline. */
export const sparkOf = (c: Chain) => SPARK[c.ticker] ?? [];

/** "$2,435.00" — priced the way a market would show it. */
export function priceOf(c: Chain): string {
  const v = USD[c.ticker];
  const dp = v >= 100 ? 2 : v >= 1 ? 3 : 4;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}


/**
 * The exact wei that buys `chips`, rounded UP.
 *
 * Mirrors weiForChips in src/pricing.mjs, which the browser cannot import
 * because that module reads pricing.json off disk. Both derive from the same
 * committed table, and both round the same direction for the same reason: the
 * cage floors `chips = amount * rate / 1e18`, so an amount a hair light buys
 * one chip fewer, and a player who asks for 2,500 should not be seated with
 * 2,499. The dust stays with the cage.
 */
export function weiForChips(ticker: string, chips: bigint | number): bigint {
  const rate = BigInt(chipsPerToken(ticker));
  const c = BigInt(chips);
  return (c * 10n ** 18n + rate - 1n) / rate;
}
