import { motion, useReducedMotion } from 'framer-motion';
import { CAGE_LEDGER } from './copy';

interface RowProps {
  row: { chain: string; tone: string; from: string; to: string };
  i: number;
  reduced: boolean | null;
}

function Row({ row, i, reduced }: RowProps) {
  return (
    <motion.div
      className="arcCage__row"
      initial={reduced ? undefined : { opacity: 0, x: -12 }}
      whileInView={reduced ? undefined : { opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay: 0.1 + i * 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className={`arcCage__chain arcCage__chain--${row.tone}`}>
        <span className="arcCage__pip" />
        {row.chain}
      </span>
      <span className="arcCage__from">{row.from}</span>
      <span className="arcCage__arrow" aria-hidden>{'──▶'}</span>
      <span className="arcCage__to">{row.to}</span>
    </motion.div>
  );
}

/**
 * The cage as a ledger rather than a logo. Every figure here is at the rate the
 * contracts actually use, so the panel is the cross-chain claim itself: two
 * chains in, one stack at the table, a different chain out.
 */
export function CageWindow() {
  const reduced = useReducedMotion();

  return (
    <div className="arcCage__win">
      <div className="arcCage__head">
        <span className="arcCage__headName">CAGE_LEDGER_#0A4F</span>
        <span className="arcCage__headProof">CONSERVATION: PROVEN</span>
      </div>

      <div className="arcCage__ledger">
        <span className="arcCage__leg">BUY IN</span>
        {CAGE_LEDGER.in.map((r, i) => (
          <Row key={r.chain} row={r} i={i} reduced={reduced} />
        ))}

        <div className="arcCage__table">{CAGE_LEDGER.table}</div>

        <span className="arcCage__leg">CASH OUT</span>
        {CAGE_LEDGER.out.map((r, i) => (
          <Row key={r.chain} row={r} i={i + 2} reduced={reduced} />
        ))}

        <p className="arcCage__punch">{CAGE_LEDGER.punchline}</p>
      </div>
    </div>
  );
}
