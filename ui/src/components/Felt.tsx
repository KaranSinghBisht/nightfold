import type { Card, Seat } from '../game/types';
import { CHAINS } from '../game/types';
import { PlayingCard } from './PlayingCard';
import './felt.css';

interface Props {
  seats: [Seat, Seat];
  /** which seat index the viewer occupies */
  you: 0 | 1;
  board: Card[];
  street: string;
  pot: number;
  winner: 0 | 1 | 2 | null;
  button: 0 | 1;
  toAct: 0 | 1 | null;
  thinking: boolean;
  /** best available hand name for the viewer, once a flop exists */
  yourHand?: string;
}

const STATUS_TEXT: Record<Seat['status'], string> = {
  empty: 'seat open',
  seated: 'bought in',
  committed: 'cards committed',
  revealed: 'showed',
  beat: 'beats it',
  mucked: 'mucked — revealed nothing',
  won: 'wins the pot',
};

function SeatPlate({ seat, isYou, isButton, isToAct, thinking, hint }: {
  seat: Seat; isYou: boolean; isButton: boolean; isToAct: boolean; thinking: boolean; hint?: string;
}) {
  const chain = CHAINS[seat.chain];
  const mucked = seat.status === 'mucked';
  const won = seat.status === 'won';

  return (
    <div className={`plate${won ? ' plate--won' : ''}${isToAct ? ' plate--live' : ''}`}>
      <div className="plate__cards">
        <PlayingCard card={seat.hole?.[0]} mucked={mucked} size="md" delay={0} />
        <PlayingCard card={seat.hole?.[1]} mucked={mucked} size="md" delay={90} />
      </div>
      <div className="plate__info">
        <div className="plate__who">
          <span className="plate__name">{seat.name}</span>
          {isYou && <span className="plate__you">you</span>}
          {isButton && <span className="plate__btnChip mono" title="dealer button">D</span>}
        </div>
        <span className="plate__chips mono">
          <span className="plate__chipDot" style={{ background: chain.color }} />
          {Number(seat.stake).toLocaleString()} chips
          {/* House chips came from nowhere, so they do not get a "via". */}
          <span className="plate__via">{chain.id === 'house' ? 'house chips' : `via ${chain.ticker}`}</span>
        </span>
        <span className={`plate__status${won ? ' plate__status--won' : ''}${mucked ? ' plate__status--muck' : ''}`}>
          {thinking ? 'thinking…' : STATUS_TEXT[seat.status]}
        </span>
        {hint && <span className="plate__hint">{hint}</span>}
      </div>
    </div>
  );
}

export function Felt({ seats, you, board, street, pot, winner, button, toAct, thinking, yourHand }: Props) {
  const them = (you === 0 ? 1 : 0) as 0 | 1;

  return (
    <section className="felt2" aria-label="poker table">
      <div className="felt2__rim">
        <div className="felt2__cloth">
          <span className="felt2__brand">NIGHTFOLD</span>

          <div className="felt2__seat felt2__seat--top">
            <SeatPlate
              seat={seats[them]} isYou={false}
              isButton={button === them}
              isToAct={toAct === them} thinking={thinking && toAct === them}
            />
          </div>

          <div className="felt2__middle">
            <div className="felt2__board">
              {board.length === 0 ? (
                <>
                  {[0, 1, 2, 3, 4].map((i) => <span key={i} className="felt2__slot" />)}
                </>
              ) : (
                <>
                  {board.map((c, i) => (
                    <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="md" delay={i * 80} />
                  ))}
                  {Array.from({ length: 5 - board.length }, (_, i) => (
                    <span key={`s${i}`} className="felt2__slot" />
                  ))}
                </>
              )}
            </div>
            <div className="felt2__potRow">
              <span className="felt2__street mono">{street}</span>
              <span className="felt2__pot mono">pot {pot.toLocaleString()}</span>
              {winner !== null && (
                <span className="felt2__winner mono">
                  → {winner === 2 ? 'split' : seats[winner].name}
                </span>
              )}
            </div>
          </div>

          <div className="felt2__seat felt2__seat--bottom">
            <SeatPlate
              seat={seats[you]} isYou
              isButton={button === you}
              isToAct={toAct === you} thinking={false}
              hint={yourHand}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
