import { useEffect, useState } from 'react';
import { cashOutTo, chipsOf, chainAvailable } from './chain';
import './cash-out.css';

interface Props {
  address: `0x${string}` | null;
  onClose: () => void;
}

interface Payout {
  nonce: string;
  chips: string;
  sol: string;
  signature: string;
  url: string;
  at: string;
}

type Phase =
  | { at: 'idle' }
  | { at: 'signing' }
  | { at: 'paying'; hash: string }
  | { at: 'paid'; payout: Payout }
  | { at: 'error'; message: string };

/**
 * Leave on a chain you never arrived on.
 *
 * This is the half of the cage that makes it a cage rather than a deposit box.
 * Burning here destroys the chips on THIS chain before anything is paid
 * anywhere — that ordering is what stops one stack being spent on two chains —
 * and the payout that follows is a real Solana devnet transfer with a
 * signature anyone can open in an explorer.
 */
export function CashOut({ address, onClose }: Props) {
  const [live, setLive] = useState(false);
  const [chips, setChips] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('50');
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });

  useEffect(() => { void chainAvailable().then(setLive); }, []);

  useEffect(() => {
    if (!live || !address) return;
    let stop = false;
    const tick = () => { void chipsOf('base', address).then((c) => { if (!stop) setChips(c); }).catch(() => {}); };
    tick();
    const id = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(id); };
  }, [live, address]);

  const want = parseChips(amount);
  const canBurn = live && want !== null && chips !== null && want <= chips && phase.at === 'idle';

  const burn = async () => {
    if (want === null) return;
    // Anchor on the moment of the burn. Matching on "a signature I had not
    // seen" would accept a payout left in the feed by an earlier run.
    const burnedAt = Date.now();
    setPhase({ at: 'signing' });
    try {
      const hash = await cashOutTo('base', 'sol', want);
      setPhase({ at: 'paying', hash });
      // The relayer writes each devnet payout into public/payouts.json, so the
      // page can show the real signature without a backend of its own.
      const found = await pollForPayout(want, burnedAt);
      setPhase(found ? { at: 'paid', payout: found } : {
        at: 'error',
        message: 'Chips burned, but no devnet payout appeared. Is scripts/demo-relayer.mjs running?',
      });
    } catch (err) {
      setPhase({ at: 'error', message: String((err as Error).message ?? err).slice(0, 200) });
    }
  };

  return (
    <div className="cashO" role="dialog" aria-modal="true" aria-label="Cash out">
      <button className="cashO__scrim" onClick={onClose} aria-label="Close" />
      <div className="cashO__win">
        <div className="cashO__head">
          <span className="cashO__headName">CAGE · CASH OUT</span>
          <button className="cashO__x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="cashO__body">
          <div className="cashO__route">
            <span className="cashO__from">BASE</span>
            <span className="cashO__arrow" aria-hidden>→</span>
            <span className="cashO__to">SOLANA devnet</span>
          </div>

          <p className="cashO__blurb">
            You never deposited on Solana. The chips burn here, and the payout lands
            there — a real devnet transaction, not a receipt for one.
          </p>

          <label className="cashO__label" htmlFor="cashout-amount">CHIPS TO BURN</label>
          <input
            id="cashout-amount"
            className="cashO__input mono"
            value={amount}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value)}
            disabled={phase.at !== 'idle'}
          />
          <p className="cashO__held mono">
            {live
              ? chips === null ? 'reading the cage…' : `${chips} chips at the Base cage`
              : 'no chain reachable from this build'}
          </p>

          {phase.at === 'signing' && <p className="cashO__note">Confirm the burn in your wallet…</p>}
          {phase.at === 'paying' && (
            <p className="cashO__note">
              Burned on Base ({phase.hash.slice(0, 12)}…). Paying out on Solana devnet…
            </p>
          )}
          {phase.at === 'error' && <p className="cashO__note cashO__note--bad">{phase.message}</p>}
          {phase.at === 'paid' && (
            <div className="cashO__paid">
              <span className="cashO__paidAmt mono">{phase.payout.sol} SOL</span>
              <span className="cashO__paidCap">paid on Solana devnet</span>
              <a className="cashO__link mono" href={phase.payout.url} target="_blank" rel="noreferrer">
                {phase.payout.signature.slice(0, 24)}… ↗
              </a>
            </div>
          )}
        </div>

        <div className="cashO__foot">
          <button className="cashO__btn cashO__btn--ghost" onClick={onClose}>CLOSE</button>
          <button className="cashO__btn" disabled={!canBurn} onClick={() => void burn()}>
            {phase.at === 'idle' ? 'BURN & PAY OUT ON SOLANA' : 'WORKING…'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Validate at the boundary: a whole, positive, sanely-bounded chip count. */
function parseChips(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const n = BigInt(trimmed);
  return n > 0n ? n : null;
}

/**
 * Poll the payout feed for the burn we just made.
 *
 * Matches on chip count and time rather than nonce: the nonce lives in an
 * event the browser would have to index, and a payout written before this burn
 * started belongs to an earlier run.
 */
async function pollForPayout(chips: bigint, since: number, timeoutMs = 60_000): Promise<Payout | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`/payouts.json?t=${Date.now()}`);
      if (res.ok) {
        const list = (await res.json()) as Payout[];
        const fresh = list.find(
          (p) => p.chips === chips.toString() && Date.parse(p.at) >= since - 5_000,
        );
        if (fresh) return fresh;
      }
    } catch {
      // The feed is a dev-server convenience; a failed read is not fatal.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}
