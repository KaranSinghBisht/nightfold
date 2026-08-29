import { useCallback, useEffect, useRef, useState } from 'react';
import { startHand, applyAction, resolveShowdown, view, legalActions, type Engine, type Action } from './game/engine';
import { botAction, botShowdown } from './game/bot';
import { rankOf, handName } from './game/rank';
import { Felt } from './components/Felt';
import { ChainRail, type SessionStats } from './components/ChainRail';
import './layout.css';

const YOU = 0 as const;

interface Legal { type: string; amount?: number; min?: number; max?: number }

/**
 * Fast-forward to a beat for recording: #play?demo=muck lands on the settled
 * muck, #play?demo=showdown on the show-or-muck decision. Checks the hand down
 * so no betting randomness gets in the way of the shot.
 */
function initialEngine(): Engine {
  const demo = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('demo');
  if (!demo) return startHand();
  let e = startHand(0);
  let guard = 0;
  while (!e.betting.done && guard++ < 30) {
    const acts = legalActions(e.betting) as Legal[];
    e = applyAction(e, acts.some((a) => a.type === 'check') ? { type: 'check' } : { type: 'call' });
  }
  if (demo === 'muck' && e.phase === 'showdown') {
    e = resolveShowdown(e, 0, 'muck', rankOf);
  }
  return e;
}

export function Table() {
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [thinking, setThinking] = useState(false);
  const [stats, setStats] = useState<SessionStats>({ hands: 1, settled: 0, commitments: 2, mucked: 0 });
  const settledFor = useRef<string | null>(null);

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
    }, 750);
    return () => clearTimeout(t);
  }, [engine]);

  // The opponent decides show-or-muck once you have.
  useEffect(() => {
    if (engine.phase !== 'showdown') return;
    if (engine.shown[YOU] === null || engine.shown[1] !== null) return;
    const t = setTimeout(() => {
      setEngine((e) => resolveShowdown(e, 1, botShowdown(e, rankOf), rankOf));
    }, 850);
    return () => clearTimeout(t);
  }, [engine]);

  // Session tallies for the chain rail's stat tiles.
  useEffect(() => {
    if (engine.phase !== 'settled' || settledFor.current === engine.handId) return;
    settledFor.current = engine.handId;
    const mucks = engine.shown.filter((s) => s === 'muck').length;
    setStats((s) => ({ ...s, settled: s.settled + 1, mucked: s.mucked + mucks }));
  }, [engine]);

  const nextHand = () => {
    setEngine(startHand(Math.random() < 0.5 ? 0 : 1, [engine.betting.stacks[0], engine.betting.stacks[1]]));
    setStats((s) => ({ ...s, hands: s.hands + 1, commitments: s.commitments + 2 }));
  };

  const showdown = (choice: 'show' | 'muck') =>
    setEngine((e) => resolveShowdown(e, YOU, choice, rankOf));

  const yourHand = engine.revealed >= 3
    ? handName([...engine.hole[YOU], ...engine.board.slice(0, engine.revealed)])
    : undefined;

  return (
    <div className="desk">
      <header className="desk__bar">
        <a className="desk__brand" href="#/">
          <span className="desk__wordmark">Nightfold</span>
          <span className="desk__tag">the loser never shows</span>
        </a>
        <div className="desk__meta mono">
          <span className="desk__deck" title="deck commitment, published before the deal">
            deck {engine.deckCommitment}
          </span>
          <span className="desk__phase">{engine.phase === 'settled' ? 'settled' : engine.betting.street}</span>
        </div>
      </header>

      <main className="desk__grid">
        {/* ---- the cage ---- */}
        <aside className="cage">
          <header className="cage__head">
            <h2 className="cage__title">The cage</h2>
            <p className="cage__sub">Chips are the unit of account. Buy in with anything, cash out with anything.</p>
          </header>

          <div className="cage__stack">
            <span className="cage__stackNum mono">{engine.betting.stacks[YOU].toLocaleString()}</span>
            <span className="cage__stackCap">your chips</span>
          </div>

          <div className="cage__rates">
            <div className="cage__rate">
              <span className="cage__chain mono" style={{ color: 'var(--base-blue)' }}>BASE</span>
              <span className="cage__rateVal mono">1 ETH = 20,000</span>
            </div>
            <div className="cage__rate">
              <span className="cage__chain mono" style={{ color: 'var(--sol-purple)' }}>SOLANA</span>
              <span className="cage__rateVal mono">1 SOL = 100</span>
            </div>
          </div>

          <div className="cage__ins">
            <div className="cage__in">
              <span>Alice bought in</span>
              <span className="mono">0.05 ETH → 1,000</span>
            </div>
            <div className="cage__in">
              <span>Bob bought in</span>
              <span className="mono">10 SOL → 1,000</span>
            </div>
          </div>

          <p className="cage__note">
            Same stack, fair game — whichever chain the money came from. The winner
            can cash out on a chain they never deposited to.
          </p>

          <div className="cage__blinds mono">blinds 1 / 2</div>
        </aside>

        {/* ---- the felt ---- */}
        <div className="desk__center">
          <Felt
            seats={seats}
            you={YOU}
            board={board}
            street={engine.phase === 'settled' ? 'hand over' : engine.betting.street}
            pot={pot}
            winner={engine.winner}
            button={engine.betting.button as 0 | 1}
            toAct={engine.betting.done ? null : (engine.betting.toAct as 0 | 1)}
            thinking={thinking}
            yourHand={yourHand}
          />

          <div className="desk__actions">
            {atShowdown ? (
              <>
                <span className="desk__prompt">Showdown — show your rank, or muck and reveal nothing.</span>
                <button className="act act--quiet" onClick={() => showdown('muck')}>muck</button>
                <button className="act act--primary" onClick={() => showdown('show')}>show</button>
              </>
            ) : yourTurn ? (
              <>
                <span className="desk__prompt">your action</span>
                {acts.map((a) =>
                  a.type === 'bet' || a.type === 'raise' ? (
                    <button
                      key={a.type}
                      className="act act--primary"
                      onClick={() => play({ type: a.type as 'bet' | 'raise', amount: a.min! })}
                    >
                      {a.type} {a.min}
                    </button>
                  ) : (
                    <button
                      key={a.type}
                      className={`act${a.type === 'fold' ? ' act--danger' : ''}`}
                      onClick={() => play({ type: a.type } as Action)}
                    >
                      {a.type}{a.type === 'call' && a.amount ? ` ${a.amount}` : ''}
                    </button>
                  )
                )}
              </>
            ) : engine.phase === 'settled' ? (
              <>
                <span className="desk__prompt">
                  {engine.shown.includes('muck')
                    ? 'A hand went into the muck. It is not on any chain, and never will be.'
                    : 'Hand complete.'}
                </span>
                <button className="act act--primary" onClick={nextHand}>next hand</button>
              </>
            ) : (
              <span className="desk__prompt">waiting for Bob…</span>
            )}
          </div>
        </div>

        {/* ---- the chain rail ---- */}
        <ChainRail events={engine.events} stats={stats} />
      </main>
    </div>
  );
}
