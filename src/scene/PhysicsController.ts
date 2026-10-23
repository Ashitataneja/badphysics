import * as THREE from 'three';
import { clamp, damp } from '../utils/math';

export interface PhysicsParams {
  /** Downward pull on loose objects, balanced by their home springs. */
  baseGravity: number;
  /** Upward acceleration at full reversal. */
  reverseGravity: number;
  /** Gravity-well attraction strength. */
  attraction: number;
  windStrength: number;
  turbulence: number;
  vortexIntensity: number;
  /** Multiplier on all geometry deformation. */
  deformation: number;
  /** Multiplier on burst particle emission. */
  emission: number;
  /** How much slow-motion a major event introduces (0..1). */
  timeDilation: number;
  /** Extra damping applied while recovering after an event. */
  recoveryDamping: number;
  /** How hard objects return to their home arrangement. */
  homeSpring: number;
}

export interface TearState {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  normal: THREE.Vector3;
  length: number;
  age: number;
  strength: number;
  progress: number;
  seed: number;
}

export type SnapPhase = 'idle' | 'collapse' | 'burst';

const TEAR_LIFE = 2.4;
const TEAR_GROW = 0.35;
export const SNAP_COLLAPSE = 0.55;
const SNAP_BURST = 0.6;
const REVERSE_HOLD = 3.6;

/**
 * Global physical state of the impossible universe. Owns the time base
 * (freeze and time dilation), gravity reversal, tear and singularity
 * lifecycles, and the smoothed continuous fields that objects, particles and
 * shaders read. Every update uses a bounded delta time.
 */
export class PhysicsController {
  params: PhysicsParams = {
    baseGravity: 0.35,
    reverseGravity: 7.5,
    attraction: 22,
    windStrength: 1.5,
    turbulence: 6,
    vortexIntensity: 9,
    deformation: 1,
    emission: 1,
    timeDilation: 0.7,
    recoveryDamping: 1.4,
    homeSpring: 1.1,
  };

  /** Seconds of simulated time (stops while frozen). */
  simTime = 0;
  /** Scale applied to real dt this frame. */
  timeScale = 1;
  frozen = false;
  /** 0..1 eased freeze amount for visuals. */
  freezeBlend = 0;
  private dilation = 0;

  reverse = 0;
  private reverseHold = 0;

  readonly well = { pos: new THREE.Vector3(), strength: 0, target: 0, proximity: 0 };
  readonly stretch = {
    a: new THREE.Vector3(-2, 0, 0),
    b: new THREE.Vector3(2, 0, 0),
    factor: 1,
    amount: 0,
  };
  readonly storm = {
    pos: new THREE.Vector3(),
    wind: new THREE.Vector3(),
    energy: 0,
    turbulence: 0,
    vortex: 0,
  };
  erase = 0;
  eraseTarget = 0;

  readonly singularity = { pos: new THREE.Vector3(), amount: 0, phase: 'idle' as SnapPhase, t: 0 };
  readonly tears: TearState[] = [0, 1].map(() => ({
    origin: new THREE.Vector3(),
    dir: new THREE.Vector3(1, 0, 0),
    normal: new THREE.Vector3(0, 1, 0),
    length: 0,
    age: TEAR_LIFE,
    strength: 0,
    progress: 0,
    seed: 0,
  }));
  private tearIndex = 0;

  /** Visual intensity of the current breach (0..1). */
  breach = 0;
  flash = 0;
  shake = 0;
  /** 1 at a snap burst, decaying: keeps the explosion from saturating. */
  burstGlow = 0;
  /** Extra damping after an event so things settle into new configurations. */
  recovery = 0;

  /** Set by SimulationController when a snap reaches its burst moment. */
  onSnapBurst: (() => void) | null = null;

