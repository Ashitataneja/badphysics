import { useEffect, useState } from 'react';
import type { Experience } from '../app/Experience';
import { wantsCamera } from '../app/interactionMachine';
import { useStore } from '../app/state';
import { CameraError, CameraManager } from '../camera/CameraManager';
import { HandTracker } from '../camera/HandTracker';

export type TrackingStatus = 'off' | 'starting-camera' | 'loading-model' | 'ready';

/**
 * Starts the webcam and hand tracker whenever the state machine wants the
 * camera, and tears both down (stopping every media track and closing the
 * landmarker) when it no longer does — on exit, on camera disable, or on
 * retry. One stream and one tracker at a time.
 */
export function useHandTracking(experience: Experience | null) {
  const want = useStore((s) => wantsCamera(s.machine));
  const attempt = useStore((s) => s.cameraAttempt);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<TrackingStatus>('off');
  const [delegate, setDelegate] = useState<'GPU' | 'CPU' | null>(null);

  useEffect(() => {
    if (!experience || !want) return;
    let cancelled = false;
    const camera = new CameraManager();
    let tracker: HandTracker | null = null;
    const { dispatch } = useStore.getState();

    (async () => {
      try {
        setStatus('starting-camera');
        await camera.start();
        // Cleanup may have run while awaiting: release what just arrived.
        if (cancelled) return camera.stop();
        setVideo(camera.video);
        setStatus('loading-model');
        const created = await HandTracker.create();
        if (cancelled) return created.dispose();
        tracker = created;
        setDelegate(tracker.delegate);
        experience.attachCamera(camera, tracker);
        setStatus('ready');
        dispatch({ type: 'CAMERA_READY' });
      } catch (err) {
        if (cancelled) return;
        const kind = err instanceof CameraError ? err.kind : 'unknown';
        console.error('[BAD PHYSICS] camera initialisation failed', err);
        dispatch({ type: 'CAMERA_ERROR', error: kind });
      }
    })();

    return () => {
      cancelled = true;
      experience.detachCamera();
      camera.stop();
      tracker?.dispose();
      setVideo(null);
      setStatus('off');
      setDelegate(null);
    };
  }, [experience, want, attempt]);

  return { video, status, delegate };
}
