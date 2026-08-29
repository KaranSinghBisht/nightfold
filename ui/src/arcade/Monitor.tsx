import { PlayingCard } from '../components/PlayingCard';
import { DEMO } from './copy';
import './monitor.css';

/**
 * A hand frozen one beat after showdown. The winning seat shows; the losing
 * seat is a sealed frame with nothing behind it — the cards were never handed
 * to this component, so there is nothing in the DOM to inspect.
 */
export function Monitor() {
  return (
    <div className="arcMon">
      <div className="arcMon__head">
        <span className="arcMon__live">
          <span className="arcMon__dot" />
          {DEMO.handId}
        </span>
        <span className="arcMon__pot">{DEMO.pot}</span>
      </div>

      <div className="arcMon__screen">
        <div className="arcMon__seat">
          <span className="arcMon__seatName">SEAT_1 · YOU</span>
          <div className="arcMon__hole">
            <PlayingCard card={{ rank: 'Q', suit: 'c' }} size="sm" />
            <PlayingCard card={{ rank: 'J', suit: 'c' }} size="sm" delay={60} />
          </div>
        </div>

        <div className="arcMon__board">
          {DEMO.board.map((c, i) => (
            <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="md" delay={i * 70} />
          ))}
          <PlayingCard size="md" delay={210} />
          <PlayingCard size="md" delay={280} />
        </div>

        <div className="arcMon__seat arcMon__seat--sealed">
          <span className="arcMon__seatName">SEAT_2 · MUCKED</span>
          <div className="arcMon__sealed">
            <div className="arcMon__hole">
              <PlayingCard mucked size="sm" delay={120} />
              <PlayingCard mucked size="sm" delay={180} />
            </div>
            <span className="arcMon__stamp">NO DATA</span>
          </div>
        </div>

        <div className="arcMon__log">
          {DEMO.log.map((l) => (
            <span className="arcMon__line" key={l.key}>
              {'> '}
              {l.key}:{' '}
              <span className={`arcMon__val--${l.tone}`}>{l.value}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="arcMon__acts">
        <span className="arcMon__act">fold...</span>
        <span className="arcMon__act">call...</span>
        <span className="arcMon__act">raise...</span>
      </div>
    </div>
  );
}
