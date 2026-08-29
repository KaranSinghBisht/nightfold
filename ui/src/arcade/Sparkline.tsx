interface Props {
  points: number[];
  /** Signed 24h move; decides the colour, since the line alone is ambiguous. */
  change: number;
  width?: number;
  height?: number;
}

/**
 * Seven days of price, small enough to sit in a table row.
 *
 * Deliberately unlabelled and unscaled to any axis — it is there to say "this
 * is a live market, and here is its shape", which is the whole job at 64px.
 */
export function Sparkline({ points, change, width = 64, height = 20 }: Props) {
  if (points.length < 2) return <span style={{ width, height, display: 'inline-block' }} />;

  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const stepX = width / (points.length - 1);

  // 1px inset top and bottom so the extremes are not clipped by the viewBox.
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${(height - 1 - ((p - lo) / span) * (height - 2)).toFixed(2)}`)
    .join(' ');

  const stroke = change >= 0 ? '#4ADE80' : '#FF6B6B';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