  /** Advances time. Returns the simulated dt for this frame. */
  step(realDt: number): number {
    const dt = clamp(realDt, 0, 1 / 20);
    this.dilation = damp(this.dilation, 0, 0.55, dt);
    const targetScale = this.frozen ? 0 : 1 - this.dilation * this.params.timeDilation;
    this.timeScale = damp(this.timeScale, targetScale, this.frozen ? 0.12 : 0.18, dt);
    if (this.frozen && this.timeScale < 0.01) this.timeScale = 0;
    this.freezeBlend = damp(this.freezeBlend, this.frozen ? 1 : 0, 0.25, dt);
    const simDt = dt * this.timeScale;
    this.simTime += simDt;

    // Gravity reversal: hold, then decay smoothly back to normal.
    this.reverseHold = Math.max(0, this.reverseHold - simDt);
    this.reverse = damp(this.reverse, this.reverseHold > 0 ? 1 : 0, this.reverseHold > 0 ? 0.25 : 1.1, simDt);
    if (this.reverse < 1e-3) this.reverse = 0;

    for (const t of this.tears) {
      if (t.age >= TEAR_LIFE) continue;
      t.age += simDt;
      t.progress = clamp(t.age / TEAR_GROW, 0, 1);
      const fade = 1 - clamp((t.age - 1.2) / (TEAR_LIFE - 1.2), 0, 1);
      t.strength = fade * fade;
      if (t.age >= TEAR_LIFE) t.strength = 0;
    }

    const s = this.singularity;
    if (s.phase === 'collapse') {
      s.t += simDt;
      const k = clamp(s.t / SNAP_COLLAPSE, 0, 1);
      s.amount = k * k * (3 - 2 * k) * 0.92;
      if (s.t >= SNAP_COLLAPSE) {
        s.phase = 'burst';
        s.t = 0;
        this.flash = Math.max(this.flash, 1);
        this.shake = Math.max(this.shake, 1);
        this.burstGlow = 1;
        this.onSnapBurst?.();
      }
    } else if (s.phase === 'burst') {
      s.t += simDt;
      s.amount = damp(s.amount, 0, 0.08, simDt);
      if (s.t >= SNAP_BURST) {
        s.phase = 'idle';
        s.amount = 0;
      }
    }

    this.erase = damp(this.erase, this.eraseTarget, 0.7, dt);
    this.breach = damp(this.breach, 0, 0.6, dt);
    this.flash = damp(this.flash, 0, 0.12, dt);
    this.shake = damp(this.shake, 0, 0.35, dt);
    this.burstGlow = damp(this.burstGlow, 0, 0.7, dt);
    this.recovery = damp(this.recovery, 0, 1.2, simDt);
    this.well.strength = damp(this.well.strength, this.well.target, this.well.target > this.well.strength ? 0.15 : 0.45, simDt || dt);
    return simDt;
  }

  triggerReverse(): void {
    this.reverseHold = REVERSE_HOLD;
    this.dilation = 1;
    this.breach = 1;
    this.shake = Math.max(this.shake, 0.5);
  }

  triggerTear(origin: THREE.Vector3, dir: THREE.Vector3, length: number): TearState {
    const t = this.tears[this.tearIndex];
    this.tearIndex = (this.tearIndex + 1) % this.tears.length;
    t.origin.copy(origin);
    t.dir.copy(dir).normalize();
    t.normal.set(-t.dir.y, t.dir.x, 0).normalize();
    t.length = length;
    t.age = 0;
    t.progress = 0;
    t.strength = 1;
    t.seed = Math.random() * 10;
    this.dilation = Math.max(this.dilation, 0.6);
    this.breach = 1;
    this.flash = Math.max(this.flash, 0.6);
    this.shake = Math.max(this.shake, 0.8);
    this.recovery = 1;
    return t;
  }

  triggerSnap(point: THREE.Vector3): boolean {
    if (this.singularity.phase !== 'idle') return false;
    this.singularity.pos.copy(point);
    this.singularity.phase = 'collapse';
    this.singularity.t = 0;
    this.singularity.amount = 0;
    this.dilation = 0.8;
    this.breach = 1;
    this.recovery = 1;
    return true;
  }

  /** The tear that currently dominates the visuals. */
  dominantTear(): TearState {
    return this.tears[0].strength >= this.tears[1].strength ? this.tears[0] : this.tears[1];
  }

  /** Overall damping multiplier; rises after events so motion settles. */
  get damping(): number {
    return 1 + this.recovery * this.params.recoveryDamping;
  }

  reset(): void {
    this.simTime = 0;
    this.timeScale = 1;
    this.frozen = false;
    this.freezeBlend = 0;
    this.dilation = 0;
    this.reverse = 0;
    this.reverseHold = 0;
    this.well.strength = this.well.target = 0;
    this.stretch.amount = 0;
    this.stretch.factor = 1;
    this.storm.energy = 0;
    this.storm.wind.set(0, 0, 0);
    this.erase = this.eraseTarget = 0;
    this.singularity.phase = 'idle';
    this.singularity.amount = 0;
    for (const t of this.tears) {
      t.age = TEAR_LIFE;
      t.strength = 0;
    }
    this.breach = this.flash = this.shake = this.recovery = this.burstGlow = 0;
  }
}
