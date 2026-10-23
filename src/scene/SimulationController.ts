import * as THREE from 'three';
import type { ControlState, GestureEvent } from '../camera/gestureClassifier';
import { clamp, damp } from '../utils/math';
import type { CameraController } from './CameraController';
import type { FieldUniforms } from './InteractionFields';
import type { ObjectSystem } from './ObjectSystem';
import type { ParticleSystem } from './ParticleSystem';
import type { PhysicsController } from './PhysicsController';

export interface HandVisual {
  pos: THREE.Vector3;
  presence: number;
  pose: string;
  pinching: boolean;
  id: number;
}

/** What an event did, for audio and UI. `pan` is -1 (left) .. 1 (right). */
export interface EventOutcome {
  kind: GestureEvent['type'];
  pan: number;
  accepted: boolean;
}

/**
 * Translates interaction controls and events into physical behaviour.
 * Continuous controls are smoothed in world space (detection runs at camera
 * rate, rendering at display rate), then written into the physics state and
 * the shared shader fields.
 */
export class SimulationController {
  private seed = 1;
  readonly hands: HandVisual[] = [];
  private readonly handPool: HandVisual[] = [0, 1].map((id) => ({
    pos: new THREE.Vector3(),
    presence: 0,
    pose: 'neutral',
    pinching: false,
    id,
  }));
  private readonly wellTarget = new THREE.Vector3();
  private readonly aTarget = new THREE.Vector3(-2, 0, 0);
  private readonly bTarget = new THREE.Vector3(2, 0, 0);
  private readonly windTarget = new THREE.Vector3();
  private readonly stormTarget = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private stretchAmountTarget = 0;
  private stretchFactorTarget = 1;
  private stormEnergyTarget = 0;
  private turbulenceTarget = 0;
  private vortexTarget = 0;
  private stormActive = false;
  private wellActive = false;

  constructor(
    readonly physics: PhysicsController,
    private objects: ObjectSystem,
    private particles: ParticleSystem,
    readonly cameraCtl: CameraController,
    readonly fields: FieldUniforms,
  ) {
    physics.onSnapBurst = () => {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      const p = this.physics.singularity.pos;
      this.particles.generate(this.seed, p);
      this.objects.rearrange(this.seed, p);
    };
  }

  /** Swap in rebuilt systems (quality change) without losing physical state. */
  setSystems(objects: ObjectSystem, particles: ParticleSystem): void {
    this.objects = objects;
    this.particles = particles;
  }

  get currentSeed(): number {
    return this.seed;
  }

  /** Continuous controls, called every frame with the latest merged state. */
  applyControls(c: ControlState): void {
    const P = this.physics;
    const cam = this.cameraCtl;

    this.wellActive = c.grab.active;
    P.well.target = c.grab.active ? c.grab.strength : 0;
    if (c.grab.active) cam.controlToWorld(c.grab.pos.x, c.grab.pos.y, this.wellTarget, 1.5);

    if (c.stretch.active) {
      this.stretchAmountTarget = 1;
      this.stretchFactorTarget = c.stretch.factor;
      cam.controlToWorld(c.stretch.a.x, c.stretch.a.y, this.aTarget, 1);
      cam.controlToWorld(c.stretch.b.x, c.stretch.b.y, this.bTarget, 1);
    } else {
      this.stretchAmountTarget = 0;
      this.stretchFactorTarget = 1;
    }

    const s = c.storm;
    this.stormActive = s.active;
    this.stormEnergyTarget = s.energy;
    this.turbulenceTarget = s.turbulence;
    this.vortexTarget = s.vortex;
    if (s.energy > 0.01) {
      cam.controlToWorld(s.pos.x, s.pos.y, this.stormTarget, 1);
      const speed = Math.hypot(s.vel.x, s.vel.y);
      if (speed > 1e-3) {
        cam.controlDirToWorld(s.vel.x, s.vel.y, this.windTarget).multiplyScalar(speed * 2.4);
      } else this.windTarget.set(0, 0, 0);
    } else this.windTarget.set(0, 0, 0);

    P.eraseTarget = c.erase ? 1 : 0;

    // Hand visuals
    this.hands.length = 0;
    c.hands.slice(0, 2).forEach((h, i) => {
      const v = this.handPool[i];
      cam.controlToWorld(h.pos.x, h.pos.y, this.tmp, 1.5);
      if (v.id !== h.id) {
        v.pos.copy(this.tmp);
        v.id = h.id;
      } else v.pos.lerp(this.tmp, 0.5);
      v.presence = h.presence;
      v.pose = h.pose;
      v.pinching = h.pinching;
      this.hands.push(v);
    });
  }

