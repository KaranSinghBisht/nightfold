import { PlayingCard } from './components/PlayingCard';
import './landing.css';

interface Props {
  onPlay: () => void;
}

export function Landing({ onPlay }: Props) {
  return (
    <div className="land">
      {/* ---- hero ---- */}
      <header className="land__hero">
        <div className="land__heroText">
          <span className="eyebrow">Midnight Hackathon · Cross-Chain Track</span>
          <h1 className="land__title">Nightfold</h1>
          <p className="land__lede">
            Texas Hold'em where the losing hand is never revealed — and your chips
            can come from any chain.
          </p>
          <div className="land__cta">
            <button className="land__play" onClick={onPlay}>Play a hand</button>
            <a className="land__repo" href="https://github.com/KaranSinghBisht/nightfold">Read the code</a>
          </div>
        </div>

        <figure className="land__cards" aria-label="a mucked hand beside a winning one">
          <div className="land__cardGroup">
            <PlayingCard card={{ rank: 'A', suit: 's' }} size="lg" />
            <PlayingCard card={{ rank: 'K', suit: 'h' }} size="lg" delay={80} />
            <figcaption className="land__cap land__cap--won">shown · won the pot</figcaption>
          </div>
          <div className="land__cardGroup">
            <PlayingCard mucked size="lg" delay={160} />
            <PlayingCard mucked size="lg" delay={240} />
            <figcaption className="land__cap land__cap--muck">mucked · never published</figcaption>
          </div>
        </figure>
      </header>

      {/* ---- the problem ---- */}
      <section className="land__section">
        <div className="land__col">
          <h2 className="land__h2">The chain is the tracking software</h2>
          <p>
            In a real card room, when you lose you <em>muck</em>: your cards go face
            down and nobody ever learns what you held. That isn't politeness, it's
            strategy — every hand you show is a permanent read on how you play.
          </p>
          <p>
            On-chain poker throws it away. Showdown means publishing your hole cards
            to a public ledger where they're indexed, free, and permanent. Your
            opponents don't need tracking software.
          </p>
        </div>
      </section>

      {/* ---- the muck ---- */}
      <section className="land__section land__section--alt">
        <div className="land__col">
          <span className="eyebrow">At showdown</span>
          <h2 className="land__h2">Three ways to end a hand. Two of them tell nobody anything.</h2>
        </div>
        <div className="land__options">
          {[
            { name: 'show', sub: 'revealHand', text: 'Publish your rank and claim the pot. What a winner normally does.', tone: '' },
            { name: 'beat it', sub: 'beatShownRank', text: 'Prove you beat the rank already on the table — without publishing your own.', tone: 'mid' },
            { name: 'muck', sub: 'muckHand', text: 'Concede. No cards, no rank, no proof of holdings. Nothing at all.', tone: 'best' },
          ].map((o) => (
            <div key={o.name} className={`land__opt${o.tone ? ' land__opt--' + o.tone : ''}`}>
              <h3 className="land__optName">{o.name}</h3>
              <code className="land__optCode">{o.sub}</code>
              <p className="land__optText">{o.text}</p>
            </div>
          ))}
        </div>
        <p className="land__note">
          A packed rank encodes the category <em>and</em> every tiebreaker, so publishing
          one publishes the hand. <code>2169397</code> decodes to "two pair, aces and
          kings, nine kicker." That's why the other two exist.
        </p>
      </section>

      {/* ---- the cage ---- */}
      <section className="land__section">
        <div className="land__col">
          <span className="eyebrow">The cage</span>
          <h2 className="land__h2">Buy in with anything. Leave with anything.</h2>
          <p>
            A poker room doesn't let you bet dollars against euros — you buy chips at
            the cage and settle up on the way out. Nightfold works the same way, which
            is what makes it cross-chain rather than two escrows side by side.
          </p>
        </div>
        <div className="land__cage">
          <div className="land__cageIn">
            <span className="land__chain land__chain--base">Base</span>
            <span className="land__amt mono">0.05 ETH</span>
          </div>
          <div className="land__cageIn">
            <span className="land__chain land__chain--sol">Solana</span>
            <span className="land__amt mono">10 SOL</span>
          </div>
          <div className="land__cageChips">
            <span className="land__chipCount mono">1000</span>
            <span className="land__chipLabel">chips each — a fair game</span>
          </div>
          <div className="land__cageOut">
            <span className="land__amt mono">0.1 ETH</span>
            <span className="land__outLabel">winner cashes out on a chain he never deposited to</span>
          </div>
        </div>
      </section>

      {/* ---- what each chain does ---- */}
      <section className="land__section land__section--alt">
        <div className="land__col">
          <span className="eyebrow">Architecture</span>
          <h2 className="land__h2">Each chain does the one thing it's good at</h2>
        </div>
        <div className="land__lanes">
          <div className="land__lane">
            <h3 className="land__laneName">Base &amp; Solana</h3>
            <p>Cages hold the money. Betting settles in seconds and costs almost nothing.</p>
          </div>
          <div className="land__lane land__lane--mid">
            <h3 className="land__laneName">Midnight</h3>
            <p>
              Hole cards live client-side as witnesses. Only commitments and a rank
              ever touch the ledger. The board is public — poker already shows it.
            </p>
          </div>
          <div className="land__lane">
            <h3 className="land__laneName">The relayer</h3>
            <p>Carries a proven outcome between them. It can stall; it cannot take your money or invent a winner.</p>
          </div>
        </div>
      </section>

      <footer className="land__foot">
        <button className="land__play" onClick={onPlay}>Play a hand</button>
        <p className="land__footNote">
          Built for the Midnight Hackathon, August 2026. The README documents what is
          proven, what is simulated, and what the dealer can still see.
        </p>
      </footer>
    </div>
  );
}
