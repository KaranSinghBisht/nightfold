import type { Card } from '../game/types';
import './card.css';

const SUIT_GLYPH: Record<Card['suit'], string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED: Card['suit'][] = ['h', 'd'];

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
 * never given one.
 */
export function PlayingCard({ card, mucked, size = 'md', delay = 0 }: Props) {
  const cls = ['card', `card--${size}`, mucked ? 'card--mucked' : '', card ? 'card--up' : 'card--down']
    .filter(Boolean)
    .join(' ');

  if (!card) {
    return (
      <div className={cls} style={{ animationDelay: `${delay}ms` }} aria-label={mucked ? 'mucked card' : 'face-down card'}>
        <span className="card__back" />
      </div>
    );
  }

  const red = RED.includes(card.suit);
  return (
    <div
      className={`${cls}${red ? ' card--red' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
      aria-label={`${card.rank}${SUIT_GLYPH[card.suit]}`}
    >
      <span className="card__rank">{card.rank}</span>
      <span className="card__suit">{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}
