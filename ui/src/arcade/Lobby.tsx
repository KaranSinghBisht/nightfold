import { useState } from 'react';
import { Logo } from './Logo';
import { PixelMark } from './PixelMark';
import { CHAINS, rateOf } from './chains';
import { connect, short, hasInjectedWallet, type Wallet } from './wallet';
import './lobby.css';

interface Props {
  wallet: Wallet | null;
  onWallet: (w: Wallet) => void;
  onGuest: () => void;
  onCash: () => void;
}

const GUEST_STACK = 1_000;

/**
 * Two ways to take a seat.
 *
 * Landing straight in a hand answered none of the questions a first-time
 * visitor has — whose chips are these, what is at stake, do I need a wallet.
 * The guest lane answers "none of that, just deal"; the cash lane shows the
 * cage doing the job the whole project is about.
 */
export function Lobby({ wallet, onWallet, onGuest, onCash }: Props) {
  const [connecting, setConnecting] = useState(false);

  const doConnect = async () => {
    setConnecting(true);
    try {
      onWallet(await connect());
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="lob">
      <div className="lob__tube" aria-hidden />

      <header className="lob__bar">
        <a className="lob__brand" href="#/">
          <Logo size={24} className="lob__mark" label="Nightfold" />
          <span className="lob__brandName">NIGHTFOLD</span>
          <span className="lob__brandSub">TAKE A SEAT</span>
        </a>
        {wallet && (
          <span className="lob__wallet">
            {short(wallet.address)}
            {wallet.kind === 'demo' && <em className="lob__demo">DEMO</em>}
          </span>
        )}
      </header>

      <div className="lob__lanes">
        {/* ---- guest ---- */}
        <section className="lob__lane">
          <span className="lob__kicker">NO WALLET</span>
          <h2 className="lob__name">GUEST TABLE</h2>
          <p className="lob__blurb">
            {GUEST_STACK.toLocaleString('en-US')} house chips, dealt now. Nothing is
            deposited and nothing settles on a chain — it is the poker and the muck,
            with the money left out.
          </p>

          <ul className="lob__points">
            <li><span className="lob__tick" />Straight into a hand</li>
            <li><span className="lob__tick" />Full showdown: show, beat it, or muck</li>
            <li><span className="lob__tick lob__tick--off" />No cage, no chain, no stake</li>
          </ul>

          <button className="lob__go lob__go--ghost" onClick={onGuest}>
            DEAL ME IN
          </button>
        </section>

        {/* ---- cash ---- */}
        <section className="lob__lane lob__lane--cash">
          <span className="lob__kicker lob__kicker--on">CONNECT · DEPOSIT · PLAY</span>
          <h2 className="lob__name">CASH TABLE</h2>
          <p className="lob__blurb">
            Bring any of six chains to the cage and it gives you chips at one price.
            Win, and you cash out on whichever chain you like — including one you
            never deposited to.
          </p>

          <div className="lob__chains">
            {CHAINS.map((c) => (
              <span className="lob__chain" key={c.id} title={rateOf(c)}>
                <span style={{ color: c.colour, lineHeight: 0 }}>
                  <PixelMark grid={c.mark} size={16} />
                </span>
                {c.name}
              </span>
            ))}
          </div>

          <ol className="lob__steps">
            <li className={wallet ? 'lob__step--done' : ''}>
              <b>1</b> Connect a wallet
              {wallet && <span className="lob__stepNote">{short(wallet.address)}</span>}
            </li>
            <li><b>2</b> Deposit on Base Sepolia or Solana devnet</li>
            <li><b>3</b> The cage credits chips and seats you</li>
          </ol>

          {wallet ? (
            <button className="lob__go" onClick={onCash}>
              OPEN THE CAGE
            </button>
          ) : (
            <button className="lob__go" onClick={() => void doConnect()} disabled={connecting}>
              {connecting ? 'CONNECTING…' : 'CONNECT WALLET'}
            </button>
          )}

          {!hasInjectedWallet() && (
            <p className="lob__note">
              No browser wallet detected — connecting uses a clearly-labelled demo
              account rather than pretending otherwise. Deposits are simulated in
              this build.
            </p>
          )}
        </section>
      </div>

      <p className="lob__foot">
        Either way the losing hand is never published. That is the part that is real.
      </p>
    </div>
  );
}
