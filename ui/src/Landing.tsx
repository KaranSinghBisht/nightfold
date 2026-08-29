import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { PlayingCard } from './components/PlayingCard';
import AcidSquares from './components/AcidSquares';
import './landing.css';

interface Props {
  onPlay: () => void;
}

/** One entrance, choreographed — not six things arriving independently. */
const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.08 * i, duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  }),
};

const sectionIn: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] } },
};

const SHOWDOWN = [
  { name: 'show', code: 'revealHand', text: 'Publish your rank and claim the pot. What a winner normally does.', tone: '' },
  { name: 'beat it', code: 'beatOpponent', text: 'Prove you beat the rank already on the table — without publishing your own.', tone: 'mid' },
  { name: 'muck', code: 'muckHand', text: 'Concede. No cards, no rank, no proof of holdings. Nothing at all.', tone: 'best' },
];

const LANES = [
  { name: 'Base & Solana', text: 'Cages hold the money. Betting settles in seconds and costs almost nothing.' },
  { name: 'Midnight', text: 'Hole cards live client-side as witnesses. Only commitments and a rank ever touch the ledger.', mid: true },
  { name: 'The relayer', text: 'Carries a proven outcome between them. It can stall; it cannot take your money or name a winner the hand did not produce.' },
];

export function Landing({ onPlay }: Props) {
  const reduced = useReducedMotion();
  const reveal = reduced
    ? {}
    : { initial: 'hidden' as const, whileInView: 'show' as const, viewport: { once: true, margin: '-80px' }, variants: sectionIn };

  return (
    <div className="land">
      {/* ---- hero ---- */}
      <header className="land__hero">
        <div className="land__bg">
          <AcidSquares
            className="land__canvas"
            color1="#0B0F14"
            color2="#6E7A88"
            color3="#C6CFD8"
            speed={0.7}
            waveDepth={1}
            zoom={1.3}
            density={10}
            glow={1}
            exposure={2700}
            spread={0.3}
            stepSize={0.002}
            contrast={1}
            brightness={1}
            opacity={1}
            mouseInteraction
            mouseStrength={0.1}
            mouseRadius={0.35}
            grain
            grainIntensity={0.05}
          />
          <div className="land__scrim" />
        </div>

        <nav className="land__nav">
          <span className="land__wordmark">Nightfold</span>
          <div className="land__navLinks mono">
            <a href="#play" onClick={(e) => { e.preventDefault(); onPlay(); }}>table</a>
            <span aria-hidden>·</span>
            <a href="https://github.com/KaranSinghBisht/nightfold">code</a>
          </div>
          <motion.button
            className="land__enter mono"
            onClick={onPlay}
            whileHover={reduced ? undefined : { scale: 1.03 }}
            whileTap={reduced ? undefined : { scale: 0.98 }}
          >
            ENTER THE TABLE →
          </motion.button>
        </nav>

        <div className="land__heroBody">
          <motion.div
            className="land__heroText"
            initial={reduced ? undefined : 'hidden'}
            animate={reduced ? undefined : 'show'}
          >
            <motion.span className="land__eyebrow mono" variants={rise} custom={0}>
              heads-up hold'em · cross-chain chips · midnight commitments
            </motion.span>

            <h1 className="land__title">
              <motion.span className="land__t1" variants={rise} custom={1}>
                win the pot.
              </motion.span>
              <motion.span className="land__t2" variants={rise} custom={2}>
                show nothing.
              </motion.span>
            </h1>

            <motion.p className="land__sub" variants={rise} custom={3}>
              Real poker lets you fold face-down and keep what you were holding.
              Every on-chain poker game publishes it forever. Nightfold doesn't.
            </motion.p>

            <motion.div className="land__cta" variants={rise} custom={4}>
              <motion.button
                className="land__play"
                onClick={onPlay}
                whileHover={reduced ? undefined : { scale: 1.03 }}
                whileTap={reduced ? undefined : { scale: 0.98 }}
              >
                Play a hand
              </motion.button>
              <a className="land__repo" href="#how">How it stays private</a>
            </motion.div>
          </motion.div>

          <motion.figure
            className="land__heroCards"
            initial={reduced ? undefined : { opacity: 0, y: 24 }}
            animate={reduced ? undefined : { opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            aria-label="a shown hand beside a mucked one"
          >
            <div className="land__cardGroup">
              <PlayingCard card={{ rank: 'A', suit: 's' }} size="lg" />
              <PlayingCard card={{ rank: 'K', suit: 'h' }} size="lg" delay={80} />
              <figcaption className="land__cap land__cap--won mono">shown · won the pot</figcaption>
            </div>
            <div className="land__cardGroup">
              <PlayingCard mucked size="lg" delay={160} />
              <PlayingCard mucked size="lg" delay={240} />
              <figcaption className="land__cap land__cap--muck mono">mucked · never published</figcaption>
            </div>
          </motion.figure>
        </div>

        <motion.div
          className="land__brackets mono"
          aria-hidden
          initial={reduced ? undefined : { opacity: 0 }}
          animate={reduced ? undefined : { opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.9 }}
        >
          <span>DEAL&nbsp;&nbsp;&nbsp;&nbsp;[ COMMITTED · VERIFIABLE ]</span>
          <span>SHOWDOWN&nbsp;[ RANK · OR NOTHING ]</span>
          <span>CAGE&nbsp;&nbsp;&nbsp;&nbsp;[ ANY CHAIN · ONE STACK ]</span>
        </motion.div>
      </header>

      {/* ---- the problem ---- */}
      <motion.section className="land__section" id="how" {...reveal}>
        <div className="land__col">
          <h2 className="land__h2">The chain is the tracking software</h2>
          <p>
            In a real card room, when you lose you <em>muck</em>: your cards go face
            down and nobody ever learns what you held. That isn't politeness, it's
            strategy — every hand you show is a permanent read on how you play.
          </p>
          <p>
            On-chain poker throws it away. Showdown means publishing your hole cards
            to a public ledger where they're indexed, free, and permanent. Your
            opponents don't need tracking software.
          </p>
        </div>
      </motion.section>

      {/* ---- the muck ---- */}
      <motion.section className="land__section" {...reveal}>
        <div className="land__col">
          <span className="eyebrow">At showdown</span>
          <h2 className="land__h2">Three ways to end a hand. Two of them tell nobody anything.</h2>
        </div>
        <div className="land__options">
          {SHOWDOWN.map((o, i) => (
            <motion.div
              key={o.name}
              className={`land__opt${o.tone ? ' land__opt--' + o.tone : ''}`}
              initial={reduced ? undefined : { opacity: 0, y: 18 }}
              whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i * 0.09, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <h3 className="land__optName">{o.name}</h3>
              <code className="land__optCode">{o.code}</code>
              <p className="land__optText">{o.text}</p>
            </motion.div>
          ))}
        </div>
        <p className="land__note">
          A packed rank encodes the category <em>and</em> every tiebreaker, so publishing
          one publishes the hand. <code>2169397</code> decodes to "two pair, aces and
          kings, nine kicker." That's why the other two exist.
        </p>
      </motion.section>

      {/* ---- the cage ---- */}
      <motion.section className="land__section" {...reveal}>
        <div className="land__col">
          <span className="eyebrow">The cage</span>
          <h2 className="land__h2">Buy in with anything. Leave with anything.</h2>
          <p>
            A poker room doesn't let you bet dollars against euros — you buy chips at
            the cage and settle up on the way out. Nightfold works the same way, which
            is what makes it cross-chain rather than two escrows side by side.
          </p>
        </div>
        <div className="land__cage">
          <div className="land__cageIn">
            <span className="land__chain land__chain--base">Base</span>
            <span className="land__amt mono">0.05 ETH</span>
          </div>
          <div className="land__cageIn">
            <span className="land__chain land__chain--sol">Solana</span>
            <span className="land__amt mono">10 SOL</span>
          </div>
          <div className="land__cageChips">
            <motion.span
              className="land__chipCount mono"
              initial={reduced ? undefined : { scale: 0.9, opacity: 0 }}
              whileInView={reduced ? undefined : { scale: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              1,000
            </motion.span>
            <span className="land__chipLabel">chips each — a fair game</span>
          </div>
          <div className="land__cageOut">
            <span className="land__amt mono">0.1 ETH</span>
            <span className="land__outLabel">winner cashes out on a chain they never deposited to</span>
          </div>
        </div>
      </motion.section>

      {/* ---- lanes ---- */}
      <motion.section className="land__section" {...reveal}>
        <div className="land__col">
          <span className="eyebrow">Architecture</span>
          <h2 className="land__h2">Each chain does the one thing it's good at</h2>
        </div>
        <div className="land__lanes">
          {LANES.map((l, i) => (
            <motion.div
              key={l.name}
              className={`land__lane${l.mid ? ' land__lane--mid' : ''}`}
              initial={reduced ? undefined : { opacity: 0, y: 18 }}
              whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i * 0.09, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <h3 className="land__laneName">{l.name}</h3>
              <p>{l.text}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      <footer className="land__foot">
        <motion.button
          className="land__play"
          onClick={onPlay}
          whileHover={reduced ? undefined : { scale: 1.03 }}
          whileTap={reduced ? undefined : { scale: 0.98 }}
        >
          Play a hand
        </motion.button>
        <p className="land__footNote">
          Built for the Midnight Hackathon, August 2026. The README documents what is
          proven, what is simulated, and what the dealer can still see — and
          docs/security.md records an external audit and the fixes for every finding.
        </p>
      </footer>
    </div>
  );
}
