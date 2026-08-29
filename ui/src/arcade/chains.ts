/**
 * The chains the cage knows about.
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

export type ChainMode = 'native' | 'attested';

export interface Chain {
  id: string;
  name: string;
  ticker: string;
  /** short label for the ASCII lanes, where two chains can share a ticker */
  short: string;
  colour: string;
  mode: ChainMode;
  /** chips per whole unit of the native asset */
  rate: string;
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
  { id: 'base', short: 'BASE', name: 'Base', ticker: 'ETH', colour: '#0052FF', mode: 'native', rate: '20,000', mark: BASE },
  { id: 'ethereum', short: 'ETH', name: 'Ethereum', ticker: 'ETH', colour: '#627EEA', mode: 'native', rate: '20,000', mark: ETHEREUM },
  { id: 'solana', short: 'SOL', name: 'Solana', ticker: 'SOL', colour: '#9945FF', mode: 'attested', rate: '100', mark: SOLANA },
  { id: 'cardano', short: 'ADA', name: 'Cardano', ticker: 'ADA', colour: '#3468D1', mode: 'attested', rate: '2', mark: CARDANO },
  { id: 'bitcoin', short: 'BTC', name: 'Bitcoin', ticker: 'BTC', colour: '#F7931A', mode: 'attested', rate: '400,000', mark: BITCOIN },
  { id: 'near', short: 'NEAR', name: 'NEAR', ticker: 'NEAR', colour: '#00EC97', mode: 'attested', rate: '20', mark: NEAR },
];
