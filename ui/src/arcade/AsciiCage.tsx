import { useMemo } from 'react';
import { useAsciiCanvas } from './useAsciiCanvas';
import { CHAINS } from './chains';

const IN_GLYPHS = '₿◆◇✦∙·:';
const CHIP = '▪▫▪';

interface Mote {
  lane: number;
  x: number;
  speed: number;
  glyph: string;
  jitter: number;
}

/** `seed` populates the field on the first frame instead of leaving it empty
    for the several seconds it takes the first motes to arrive. */
function spawn(lanes: number, seed = false): Mote {
  return {
    lane: Math.floor(Math.random() * lanes),
    x: seed ? Math.random() * 1.2 : -0.02 - Math.random() * 0.3,
    speed: 0.5 + Math.random() * 0.5,
    glyph: IN_GLYPHS[Math.floor(Math.random() * IN_GLYPHS.length)],
    jitter: Math.random(),
  };
}

/**
 * The cage, as it actually behaves: six chains fall in on the left, every one
 * of them becomes the same chip at the aperture, and one stream leaves on the
 * right. Colour is the whole argument — many hues in, one hue out.
 */
export function AsciiCage() {
  const lanes = CHAINS.length;
  const motes = useMemo(() => Array.from({ length: 120 }, () => spawn(lanes, true)), [lanes]);

  const ref = useAsciiCanvas((g) => {
    const gate = Math.round(g.cols * 0.56);
    const top = Math.max(1, Math.floor((g.rows - lanes * 2) / 2));
    const mid = top + lanes - 1;

    // the aperture: a vertical slot everything has to pass through
    for (let r = top - 2; r <= top + lanes * 2; r++) {
      const near = Math.abs(r - mid) < 2;
      g.put(gate, r, near ? '║' : '│', near ? '#5C9BFF' : '#1F2C3A', near ? 0.9 : 0.6);
    }

    // inbound lanes, each in its own chain's colour
    for (let i = 0; i < lanes; i++) {
      const chain = CHAINS[i];
      const r = top + i * 2;
      const label = chain.short.padEnd(5, ' ');
      for (let c = 0; c < label.length; c++) {
        if (label[c] !== ' ') g.put(1 + c, r, label[c], chain.colour, 0.75);
      }
      for (let c = 7; c < gate; c += 2) {
        g.put(c, r, '·', '#1B2836', 0.9);
      }
    }

    for (const m of motes) {
      m.x += m.speed * 0.006;
      if (m.x > 1.25) Object.assign(m, spawn(lanes));

      const chain = CHAINS[m.lane];
      const laneRow = top + m.lane * 2;
      const start = 7;

      if (m.x < 0) continue;

      // Before the gate each mote rides its own lane and keeps its chain's
      // colour; after it, every mote is the same chip on the same row.
      const gateAt = (gate - start) / (g.cols - start);
      if (m.x < gateAt) {
        const c = Math.round(start + m.x * (g.cols - start));
        const pull = m.x / Math.max(gateAt, 0.001);
        const r = Math.round(laneRow + (mid - laneRow) * pull * pull);
        g.put(c, r, m.glyph, chain.colour, 0.55 + 0.45 * (1 - pull));
      } else {
        const c = Math.round(start + m.x * (g.cols - start));
        const drift = Math.round((m.jitter - 0.5) * 2.2);
        g.put(c, mid + drift, CHIP[Math.floor(m.jitter * CHIP.length)], '#5C9BFF', 0.55 + 0.4 * m.jitter);
      }
    }

    // what comes out the far side is one thing, and it is labelled
    const pulse = 0.7 + 0.3 * Math.sin(g.time * 1.6);
    const out = 'CHIPS';
    for (let c = 0; c < out.length; c++) {
      g.put(g.cols - out.length - 1 + c, mid - 2, out[c], '#5C9BFF', pulse);
    }
    g.put(gate, mid - 2, '╪', '#5C9BFF', pulse);
  });

  return <canvas ref={ref} className="arcAscii" aria-hidden="true" />;
}
