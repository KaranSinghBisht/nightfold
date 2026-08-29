import { useEffect, useRef } from 'react';

export interface AsciiGrid {
  cols: number;
  rows: number;
  /** Draw one glyph at cell (c,r). alpha 0..1, color css string. */
  put: (c: number, r: number, ch: string, color: string, alpha?: number) => void;
  time: number;
}

const CELL_W = 9.6;
const CELL_H = 17;
const FONT = `12.5px "JetBrains Mono", ui-monospace, Menlo, monospace`;

/**
 * Shared canvas loop for the ASCII pieces. Handles DPR scaling, resize,
 * offscreen pause, and reduced motion — which renders one static frame rather
 * than animating. Carried over from NightPool, where it earned its keep.
 */
export function useAsciiCanvas(draw: (g: AsciiGrid) => void) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let cols = 0;
    let rows = 0;
    let raf = 0;
    let visible = true;
    const t0 = performance.now();

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = FONT;
      ctx.textBaseline = 'top';
      cols = Math.floor(w / CELL_W);
      rows = Math.floor(h / CELL_H);
    };

    const grid: AsciiGrid = {
      cols: 0,
      rows: 0,
      time: 0,
      put: (c, r, ch, color, alpha = 1) => {
        if (c < 0 || r < 0 || c >= cols || r >= rows || alpha <= 0.01) return;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = color;
        ctx.fillText(ch, c * CELL_W, r * CELL_H + 2);
      },
    };

    const frame = (t: number) => {
      if (cols > 0 && rows > 0) {
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        grid.cols = cols;
        grid.rows = rows;
        const now = Number.isFinite(t) ? t : performance.now();
        grid.time = Math.max(0, (now - t0) / 1000);
        drawRef.current(grid);
        ctx.globalAlpha = 1;
      }
      if (!reduced && visible) raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) frame(performance.now());
    });
    ro.observe(canvas);
    resize();

    const io = new IntersectionObserver((entries) => {
      const nowVisible = entries.some((e) => e.isIntersecting);
      if (nowVisible && !visible) {
        visible = true;
        if (!reduced) raf = requestAnimationFrame(frame);
      } else if (!nowVisible) {
        visible = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(canvas);

    frame(performance.now());

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return ref;
}
