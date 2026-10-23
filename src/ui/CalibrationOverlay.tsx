import type { Experience } from '../app/Experience';
import { useStore } from '../app/state';
import type { TrackingStatus } from '../hooks/useHandTracking';
import { VideoMount } from './VideoMount';

interface Props {
  experience: Experience | null;
  video: HTMLVideoElement | null;
  status: TrackingStatus;
}

export function CalibrationOverlay({ experience, video, status }: Props) {
  const machine = useStore((s) => s.machine);
  const hands = useStore((s) => s.hud.handCount);
  const mirror = useStore((s) => s.settings.mirror);
  const dispatch = useStore((s) => s.dispatch);
  const ready = machine.phase === 'calibrating';

  let message = 'Waiting for camera permission…';
  if (status === 'loading-model') message = 'Loading the hand tracking model…';
  if (ready) message = hands > 0 ? `${hands === 2 ? 'Two hands' : 'Hand'} found. Hold still…` : 'Raise one or both hands into the frame.';

  return (
    <section className="calibration" role="dialog" aria-modal="false" aria-labelledby="calib-title">
      <h2 id="calib-title" className="eyebrow">CALIBRATION</h2>
      <div className={`calib-frame ${hands > 0 ? 'has-hand' : ''}`}>
        {video ? (
          <VideoMount video={video} experience={experience} mode="calibration" mirror={mirror} />
        ) : (
          <div className="calib-placeholder" aria-hidden="true" />
        )}
        <div className="calib-guides" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
      <p className="calib-message" aria-live="polite">
        {message}
      </p>
      {machine.noHandHint && hands === 0 && (
        <p className="calib-hint" role="status">
          No hand detected yet. Step back so your whole hand fits, add light in front of you, and turn your palm toward the camera.
        </p>
      )}
      <div className="row">
        <button className="btn-secondary" onClick={() => dispatch({ type: 'SKIP_CALIBRATION' })} disabled={!ready}>
          Skip calibration
        </button>
        <button className="btn-link" onClick={() => dispatch({ type: 'ENTER_FALLBACK' })}>
          Use mouse &amp; keyboard instead
        </button>
      </div>
    </section>
  );
}
