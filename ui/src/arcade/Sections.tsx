import { motion, useReducedMotion } from 'framer-motion';
import { PixelMark } from './PixelMark';
import { AsciiCage } from './AsciiCage';
import { CHAINS, rateOf, usdOf, unitsForChips, usdOfChips, CHIP_USD, SNAPSHOT } from './chains';
import { TICKER, ENDINGS, PROTOCOL, LANES, STATS } from './copy';
import './sections.css';

const EASE = [0.16, 1, 0.3, 1] as const;

/** One shared scroll-in, so sections arrive as sections and not as 30 pieces. */
function useReveal() {
  const reduced = useReducedMotion();
  return (i = 0) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 22 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: '-70px' },
          transition: { delay: i * 0.09, duration: 0.65, ease: EASE },
        };
}

export function Ticker() {
  return (
    <div className="arcTick">
      <div className="arcTick__row">
        {TICKER.map((t) => (
          <span className="arcTick__item" key={t}>
            <span className="arcTick__pip" />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Endings() {
  const reveal = useReveal();
  return (
    <section className="arcSec" id="endings">
      <div className="arc__inner">
        <motion.div className="arcSec__head" {...reveal()}>
          <span className="arcSec__kicker">AT SHOWDOWN</span>
          <h2 className="arc__h2">3 WAYS TO END A HAND</h2>
          <div className="arc__rule" />
          <p className="arc__lede" style={{ textAlign: 'center' }}>
            Two of them leave the ledger with nothing readable about what you were
            holding. That is the whole game.
          </p>
        </motion.div>

        <div className="arcEnd">
          {ENDINGS.map((e, i) => (
            <motion.div
              className={`arcEnd__item${e.tone === 'best' ? ' arcEnd__item--best' : ''}`}
              key={e.name}
              {...reveal(i)}
            >
              <div className="arcEnd__frame">
                <span className="arcEnd__n">{e.n}</span>
                <PixelMark grid={e.glyph} size={42} />
              </div>
              <h3 className="arcEnd__name">{e.name}</h3>
              <span className="arcEnd__circuit">{e.circuit}()</span>
              <p className="arcEnd__text">{e.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Protocol() {
  const reveal = useReveal();
  return (
    <section className="arcSec arcSec--panel">
      <div className="arc__inner">
        <motion.div className="arcSec__head" {...reveal()}>
          <h2 className="arc__h2 arc__h2--phos">THE MUCK PROTOCOL</h2>
          <div className="arc__rule" />
          <p className="arc__lede" style={{ textAlign: 'center' }}>
            Nightfold deals from a committed deck and keeps the hole cards
            client-side as Midnight witnesses. The ledger sees commitments and, at
            most, a single number.
          </p>
        </motion.div>

        <div className="arcProto">
          {PROTOCOL.map((p, i) => (
            <motion.div className="arcProto__card" key={p.name} {...reveal(i)}>
              <span className="arcProto__icon">
                <PixelMark grid={p.glyph} size={22} />
              </span>
              <h3 className="arcProto__name">{p.name}</h3>
              <p className="arcProto__text">{p.text}</p>
            </motion.div>
          ))}
        </div>

        <motion.p className="arcNote" {...reveal(1)}>
          A packed rank encodes the category <b>and</b> every tiebreaker, so
          publishing one publishes the hand. <code>2169397</code> decodes to
          "two pair, aces and kings, nine kicker." That is exactly why the other
          two endings exist.
        </motion.p>
      </div>
    </section>
  );
}

export function Cage() {
  const reveal = useReveal();
  return (
    <section className="arcSec" id="cage">
      <div className="arc__inner">
        <div className="arcCage">
          <motion.div className="arcCage__ascii" {...reveal()}>
            <div className="arcCage__head">
              <span className="arcCage__headName">CAGE_LEDGER_#0A4F</span>
              <span className="arcCage__headProof">CONSERVATION: PER CAGE</span>
            </div>
            <div className="arcCage__screen">
              <AsciiCage />
            </div>
          </motion.div>

          <motion.div className="arcCage__body" {...reveal(1)}>
            <div className="arcSec__head arcSec__head--left" style={{ marginBottom: 0 }}>
              <span className="arcSec__kicker">THE CAGE</span>
              <h2 className="arc__h2">
                BUY IN ANYWHERE.
                <br />
                <span style={{ color: 'var(--phos)' }}>CASH OUT ANYWHERE.</span>
              </h2>
              <div className="arc__rule" />
            </div>
            <p className="arc__lede">
              A card room does not let you bet dollars against euros — you buy chips
              at the cage and settle up on the way out. Every rate below is derived
              from one price table, never chosen per chain: a chip costs ${CHIP_USD.toFixed(2)}{' '}
              whichever chain you bring. Rates that disagree are free money, so
              they are not allowed to.{' '}
              <b>NATIVE</b> means the cage contract runs on that chain and holds the
              deposit — every EVM chain, from one Solidity file. <b>WATCHED</b> means
              no cage runs there but a real watcher reads the chain and reports
              deposits it has seen. <b>ATTESTED</b> means neither yet.
            </p>
            <div className="arcChains">
              {CHAINS.map((c, i) => (
                <motion.div className="arcChain" key={c.id} {...reveal(i * 0.4)}>
                  <span className="arcChain__mark" style={{ color: c.colour }}>
                    <PixelMark grid={c.mark} size={20} />
                  </span>
                  <span className="arcChain__text">
                    <span className="arcChain__name">{c.name}</span>
                    <span className="arcChain__rate">{rateOf(c)} <span className="arcChain__usd">· {usdOf(c)}</span></span>
                  </span>
                  <span className={`arcChain__mode arcChain__mode--${c.mode}`}>
                    {c.mode === 'native' ? 'NATIVE' : c.mode === 'watched' ? 'WATCHED' : 'ATTESTED'}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        <motion.div className="arcCage__strip" {...reveal(2)}>
          <span className="arcCage__stripRow">
            <b style={{ color: '#0052FF' }}>BASE</b> {unitsForChips('ETH', 1000)} → 1,000 chips
          </span>
          <span className="arcCage__stripRow">
            <b style={{ color: '#9945FF' }}>SOLANA</b> {unitsForChips('SOL', 1000)} → 1,000 chips
          </span>
          <span className="arcCage__stripRow arcCage__stripRow--pot">2,000 CHIPS IN PLAY</span>
          <span className="arcCage__stripRow">
            <b style={{ color: '#9945FF' }}>SOLANA</b> 1,850 chips → {unitsForChips('SOL', 1850)}
          </span>
        </motion.div>
        <motion.p className="arcCage__punch" {...reveal(2)}>
          Alice bought in on Base. She left on Solana. Both buy-ins are worth the
          same {usdOfChips(1000)}, neither cage ever held both assets, and the chip
          ledger conserves across all six. Prices snapshotted{' '}
          {SNAPSHOT.slice(0, 10)} — <code>npm run prices</code> refreshes them, and a
          deployed cage tracks an oracle rather than this file.
        </motion.p>
      </div>
    </section>
  );
}

interface FootProps {
  onPlay: () => void;
}

export function Lanes({ onPlay }: FootProps) {
  const reveal = useReveal();
  return (
    <>
      <section className="arcSec arcSec--panel">
        <div className="arc__inner">
          <motion.div className="arcSec__head" {...reveal()}>
            <span className="arcSec__kicker">ARCHITECTURE</span>
            <h2 className="arc__h2">EACH CHAIN DOES ONE JOB</h2>
            <div className="arc__rule" />
          </motion.div>
          <div className="arcLanes">
            {LANES.map((l, i) => (
              <motion.div className="arcLane" key={l.name} {...reveal(i)}>
                <h3 className="arcLane__name">{l.name}</h3>
                <p className="arcLane__text">{l.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <footer className="arcFoot">
        <div className="arcFoot__band">
          <div>
            <h3 className="arcFoot__title">POWERED BY MIDNIGHT · SIX MONEY CHAINS</h3>
            <p className="arcFoot__text">
              Compact circuits hold the cards and fast chains hold the money. Two
              audits found eighteen issues between them and a third pass found six of them
              still open, including two that empty the cage. This is a simulator with
              a trusted dealer and a trusted committee, and it should not hold real
              money. The README and docs/security.md carry the current status and the
              runnable proofs rather than a summary that flatters it.
            </p>
          </div>
          <div className="arcFoot__stats">
            {STATS.map((s) => (
              <div className="arcFoot__stat" key={s.label}>
                <span className="arcFoot__val">{s.value}</span>
                <span className="arcFoot__cap">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="arcFoot__end">
          <button className="arc__btn" onClick={onPlay}>PLAY A HAND</button>
          <p className="arcFoot__note">
            Built for the Midnight Hackathon, August 2026. The README documents what
            is proven, what is simulated, and what the dealer can still see —{' '}
            <a href="https://github.com/KaranSinghBisht/nightfold/blob/main/docs/security.md">docs/security.md</a>{' '}
            records three audits, what each one found, and what is still trusted rather than proven. Card art by{' '}
            <a href="https://kenney.nl">Kenney</a>, CC0.
          </p>
        </div>
      </footer>
    </>
  );
}
