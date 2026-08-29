/**
 * Pixel glyphs drawn as a grid of squares rather than as path data — at this
 * scale a vector curve would fight the bitmap type, and a grid is far easier to
 * read and edit in source than a `d` attribute.
 */
interface Props {
  grid: string[];
  size?: number;
  className?: string;
  label?: string;
}

export function PixelMark({ grid, size = 16, className, label }: Props) {
  const cols = grid[0]?.length ?? 0;
  const rows = grid.length;

  return (
    <svg
      className={className}
      width={size}
      height={(size / Math.max(cols, 1)) * rows}
      viewBox={`0 0 ${cols} ${rows}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {grid.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null,
        ),
      )}
    </svg>
  );
}

export const EYE = [
  '........',
  '..####..',
  '.#....#.',
  '#..##..#',
  '#.####.#',
  '.#....#.',
  '..####..',
  '........',
];

export const CHEVRON = [
  '..##....',
  '...##...',
  '....##..',
  '.....##.',
  '.....##.',
  '....##..',
  '...##...',
  '..##....',
];

/** A redaction bar: the muck's whole point is that nothing is under it. */
export const BAR = [
  '........',
  '########',
  '########',
  '########',
  '########',
  '########',
  '########',
  '........',
];

export const LOCK = [
  '..####..',
  '.#....#.',
  '.#....#.',
  '########',
  '########',
  '###..###',
  '########',
  '........',
];

export const HASH = [
  '..#..#..',
  '..#..#..',
  '########',
  '..#..#..',
  '..#..#..',
  '########',
  '..#..#..',
  '..#..#..',
];
