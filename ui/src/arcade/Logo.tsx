import logo from './logo.json';

interface Props {
  size?: number;
  className?: string;
  /** Omit for a decorative mark sitting next to the wordmark. */
  label?: string;
}

const COLS = logo.grid[0].length;
const ROWS = logo.grid.length;

/**
 * The Nightfold mark: a spade above a redaction bar — the hand you show, above
 * the one that is never published.
 *
 * Drawn from logo.json, which scripts/logo.mjs also generates the favicon from,
 * so the mark in the nav and the mark in the browser tab cannot drift apart.
 * Rects rather than path data because at this scale a grid is far easier to
 * read and edit in source than a `d` attribute.
 */
export function Logo({ size = 26, className, label }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${COLS} ${ROWS}`}
      shapeRendering="crispEdges"
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {logo.grid.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === '#' || cell === '=' ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width={1}
              height={1}
              fill={cell === '#' ? logo.spade : logo.muck}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
