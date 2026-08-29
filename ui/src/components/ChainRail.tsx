import type { LedgerEvent } from '../game/types';
import './chainrail.css';

const CHAIN_LABEL: Record<LedgerEvent['chain'], string> = {
  midnight: 'MIDNIGHT',
  base: 'BASE',
  ethereum: 'ETHEREUM',
  solana: 'SOLANA',
  cardano: 'CARDANO',
  bitcoin: 'BITCOIN',
  near: 'NEAR',
};

export interface SessionStats {
  hands: number;
  settled: number;
  commitments: number;
  mucked: number;
}

interface Props {
  events: LedgerEvent[];
  stats: SessionStats;
}

/**
 * Everything an observer of the public chains can read — and, rendered as
 * redaction blocks, the fields they cannot. The blocks are a constant glyph
 * string: the value they stand in for is never in the DOM.
 */
export function ChainRail({ events, stats }: Props) {
  const feed = [...events].reverse();

  return (
    <aside className="rail">
      <header className="rail__head">
        <span className="rail__dot" />
        <div>
          <h2 className="rail__title">Public chain view</h2>
          <p className="rail__sub">Everything below is exactly what the chains can see. Nothing more.</p>
        </div>
      </header>

      <div className="rail__tiles">
        <div className="rail__tile"><span className="rail__num mono">{stats.hands}</span><span className="rail__cap">hands dealt</span></div>
        <div className="rail__tile"><span className="rail__num mono">{stats.settled}</span><span className="rail__cap">settled</span></div>
        <div className="rail__tile"><span className="rail__num mono">{stats.commitments}</span><span className="rail__cap">commitments</span></div>
        <div className="rail__tile"><span className="rail__num mono">{stats.mucked}</span><span className="rail__cap">hands mucked</span></div>
      </div>

      <span className="rail__feedLabel eyebrow">live feed</span>
      <ol className="rail__feed">
        {feed.length === 0 && <li className="rail__idle mono">nothing on chain yet</li>}
        {feed.map((e, i) => (
          <li key={`${events.length - i}`} className={`rail__row${i === 0 ? ' rail__row--new' : ''}`}>
            <div className="rail__rowHead">
              <span className={`rail__pill rail__pill--${e.chain}`}>{e.label}</span>
              <span className={`rail__chain rail__chain--${e.chain} mono`}>{CHAIN_LABEL[e.chain]}</span>
            </div>
            <span className={`rail__detail${e.opaque ? ' mono' : ''}`}>{e.detail}</span>
            {e.masked && (
              <span className="rail__masked">
                {e.masked.map((f) => (
                  <span key={f} className="rail__maskPair">
                    <span className="rail__maskName mono">{f}</span>
                    <span className="rail__mask" aria-label="hidden">██████</span>
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ol>

      <footer className="rail__foot">
        <span className="rail__never mono">never on any chain</span>
        <span className="rail__neverWhat">any card either player held</span>
      </footer>
    </aside>
  );
}
