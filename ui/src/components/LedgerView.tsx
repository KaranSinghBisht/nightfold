import type { LedgerEvent } from '../game/types';
import './ledger.css';

const CHAIN_LABEL: Record<LedgerEvent['chain'], string> = {
  midnight: 'Midnight',
  base: 'Base Sepolia',
  solana: 'Solana devnet',
};

interface Props {
  events: LedgerEvent[];
}

/**
 * What the public chains can see. This is the panel that carries the argument:
 * everything here is either an opaque commitment or a number that gives nothing
 * away, and the cards are simply absent.
 */
export function LedgerView({ events }: Props) {
  return (
    <aside className="ledger">
      <header className="ledger__head">
        <h2 className="ledger__title">Public chain view</h2>
        <p className="ledger__sub">Everything an observer can read.</p>
      </header>

      <ol className="ledger__list">
        {events.length === 0 && <li className="ledger__idle">nothing on chain yet</li>}
        {events.map((e, i) => (
          <li key={`${e.label}-${i}`} className="ledger__row">
            <span className={`ledger__chain ledger__chain--${e.chain}`}>{CHAIN_LABEL[e.chain]}</span>
            <span className="ledger__label mono">{e.label}</span>
            <span className={`ledger__detail${e.opaque ? ' ledger__detail--opaque' : ''}`}>
              {e.detail}
            </span>
          </li>
        ))}
      </ol>

      <footer className="ledger__foot">
        <span className="ledger__never">Never on any chain</span>
        <span className="ledger__nevervalue">any card either player held</span>
      </footer>
    </aside>
  );
}
