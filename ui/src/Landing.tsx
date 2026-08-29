import { Hero } from './arcade/Hero';
import { Ticker, Endings, Protocol, Cage, Lanes } from './arcade/Sections';
import './arcade/arcade.css';

interface Props {
  onPlay: () => void;
}

export function Landing({ onPlay }: Props) {
  return (
    <div className="arc">
      {/* Scanlines and corner falloff sit above everything: one tube, not a
          shader parked behind flat HTML. */}
      <div className="arc__tube" aria-hidden />
      <Hero onPlay={onPlay} />
      <Ticker />
      <Endings />
      <Protocol />
      <Cage />
      <Lanes onPlay={onPlay} />
    </div>
  );
}
