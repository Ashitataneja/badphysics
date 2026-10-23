import { clamp, expAlpha, type Vec2 } from './math';

/**
 * Time-based exponential smoother for a scalar. Behaviour is independent of
 * frame rate because the blend factor derives from elapsed time.
 */
export class ScalarSmoother {
  value: number;
  private initialised = false;

  constructor(
    public tau: number,
    initial = 0,
  ) {
    this.value = initial;
  }

  update(sample: number, dt: number): number {
    if (!this.initialised) {
      this.value = sample;
      this.initialised = true;
      return sample;
    }
    this.value += (sample - this.value) * expAlpha(dt, this.tau);
    return this.value;
  }

  reset(value = 0): void {
    this.value = value;
    this.initialised = false;
  }
}

/**
 * Smooths a 2D position and estimates velocity and acceleration from the
 * smoothed signal. Velocities are clamped so tracking jumps (e.g. landmark
 * reassignment between hands) cannot inject huge forces.
 */
export class KinematicSmoother {
  readonly pos: Vec2 = { x: 0, y: 0 };
  readonly vel: Vec2 = { x: 0, y: 0 };
  readonly acc: Vec2 = { x: 0, y: 0 };
  speed = 0;
  private initialised = false;

  constructor(
    public positionTau: number,
    public velocityTau: number,
    public maxSpeed: number,
    public jumpThreshold: number,
  ) {}

  /** Returns true when the sample was treated as a discontinuity (jump). */
  update(x: number, y: number, dt: number): boolean {
    if (!this.initialised || dt <= 0) {
      this.hardReset(x, y);
      return !this.initialised;
    }
    const jump = Math.hypot(x - this.pos.x, y - this.pos.y);
    if (jump > this.jumpThreshold) {
      this.hardReset(x, y);
      return true;
    }
    const a = expAlpha(dt, this.positionTau);
    const nx = this.pos.x + (x - this.pos.x) * a;
    const ny = this.pos.y + (y - this.pos.y) * a;
    let vx = (nx - this.pos.x) / dt;
    let vy = (ny - this.pos.y) / dt;
    const s = Math.hypot(vx, vy);
    if (s > this.maxSpeed) {
      vx *= this.maxSpeed / s;
      vy *= this.maxSpeed / s;
    }
    const b = expAlpha(dt, this.velocityTau);
    const pvx = this.vel.x;
    const pvy = this.vel.y;
    this.vel.x += (vx - this.vel.x) * b;
    this.vel.y += (vy - this.vel.y) * b;
    const ax = clamp((this.vel.x - pvx) / dt, -200, 200);
    const ay = clamp((this.vel.y - pvy) / dt, -200, 200);
    this.acc.x += (ax - this.acc.x) * b;
    this.acc.y += (ay - this.acc.y) * b;
    this.pos.x = nx;
    this.pos.y = ny;
    this.speed = Math.hypot(this.vel.x, this.vel.y);
    return false;
  }

  hardReset(x: number, y: number): void {
    this.pos.x = x;
    this.pos.y = y;
    this.vel.x = this.vel.y = 0;
    this.acc.x = this.acc.y = 0;
    this.speed = 0;
    this.initialised = true;
  }

  get ready(): boolean {
    return this.initialised;
  }

  reset(): void {
    this.initialised = false;
    this.vel.x = this.vel.y = this.acc.x = this.acc.y = 0;
    this.speed = 0;
  }
}
