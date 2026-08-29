import { useCallback, useEffect, useState } from 'react';
import { startHand, applyAction, resolveShowdown, view, legalActions, type Engine, type Action } from './game/engine';
import { botAction, botShowdown } from './game/bot';
import { rankOf } from './game/rank';
import { PHASE_LABEL } from './game/types';
import { SeatPanel } from './components/SeatPanel';
import { PlayingCard } from './components/PlayingCard';
import { LedgerView } from './components/LedgerView';
import './layout.css';

const YOU = 0 as const;

interface Legal { type: string; amount?: number; min?: number; max?: number }

export function Table() {
  const [engine, setEngine] = useState<Engine>(() => startHand());
  const [thinking, setThinking] = useState(false);

  const { seats, board } = view(engine, YOU);
  const yourTurn = !engine.betting.done && engine.betting.toAct === YOU;
  const atShowdown = engine.phase === 'showdown' && engine.shown[YOU] === null;
  const acts = (yourTurn ? legalActions(engine.betting) : []) as Legal[];
  const pot = engine.betting.pot + engine.betting.committed[0] + engine.betting.committed[1];

  const play = useCallback((a: Action) => setEngine((e) => applyAction(e, a)), []);

  // The bot acts on a short delay so a viewer can follow the hand.
  useEffect(() => {
    if (engine.betting.done || engine.betting.toAct === YOU) return;
    setThinking(true);
    const t = setTimeout(() => {
      setEngine((e) => applyAction(e, botAction(e)));
      setThinking(false);
    }, 700);
    return () => clearTimeout(t);
  }, [engine]);

  // The opponent decides show-or-muck once you have.
  useEffect(() => {
    if (engine.phase !== 'showdown') return;
    if (engine.shown[YOU] === null || engine.shown[1] !== null) return;
    const t = setTimeout(() => {
      setEngine((e) => resolveShowdown(e, 1, botShowdown(e, rankOf), rankOf));
    }, 800);
    return () => clearTimeout(t);
  }, [engine]);

  const showdown = (choice: 'show' | 'muck') =>
    setEngine((e) => resolveShowdown(e, YOU, choice, rankOf));

  return (
    <div className="app">
      <header className="app__head">
        <div className="app__brand">
          <h1 className="app__title">Nightfold</h1>
          <p className="app__tag">The loser never shows their cards.</p>
        </div>
        <div className="app__meta">
          <span className="app__hand mono">deck {engine.deckCommitment}</span>
          <span className="app__phase">{PHASE_LABEL[engine.phase] ?? engine.betting.street}</span>
        </div>
      </header>

      <main className="app__main">
        <div className="app__table">
          <SeatPanel seat={seats[0]} isYou />

          <section className="felt">
            <span className="felt__label eyebrow">
              board · public by the rules of poker
              {thinking && <span className="felt__thinking"> · Bob is thinking</span>}
            </span>
            <div className="felt__cards">
              {board.length === 0
                ? <span className="felt__empty">preflop — no cards yet</span>
                : board.map((c, i) => (
                    <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="md" delay={i * 70} />
                  ))}
            </div>
            <div className="felt__pot">
              <span className="eyebrow">pot</span>
              <span className="felt__potvalue mono">{pot}</span>
              {engine.winner !== null && (
                <span className="felt__winner">
                  → {engine.winner === 2 ? 'split' : seats[engine.winner].name}
                </span>
              )}
            </div>
          </section>

          <SeatPanel seat={seats[1]} isYou={false} />
        </div>

        <LedgerView events={engine.events} />
      </main>

      <footer className="app__foot">
        {atShowdown ? (
          <div className="app__actions">
            <span className="app__prompt">Showdown — show, or muck and reveal nothing.</span>
            <button className="app__btn" onClick={() => showdown('muck')}>muck</button>
            <button className="app__btn app__btn--primary" onClick={() => showdown('show')}>show</button>
          </div>
        ) : yourTurn ? (
          <div className="app__actions">
            {acts.map((a) =>
              a.type === 'bet' || a.type === 'raise' ? (
                <button
                  key={a.type}
                  className="app__btn app__btn--primary"
                  onClick={() => play({ type: a.type as 'bet' | 'raise', amount: a.min! })}
                >
                  {a.type} {a.min}
                </button>
              ) : (
                <button key={a.type} className="app__btn" onClick={() => play({ type: a.type } as Action)}>
                  {a.type}{a.type === 'call' && a.amount ? ` ${a.amount}` : ''}
                </button>
              )
            )}
          </div>
        ) : engine.phase === 'settled' ? (
          <div className="app__actions">
            <span className="app__prompt">
              {engine.shown[0] === 'muck' || engine.shown[1] === 'muck'
                ? 'A hand went into the muck. It is not on any chain, and never will be.'
                : 'Hand complete.'}
            </span>
            <button className="app__btn app__btn--primary" onClick={() => setEngine(startHand())}>
              next hand
            </button>
          </div>
        ) : (
          <span className="app__prompt">waiting for Bob…</span>
        )}
      </footer>
    </div>
  );
}
