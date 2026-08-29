// The opponent's cards, kept out of the app's state.
//
// RA-015: view() already keeps the bot's hole cards out of rendered props and
// out of the DOM, which is real presentation hygiene — but the full Engine sat
// in React state with both hole arrays in it, so anyone who opened the console
// could read Bob's hand. Minimising the DOM is not a privacy boundary.
//
// This module is the boundary. The bot's cards live in a module-scoped map that
// nothing exports, and the only things callers can ask for are ANSWERS: what
// does the bot rank, does it beat a number, and — when it chooses to show — the
// cards themselves. The Engine never holds them, so they never enter React
// state, never serialise into a devtools snapshot, and never reach a component.
//
// Being honest about the limit: this is one browser process. Someone determined
// enough to instrument the bundle can still reach a module-scoped variable. Real
// peer play needs each player's witnesses in their own wallet process, and that
// is the design, not this. What this removes is the casual read — which is
// exactly the difference between a hidden card and a hard-to-find one.

const held = new Map<string, number[]>();

/** Take custody of a seat's cards. Nothing hands them back by default. */
export function seal(handId: string, cards: number[]): void {
  held.set(handId, [...cards]);
}

export function forget(handId: string): void {
  held.delete(handId);
}

/** What the sealed hand ranks, given the board. A number, not the cards. */
export function rankSealed(
  handId: string,
  board: number[],
  rankOf: (ids: number[]) => number,
): number {
  const cards = held.get(handId);
  if (!cards) return 0;
  return rankOf([...cards, ...board]);
}

/**
 * Released only when the holder chooses to show. That choice is the entire
 * subject of this project, so it is the one path that returns cards.
 */
export function reveal(handId: string): number[] | undefined {
  const cards = held.get(handId);
  return cards ? [...cards] : undefined;
}
