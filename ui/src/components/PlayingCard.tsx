import type { Card } from '../game/types';
import './card.css';

const SUIT_WORD: Record<Card['suit'], string> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

const RANK_WORD: Record<Card['rank'], string> = {
  '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven',
  '8': 'eight', '9': 'nine', T: 'ten', J: 'jack', Q: 'queen', K: 'king', A: 'ace',
};

/** Kenney's CC0 playing-cards pack, cropped to the 42x60 card and served whole. */
const ART = `${import.meta.env.BASE_URL}cards/`;

interface Props {
  /** Omit to render a face-down card. */
  card?: Card;
  /** Face-down and permanently so — the hand went into the muck. */
  mucked?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Staggered entrance when the card is dealt. */
  delay?: number;
}

/**
 * A card that is face down renders NO card data. There is no value behind the
 * back to reveal on hover or read out of the DOM — the component simply was
 * never given one, so the only sprite it can name is the back.
 */
export function PlayingCard({ card, mucked, size = 'md', delay = 0 }: Props) {
  const cls = ['card', `card--${size}`, mucked ? 'card--mucked' : '', card ? 'card--up' : 'card--down']
    .filter(Boolean)
    .join(' ');
  const label = card ? `${RANK_WORD[card.rank]} of ${SUIT_WORD[card.suit]}` : mucked ? 'mucked card' : 'face-down card';

  return (
    <span className={cls} style={{ animationDelay: `${delay}ms` }} role="img" aria-label={label}>
      <img
        className="card__img"
        src={card ? `${ART}${card.rank}${card.suit}.png` : `${ART}back.png`}
        alt=""
        draggable={false}
      />
    </span>
  );
}
