import { useMemo, useState } from 'react';
import { PixelMark } from './PixelMark';
import { CHAINS, chipsForUnits, rawUnitsForChips, usdOfChips, rateOf, priceOf, changeOf, sparkOf, type Chain } from './chains';
import { Sparkline } from './Sparkline';
import './cage-modal.css';

export interface BuyIn {
  chain: Chain;
  units: number;
  chips: number;
}

interface Props {
  onClose: () => void;
  onConfirm: (buy: BuyIn) => void;
}

/** Chip stacks a player might actually sit down with. */
const STACKS = [500, 1000, 2500];

/**
 * The cage window: pick a chain, say how much, see exactly what it buys.
 *
 * The conversion is the real one — the same derived rate the contracts use —
 * so what this shows is what a live cage would credit. The deposit itself is
 * simulated, and the footer says so rather than leaving it implied.
 */
export function CageModal({ onClose, onConfirm }: Props) {
  const [chain, setChain] = useState<Chain>(CHAINS[0]);
  const [raw, setRaw] = useState(() => String(round(rawUnitsForChips(CHAINS[0].ticker, 1000))));

  const units = parseAmount(raw);
  const chips = units === null ? 0 : chipsForUnits(chain.ticker, units);
  const valid = units !== null && chips > 0;

  const pick = (next: Chain) => {
    setChain(next);
    setRaw(String(round(rawUnitsForChips(next.ticker, chips > 0 ? chips : 1000))));
  };

  const setStack = (target: number) => setRaw(String(round(rawUnitsForChips(chain.ticker, target))));

  const note = useMemo(
    () =>
      chain.mode === 'native'
        ? 'NATIVE — NightfoldCage.sol runs on this chain and holds the deposit itself.'
        : chain.mode === 'watched'
        ? 'WATCHED — no cage runs here, but a real watcher reads this chain over RPC and reports deposits it has actually seen. npm run solana:watch.'
        : 'ATTESTED — no cage and no watcher yet. The cage would verify a signed claim about this chain; nothing produces one.',
    [chain],
  );

  return (
    <div className="cageM" role="dialog" aria-modal="true" aria-label="Buy chips">
      <button className="cageM__scrim" onClick={onClose} aria-label="Close" />
      <div className="cageM__win">
        <div className="cageM__head">
          <span className="cageM__headName">CAGE · BUY CHIPS</span>
          <button className="cageM__x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="cageM__body">
          <span className="cageM__label">BRING</span>
          <div className="cageM__markets">
            {CHAINS.map((c) => {
              const change = changeOf(c);
              return (
                <button
                  key={c.id}
                  className={`cageM__mkt${c.id === chain.id ? ' cageM__mkt--on' : ''}`}
                  onClick={() => pick(c)}
                  style={c.id === chain.id ? { borderColor: c.colour } : undefined}
                >
                  <span className="cageM__mktMark" style={{ color: c.colour }}>
                    <PixelMark grid={c.mark} size={18} />
                  </span>
                  <span className="cageM__mktName">
                    <b>{c.name.toUpperCase()}</b>
                    {/* The answer to "what do I get", on the row itself. */}
                    <em>{rateOf(c)}</em>
                  </span>
                  <Sparkline points={sparkOf(c)} change={change} />
                  <span className="cageM__mktPrice">
                    <b>{priceOf(c)}</b>
                    <em className={change >= 0 ? 'cageM__up' : 'cageM__down'}>
                      {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                    </em>
                  </span>
                </button>
              );
            })}
          </div>

          <span className="cageM__label">AMOUNT</span>
          <div className="cageM__amount">
            <input
              className="cageM__input"
              value={raw}
              inputMode="decimal"
              onChange={(e) => setRaw(e.target.value)}
              aria-label={`Amount in ${chain.ticker}`}
            />
            <span className="cageM__ticker" style={{ color: chain.colour }}>{chain.ticker}</span>
          </div>

          <div className="cageM__stacks">
            {STACKS.map((s) => (
              <button key={s} className="cageM__stackBtn" onClick={() => setStack(s)}>
                {s.toLocaleString('en-US')} chips
              </button>
            ))}
          </div>

          <div className={`cageM__out${valid ? '' : ' cageM__out--bad'}`}>
            {valid ? (
              <>
                <span className="cageM__chips">{chips.toLocaleString('en-US')}</span>
                <span className="cageM__chipsCap">CHIPS · {usdOfChips(chips)}</span>
              </>
            ) : (
              <span className="cageM__chipsCap">Enter an amount above zero.</span>
            )}
          </div>

          <p className="cageM__note">{note}</p>
          <p className="cageM__sim">
            Rates are the ones the contracts use. No transaction is broadcast in this
            build.
          </p>
        </div>

        <div className="cageM__foot">
          <button className="cageM__btn cageM__btn--ghost" onClick={onClose}>CANCEL</button>
          <button
            className="cageM__btn"
            disabled={!valid}
            onClick={() => valid && onConfirm({ chain, units: units as number, chips })}
          >
            BUY CHIPS
          </button>
        </div>
      </div>
    </div>
  );
}

/** Validate at the boundary: a finite, positive, sanely-bounded number or null. */
function parseAmount(raw: string): number | null {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) return null;
  return n;
}

/**
 * Round the amount UP to a displayable number of places.
 *
 * The cage floors chips, so an amount rounded DOWN buys fewer chips than the
 * preset promises — clicking "2,500 chips" and being seated with 2,497 is the
 * kind of small wrongness that reads as broken. Rounding up costs the player a
 * fraction of a cent and always delivers at least the stack they asked for.
 */
function round(units: number): number {
  const dp = units < 1 ? 6 : units < 1000 ? 4 : 2;
  const scale = 10 ** dp;
  return Math.ceil(units * scale) / scale;
}
