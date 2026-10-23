import type { CameraErrorKind } from '../app/interactionMachine';
import { useStore } from '../app/state';

const COPY: Record<CameraErrorKind, { title: string; body: string }> = {
  'permission-denied': {
    title: 'Camera permission denied.',
    body: 'Allow camera access from the icon in your browser’s address bar, then retry. Video never leaves your device.',
  },
  unavailable: {
    title: 'No usable camera.',
    body: 'Connect a webcam, or close other apps that may be using it, then retry.',
  },
  'insecure-context': {
    title: 'Camera needs a secure page.',
    body: 'Open the experience on http://localhost or over https://. Browsers block cameras elsewhere.',
  },
  'model-failed': {
    title: 'Hand tracking failed to load.',
    body: 'The model or its runtime could not be loaded. Run “npm run fetch-model” so public/models/hand_landmarker.task exists, then retry.',
  },
  unknown: {
    title: 'The camera could not start.',
    body: 'Something unexpected went wrong while starting the camera. Retry, or explore without it.',
  },
};

export function ErrorState({ kind }: { kind: CameraErrorKind }) {
  const dispatch = useStore((s) => s.dispatch);
  const retryCamera = useStore((s) => s.retryCamera);
  const copy = COPY[kind];
  return (
    <section className="error-state" role="alertdialog" aria-labelledby="err-title" aria-describedby="err-body">
      <p className="eyebrow">SIMULATION FAULT</p>
      <h2 id="err-title">{copy.title}</h2>
      <p id="err-body">{copy.body}</p>
      <div className="row">
        <button
          className="btn-primary"
          onClick={() => {
            retryCamera();
            dispatch({ type: 'RETRY' });
          }}
          autoFocus
        >
          RETRY CAMERA
        </button>
        <button className="btn-secondary" onClick={() => dispatch({ type: 'ENTER_FALLBACK' })}>
          Explore with mouse &amp; keyboard
        </button>
      </div>
      <button className="btn-link" onClick={() => dispatch({ type: 'EXIT' })}>
        back
      </button>
    </section>
  );
}

export function FatalError({ message }: { message: string }) {
  return (
    <section className="error-state" role="alert">
      <p className="eyebrow">SIMULATION FAULT</p>
      <h2>Reality failed to render.</h2>
      <p>{message}</p>
      <p>Try a current desktop Chrome, Edge or Firefox with hardware acceleration enabled.</p>
    </section>
  );
}
