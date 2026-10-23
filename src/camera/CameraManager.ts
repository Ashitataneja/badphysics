import type { CameraErrorKind } from '../app/interactionMachine';

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Owns the webcam MediaStream and the <video> element that MediaPipe reads.
 * The same video element is re-parented into the calibration view and the
 * picture-in-picture preview, so there is only ever one stream.
 */
export class CameraManager {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;

  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('playsinline', '');
    v.className = 'camera-video';
    this.video = v;
  }

  get active(): boolean {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  get aspect(): number {
    return this.video.videoWidth > 0 ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
  }

  async start(): Promise<void> {
    if (this.active) return;
    if (typeof window !== 'undefined' && !window.isSecureContext)
      throw new CameraError('insecure-context', 'Camera access requires HTTPS or localhost.');
    if (!navigator.mediaDevices?.getUserMedia)
      throw new CameraError('unavailable', 'This browser does not expose a camera API.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 60 } },
      });
    } catch (err) {
      throw CameraManager.mapError(err);
    }
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch {
      /* autoplay can reject spuriously; readiness is awaited below */
    }
    await new Promise<void>((resolve, reject) => {
      if (this.video.readyState >= 2 && this.video.videoWidth > 0) return resolve();
      const timer = window.setTimeout(() => reject(new CameraError('unavailable', 'Camera produced no frames.')), 8000);
      this.video.addEventListener(
        'loadeddata',
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
  }

  static mapError(err: unknown): CameraError {
    const name = (err as { name?: string })?.name ?? '';
    const message = (err as { message?: string })?.message ?? String(err);
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
      return new CameraError('permission-denied', message);
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'AbortError')
      return new CameraError('unavailable', message);
    return new CameraError('unknown', message);
  }
}
