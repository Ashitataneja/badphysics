interface Props {
  onEnter: () => void;
  onFallback: () => void;
  disabled: boolean;
}

const TITLE = 'BAD PHYSICS';

export function LandingScreen({ onEnter, onFallback, disabled }: Props) {
  return (
    <section className="landing" aria-labelledby="title">
      <h1 id="title" className="title" aria-label={TITLE}>
        {TITLE.split('').map((ch, i) => (
          <span key={i} className={`glyph glyph-${i}`} aria-hidden="true">
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
      </h1>
      <p className="tagline">YOUR BODY IS THE BUG.</p>
      <button className="btn-primary" onClick={onEnter} disabled={disabled} autoFocus>
        ENTER THE SIMULATION
      </button>
      <p className="status-label">
        <span className="dot dot-off" aria-hidden="true" /> CAMERA INACTIVE · permission is requested only after you enter
      </p>
      <button className="btn-link" onClick={onFallback} disabled={disabled}>
        or explore with mouse &amp; keyboard
      </button>
    </section>
  );
}
