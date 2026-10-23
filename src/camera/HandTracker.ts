import type { HandLandmarker as HandLandmarkerType } from '@mediapipe/tasks-vision';
import { CameraError } from './CameraManager';
import type { RawHand } from './landmarkFeatures';

const BASE = import.meta.env.BASE_URL;
export const MODEL_URL = `${BASE}models/hand_landmarker.task`;
export const WASM_URL = `${BASE}mediapipe/wasm`;

export interface DetectionResult {
  hands: RawHand[];
  /** Milliseconds spent inside the detector. */
  elapsed: number;
}

/**
 * Thin wrapper around MediaPipe Hand Landmarker in VIDEO mode. Tries the GPU
 * delegate first and falls back to CPU. Detection is synchronous; the caller
 * schedules it so it never runs more often than needed.
 */
export class HandTracker {
  private landmarker: HandLandmarkerType | null = null;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  delegate: 'GPU' | 'CPU' = 'GPU';

  static async create(): Promise<HandTracker> {
    const t = new HandTracker();
    await t.init();
    return t;
  }

  private async init(): Promise<void> {
    let vision;
    try {
      const head = await fetch(MODEL_URL, { method: 'HEAD' });
      if (!head.ok) throw new Error(`model not found at ${MODEL_URL} (HTTP ${head.status})`);
      const { FilesetResolver } = await import('@mediapipe/tasks-vision');
      vision = await FilesetResolver.forVisionTasks(WASM_URL);
    } catch (err) {
      throw new CameraError('model-failed', `Could not load the hand tracking runtime: ${(err as Error).message}`);
    }
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO' as const,
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, options('GPU'));
      this.delegate = 'GPU';
    } catch (gpuErr) {
      console.warn('[HandTracker] GPU delegate unavailable, falling back to CPU', gpuErr);
      try {
        this.landmarker = await HandLandmarker.createFromOptions(vision, options('CPU'));
        this.delegate = 'CPU';
      } catch (err) {
        throw new CameraError('model-failed', `Hand Landmarker failed to initialise: ${(err as Error).message}`);
      }
    }
  }

  /** True when the video has a frame we have not processed yet. */
  hasNewFrame(video: HTMLVideoElement): boolean {
    return video.readyState >= 2 && video.currentTime !== this.lastVideoTime;
  }

  detect(video: HTMLVideoElement, now: number): DetectionResult | null {
    if (!this.landmarker || !this.hasNewFrame(video)) return null;
    this.lastVideoTime = video.currentTime;
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const t0 = performance.now();
    const res = this.landmarker.detectForVideo(video, ts);
    const elapsed = performance.now() - t0;
    const hands: RawHand[] = res.landmarks.map((lm, i) => {
      const cat = (res.handedness ?? res.handednesses)?.[i]?.[0];
      return { landmarks: lm, handedness: cat?.categoryName ?? 'Unknown', score: cat?.score ?? 0.5 };
    });
    return { hands, elapsed };
  }

  dispose(): void {
    try {
      this.landmarker?.close();
    } catch {
      /* already closed */
    }
    this.landmarker = null;
  }
}