  handleEvent(e: GestureEvent): EventOutcome {
    const P = this.physics;
    const cam = this.cameraCtl;
    switch (e.type) {
      case 'tear': {
        const origin = cam.controlToWorld(e.origin.x, e.origin.y, this.tmp, 0.5);
        const dir = cam.controlDirToWorld(e.direction.x, e.direction.y, this.tmp2);
        const length = clamp(6 + e.speed * 0.9, 6, 13);
        const t = P.triggerTear(origin, dir, length);
        this.particles.applyTear(t, P.params.emission);
        this.objects.applyTear(t);
        return { kind: e.type, pan: clamp(e.origin.x + e.direction.x * 0.5, -1, 1), accepted: true };
      }
      case 'reverse':
        P.triggerReverse();
        return { kind: e.type, pan: clamp(e.origin.x, -1, 1), accepted: true };
      case 'snap': {
        const p = cam.controlToWorld(e.origin.x, e.origin.y, this.tmp, 1);
        // Pull the singularity partway toward the centre so the collapse reads clearly.
        p.multiplyScalar(0.6);
        const ok = P.triggerSnap(p);
        return { kind: e.type, pan: clamp(e.origin.x, -1, 1), accepted: ok };
      }
      case 'freeze':
        if (P.frozen) return { kind: e.type, pan: 0, accepted: false };
        P.frozen = true;
        return { kind: e.type, pan: 0, accepted: true };
      case 'resume':
        if (!P.frozen) return { kind: e.type, pan: 0, accepted: false };
        P.frozen = false;
        return { kind: e.type, pan: 0, accepted: true };
      case 'eraseStart':
        P.eraseTarget = 1;
        return { kind: e.type, pan: 0, accepted: true };
      case 'eraseEnd':
        P.eraseTarget = 0;
        return { kind: e.type, pan: 0, accepted: true };
    }
  }

  setFrozen(frozen: boolean): void {
    this.physics.frozen = frozen;
  }

  /** Advance the world. Returns simulated dt. */
  update(realDt: number, viewport: THREE.Vector2): number {
    const P = this.physics;
    const dt = Math.min(realDt, 1 / 20);
    const simDt = P.step(dt);
    // Smooth continuous fields in real time so they track the hands even when slowed.
    const followDt = simDt > 0 ? dt : 0;

    if (this.wellActive) P.well.pos.lerp(this.wellTarget, 1 - Math.exp(-followDt / 0.08));
    P.stretch.amount = damp(P.stretch.amount, this.stretchAmountTarget, this.stretchAmountTarget > 0 ? 0.15 : 0.6, followDt);
    P.stretch.factor = damp(P.stretch.factor, this.stretchFactorTarget, this.stretchAmountTarget > 0 ? 0.1 : 0.7, followDt);
    if (this.stretchAmountTarget > 0) {
      P.stretch.a.lerp(this.aTarget, 1 - Math.exp(-followDt / 0.08));
      P.stretch.b.lerp(this.bTarget, 1 - Math.exp(-followDt / 0.08));
    }
    const st = P.storm;
    // The storm keeps its momentum briefly after the hand stops.
    const windTau = this.stormActive ? 0.12 : 1.0;
    st.wind.lerp(this.windTarget, 1 - Math.exp(-followDt / windTau));
    st.energy = damp(st.energy, this.stormEnergyTarget, this.stormEnergyTarget > st.energy ? 0.1 : 0.8, followDt);
    st.turbulence = damp(st.turbulence, this.turbulenceTarget, 0.2, followDt);
    st.vortex = damp(st.vortex, this.vortexTarget, this.stormActive ? 0.3 : 1.2, followDt);
    if (this.stormEnergyTarget > 0.01) st.pos.lerp(this.stormTarget, 1 - Math.exp(-followDt / 0.08));

    this.particles.update(simDt, P, viewport);
    this.objects.update(simDt, dt, P, this.cameraCtl.camera, this.hands);
    this.writeFields();
    return simDt;
  }

  private writeFields(): void {
    const P = this.physics;
    const f = this.fields;
    f.uTime.value = P.simTime;
    f.uWell.value.set(P.well.pos.x, P.well.pos.y, P.well.pos.z, P.well.strength * P.params.deformation);
    f.uStretchA.value.set(P.stretch.a.x, P.stretch.a.y, P.stretch.a.z, P.stretch.amount * P.params.deformation);
    f.uStretchB.value.set(P.stretch.b.x, P.stretch.b.y, P.stretch.b.z, P.stretch.factor);
    const s = P.singularity;
    f.uSingularity.value.set(s.pos.x, s.pos.y, s.pos.z, s.amount);
    const t = P.dominantTear();
    f.uTearOrigin.value.set(t.origin.x, t.origin.y, t.origin.z, t.strength * P.params.deformation);
    f.uTearDir.value.set(t.dir.x, t.dir.y, t.dir.z, t.length);
    f.uTearProgress.value = t.progress;
    f.uReverse.value = P.reverse;
    f.uErase.value = P.erase;

    const pu = this.particles.uniforms;
    const lensFromSing = s.amount > P.well.strength * 0.4;
    pu.uLensCenter.value.copy(lensFromSing ? s.pos : P.well.pos);
    pu.uLensStrength.value = Math.max(P.well.strength * 0.4, s.amount * 0.9);
    pu.uLensRadius.value = lensFromSing ? 1.8 : 1.1;
    pu.uTrail.value = 0.06 + P.storm.energy * 0.05 + P.reverse * 0.03;
    pu.uOpacity.value = 1 - P.burstGlow * 0.72 - s.amount * 0.3;
  }
}
