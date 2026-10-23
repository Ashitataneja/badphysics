/**
 * Rolling frame-time monitor. Uses a fixed-size ring buffer so it never
 * allocates during the render loop.
 */
export class PerformanceMonitor {
  private readonly samples: Float32Array;
  private index = 0;
  private count = 0;
  private lastFpsAt = 0;
  private framesSinceFps = 0;
  fps = 60;
  frameMs = 16.7;
  detectMs = 0;

  constructor(size = 120) {
    this.samples = new Float32Array(size);
  }

  /** Record a frame duration in milliseconds. */
  frame(ms: number, now: number): void {
    this.samples[this.index] = ms;
    this.index = (this.index + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
    this.frameMs += (ms - this.frameMs) * 0.08;
    this.framesSinceFps++;
    if (now - this.lastFpsAt >= 500) {
      this.fps = (this.framesSinceFps * 1000) / Math.max(1, now - this.lastFpsAt);
      this.framesSinceFps = 0;
      this.lastFpsAt = now;
    }
  }

  recordDetection(ms: number): void {
    this.detectMs += (ms - this.detectMs) * 0.2;
  }

  /** Average frame time across the buffered window. */
  average(): number {
    if (this.count === 0) return 16.7;
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.samples[i];
    return sum / this.count;
  }

  get filled(): boolean {
    return this.count === this.samples.length;
  }

  reset(): void {
    this.count = 0;
    this.index = 0;
  }
}
