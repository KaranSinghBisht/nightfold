import { CHAINS, type Seat } from '../game/types';
import { PlayingCard } from './PlayingCard';
import './seat.css';

interface Props {
  seat: Seat;
  /** True when these are the viewer's own cards. */
  isYou: boolean;
}

const STATUS_TEXT: Record<Seat['status'], string> = {
  empty: 'seat open',
  seated: 'bought in',
  committed: 'cards committed',
  revealed: 'showed',
  beat: 'beats it — rank not published',
  mucked: 'mucked — revealed nothing',
  won: 'winner',
};

export function SeatPanel({ seat, isYou }: Props) {
  const chain = CHAINS[seat.chain];
  const mucked = seat.status === 'mucked';
  const won = seat.status === 'won';

  return (
    <section className={`seat${won ? ' seat--won' : ''}${mucked ? ' seat--mucked' : ''}`}>
      <header className="seat__head">
        <div className="seat__who">
          <span className="seat__name">{seat.name}</span>
          {isYou && <span className="seat__you">you</span>}
        </div>
        <span className="seat__chain mono" style={{ color: chain.color }}>
          <span className="seat__dot" style={{ background: chain.color }} />
          {seat.stake} {chain.ticker}
        </span>
      </header>

      <div className="seat__cards">
        {seat.status === 'empty' ? (
          <span className="seat__waiting">waiting</span>
        ) : (
          <>
            <PlayingCard card={seat.hole?.[0]} mucked={mucked} size="lg" delay={0} />
            <PlayingCard card={seat.hole?.[1]} mucked={mucked} size="lg" delay={90} />
          </>
        )}
      </div>

      <footer className="seat__foot">
        <span className={`seat__status${won ? ' seat__status--won' : ''}`}>
          {STATUS_TEXT[seat.status]}
        </span>
        {seat.rank !== undefined && (
          <span className="seat__rank mono" title="the only thing published at showdown">
            rank {seat.rank.toLocaleString()}
          </span>
        )}
      </footer>

      {mucked ? (
        <p className="seat__hand seat__never">
          conceded — no cards, no rank, nothing on any chain
        </p>
      ) : seat.handName ? (
        <p className="seat__hand">{seat.handName}</p>
      ) : null}

      <span className="seat__chainlabel eyebrow">{chain.label}</span>
    </section>
  );
}
