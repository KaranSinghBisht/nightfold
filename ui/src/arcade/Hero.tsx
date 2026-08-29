import { motion, useReducedMotion } from 'framer-motion';
import CRTWarp from '../components/CRTWarp';
import { PlayingCard } from '../components/PlayingCard';
import { PixelMark, SPADE } from './PixelMark';
import { Monitor } from './Monitor';

interface Props {
  onPlay: () => void;
}

const RISE = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
const EASE = [0.16, 1, 0.3, 1] as const;

export function Hero({ onPlay }: Props) {
  const reduced = useReducedMotion();
  const step = (i: number) => ({
    variants: RISE,
    transition: { delay: 0.09 * i, duration: 0.7, ease: EASE },
  });

  return (
    <header className="arc__hero">
      <div className="arc__field">
        {/* Midnight blue rather than the stock violet, slowed right down and
            turned down hard:
            the tube is the room the type sits in, never the subject. The final
            level is set by .arc__canvas opacity so it is one dial to tune. */}
        <CRTWarp
          className="arc__canvas"
          color="#5C9BFF"
          backgroundColor="#06080B"
          speed={0.14}
          curvature={0.34}
          scanlineStrength={0.55}
          scanlineFrequency={260}
          waveAmplitude={0.3}
          waveFrequency={4.6}
          bloom={0.55}
          bloomRadius={1}
          noise={0.05}
          vignette={1}
          brightness={0.62}
          pixelation={1}
          rgbShift={0.01}
          mouseReact
          mouseStrength={0.45}
          dpr={1}
          fps={30}
        />
        <div className="arc__scrim" />
      </div>

      <div className="arc__inner">
        <nav className="arc__nav">
          <span className="arc__brand">
            <PixelMark grid={SPADE} size={26} className="arc__brandMark" label="Nightfold" />
            <span className="arc__brandText">
              <span className="arc__brandName">NIGHTFOLD</span>
              <span className="arc__brandSub">ZK HOLD'EM ON MIDNIGHT</span>
            </span>
          </span>
          <div className="arc__navLinks">
            <a href="#endings">SHOWDOWN</a>
            <a href="#cage">CAGE</a>
            <a href="https://github.com/KaranSinghBisht/nightfold">CODE</a>
          </div>
          <button className="arc__btn arc__navBtn" onClick={onPlay}>
            ENTER THE TABLE
          </button>
        </nav>

        <motion.div
          className="arc__stage"
          initial={reduced ? undefined : 'hidden'}
          animate={reduced ? undefined : 'show'}
        >
          <motion.div
            className="arc__float arc__float--l"
            initial={reduced ? undefined : { opacity: 0, y: 30 }}
            animate={reduced ? undefined : { opacity: 0.92, y: [0, -14, 0] }}
            transition={{
              opacity: { delay: 0.5, duration: 0.8 },
              y: { delay: 0.5, duration: 7, repeat: Infinity, ease: 'easeInOut' },
            }}
            aria-hidden
          >
            <PlayingCard card={{ rank: 'A', suit: 's' }} size="lg" />
          </motion.div>
          <motion.div
            className="arc__float arc__float--r"
            initial={reduced ? undefined : { opacity: 0, y: 30 }}
            animate={reduced ? undefined : { opacity: 0.92, y: [0, 16, 0] }}
            transition={{
              opacity: { delay: 0.65, duration: 0.8 },
              y: { delay: 0.65, duration: 8, repeat: Infinity, ease: 'easeInOut' },
            }}
            aria-hidden
          >
            <PlayingCard mucked size="lg" />
          </motion.div>

          <h1 className="arc__title">
            <motion.span className="arc__t1" {...step(0)}>NIGHT</motion.span>
            <motion.span className="arc__t2" {...step(1)}>FOLD</motion.span>
          </h1>

          <motion.span className="arc__tag" {...step(2)}>
            — WIN THE POT · SHOW NOTHING —
          </motion.span>

          <motion.p className="arc__pitch" {...step(3)}>
            Heads-up hold'em where the losing hand is never published. Buy in from
            Base or Solana, play the cards on Midnight, cash out wherever you like.
          </motion.p>

          <motion.div className="arc__ctas" {...step(4)}>
            <button className="arc__btn" onClick={onPlay}>ENTER THE TABLE</button>
            <a className="arc__btn arc__btn--ghost" href="#endings">HOW IT WORKS</a>
          </motion.div>
        </motion.div>

        <motion.div
          initial={reduced ? undefined : { opacity: 0, y: 34 }}
          animate={reduced ? undefined : { opacity: 1, y: 0 }}
          transition={{ delay: 0.72, duration: 0.9, ease: EASE }}
        >
          <Monitor />
        </motion.div>
      </div>
    </header>
  );
}
