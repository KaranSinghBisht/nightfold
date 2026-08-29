import { useCallback, useEffect, useState } from 'react';
import { STEPS, LAST_STEP } from './game/script';
import { PHASE_LABEL } from './game/types';
import { SeatPanel } from './components/SeatPanel';
import { PlayingCard } from './components/PlayingCard';
import { LedgerView } from './components/LedgerView';
import './layout.css';

/** Deep-link a beat: ?step=6 jumps straight to the showdown. */
function initialStep(): number {
  const n = Number(new URLSearchParams(window.location.search).get('step'));
  return Number.isInteger(n) && n >= 0 && n <= LAST_STEP ? n : 0;
}

export default function App() {
  const [step, setStep] = useState(initialStep);
  const hand = STEPS[step];

  const next = useCallback(() => setStep((s) => Math.min(s + 1, LAST_STEP)), []);
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  // Arrow keys drive the demo so nothing has to be clicked on camera.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.key === 'r') setStep(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

  return (
    <div className="app">
      <header className="app__head">
        <div className="app__brand">
          <h1 className="app__title">Nightfold</h1>
          <p className="app__tag">The loser never shows their cards.</p>
        </div>
        <div className="app__meta">
          <span className="app__hand mono">hand {hand.handId}</span>
          <span className="app__phase">{PHASE_LABEL[hand.phase]}</span>
        </div>
      </header>

      <main className="app__main">
        <div className="app__table">
          <SeatPanel seat={hand.seats[0]} isYou={hand.you === 0} />

          <section className="felt">
            <span className="felt__label eyebrow">board · public by the rules of poker</span>
            <div className="felt__cards">
              {hand.board.length === 0
                ? <span className="felt__empty">no cards yet</span>
                : hand.board.map((c, i) => (
                    <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="md" delay={i * 70} />
                  ))}
            </div>
            <div className="felt__pot">
              <span className="eyebrow">pot</span>
              <span className="felt__potvalue mono">{hand.pot} ETH</span>
              {hand.winner !== undefined && (
                <span className="felt__winner">
                  → {hand.winner === 2 ? 'split' : hand.seats[hand.winner].name}
                </span>
              )}
            </div>
          </section>

          <SeatPanel seat={hand.seats[1]} isYou={hand.you === 1} />
        </div>

        <LedgerView events={hand.events} />
      </main>

      <footer className="app__foot">
        <div className="app__steps">
          {STEPS.map((_, i) => (
            <button
              key={i}
              className={`app__dot${i === step ? ' app__dot--on' : ''}`}
              onClick={() => setStep(i)}
              aria-label={`step ${i + 1}`}
            />
          ))}
        </div>
        <div className="app__nav">
          <button className="app__btn" onClick={prev} disabled={step === 0}>back</button>
          <button className="app__btn app__btn--primary" onClick={next} disabled={step === LAST_STEP}>
            {step === LAST_STEP ? 'hand complete' : 'next'}
          </button>
        </div>
        <span className="app__hint mono">← → to step · r to reset</span>
      </footer>
    </div>
  );
}
