import * as THREE from 'three';
import { shaders } from '../shaders';
import { createRng } from '../utils/math';
import type { FieldUniforms } from './InteractionFields';
import type { PhysicsController, TearState } from './PhysicsController';
import { stretchPoint } from './stretch';

const gauss = (rng: () => number) => (rng() + rng() + rng() + rng() - 2) * 0.8660254;

/**
 * Fixed-capacity particle field. Burst particles live in [0, burstCapacity)
 * and are recycled ring-buffer style; ambient particles fill the rest. All
 * buffers are allocated once; the active ambient count can shrink or grow
 * at runtime for adaptive quality without reallocation.
 *
 * Integration runs on the CPU over typed arrays (forces need to respond to
 * hands immediately); the vertex shader adds procedural shimmer, the lens
 * distortion and velocity-stretched trails.
 */
export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly capacity: number;
  readonly burstCapacity: number;
  private readonly ambientCapacity: number;
  activeAmbient: number;

  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly home: Float32Array;
  private readonly data: Float32Array;
  private readonly lifetime: Float32Array;
  private readonly posAttr: THREE.InstancedBufferAttribute;
  private readonly velAttr: THREE.InstancedBufferAttribute;
  private readonly dataAttr: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private burstHead = 0;
  private burstDirty = false;
  private emitAccumulator = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly tmpOut = new THREE.Vector3();
  private rng = createRng(1);

  constructor(capacity: number, fields: FieldUniforms, seed: number) {
    this.capacity = capacity;
    this.burstCapacity = Math.max(256, Math.floor(capacity * 0.15));
    this.ambientCapacity = capacity - this.burstCapacity;
    this.activeAmbient = this.ambientCapacity;

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.home = new Float32Array(capacity * 3);
    this.data = new Float32Array(capacity * 4);
    this.lifetime = new Float32Array(capacity);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.posAttr = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.velAttr = new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.dataAttr = new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.posAttr);
    geo.setAttribute('iVel', this.velAttr);
    geo.setAttribute('iData', this.dataAttr);
    geo.instanceCount = capacity;
    this.geometry = geo;

    this.uniforms = {
      ...fields,
      uSize: { value: 0.032 },
      uTrail: { value: 0.07 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uLensStrength: { value: 0 },
      uLensRadius: { value: 1.2 },
      uLensCenter: { value: new THREE.Vector3() },
      uFogDensity: { value: 0.034 },
      uOpacity: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: shaders.particle.vertex,
      fragmentShader: shaders.particle.fragment,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;

    this.generate(seed, null);
    for (let i = 0; i < this.burstCapacity; i++) this.killBurst(i);
  }

  get activeCount(): number {
    return this.burstCapacity + this.activeAmbient;
  }

  setActiveFraction(f: number): void {
    this.activeAmbient = Math.max(500, Math.min(this.ambientCapacity, Math.floor(this.ambientCapacity * f)));
    this.geometry.instanceCount = this.activeCount;
  }

  /**
   * Generates home positions for the ambient field from a seed. Different
   * seeds produce related arrangements (same families, new tilt, arms and
   * twist), so a SNAP feels like a transformation, not a reload.
   * When `burstFrom` is given, particles restart at that point and explode.
   */
  generate(seed: number, burstFrom: THREE.Vector3 | null): void {
    const rng = createRng(seed);
    this.rng = createRng(seed ^ 0x9e3779b9);
    const arms = 2 + Math.floor(rng() * 3);
    const twist = 0.25 + rng() * 0.3;
    const diskR = 9 + rng() * 5;
    const thickness = 0.35 + rng() * 0.5;
    const tilt = new THREE.Euler((rng() - 0.5) * 0.9, rng() * Math.PI * 2, (rng() - 0.5) * 0.7);
    const q = new THREE.Quaternion().setFromEuler(tilt);
    const v = this.tmp;
    for (let i = this.burstCapacity; i < this.capacity; i++) {
      const g = rng();
      if (g < 0.5) {
        const r = 2.8 + Math.pow(rng(), 0.7) * diskR;
        const arm = Math.floor(rng() * arms);
        const a = (arm / arms) * Math.PI * 2 + r * twist + gauss(rng) * 0.35;
        v.set(Math.cos(a) * r, gauss(rng) * thickness * (1 - (r / diskR) * 0.5), Math.sin(a) * r).applyQuaternion(q);
      } else if (g < 0.82) {
        const r = 7 + Math.pow(rng(), 0.6) * 28;
        const u = rng() * 2 - 1;
        const th = rng() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        v.set(s * Math.cos(th) * r, u * r * 0.6, s * Math.sin(th) * r - 4);
      } else {
        const r = 2.4 + rng() * 1.8;
        const u = rng() * 2 - 1;
        const th = rng() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        v.set(s * Math.cos(th) * r, u * r, s * Math.sin(th) * r);
      }
      const i3 = i * 3;
      this.home[i3] = v.x;
      this.home[i3 + 1] = v.y;
      this.home[i3 + 2] = v.z;
      const i4 = i * 4;
      this.data[i4] = rng();
      this.data[i4 + 1] = g >= 0.5 && g < 0.82 ? 0.6 + rng() * 0.9 : 0.35 + rng() * 0.65;
      this.data[i4 + 2] = 1;
      this.data[i4 + 3] = 0;
      if (burstFrom) {
        const dx = rng() * 2 - 1;
        const dy = rng() * 2 - 1;
        const dz = rng() * 2 - 1;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const sp = 3 + rng() * 11;
        this.pos[i3] = burstFrom.x + (dx / dl) * 0.2;
        this.pos[i3 + 1] = burstFrom.y + (dy / dl) * 0.2;
        this.pos[i3 + 2] = burstFrom.z + (dz / dl) * 0.2;
        this.vel[i3] = (dx / dl) * sp;
        this.vel[i3 + 1] = (dy / dl) * sp;
        this.vel[i3 + 2] = (dz / dl) * sp;
      } else {
        this.pos[i3] = v.x;
        this.pos[i3 + 1] = v.y;
        this.pos[i3 + 2] = v.z;
        this.vel[i3] = this.vel[i3 + 1] = this.vel[i3 + 2] = 0;
      }
    }
    this.dataAttr.needsUpdate = true;
    this.markDirty();
  }

  private killBurst(i: number): void {
    const i3 = i * 3;
    this.pos[i3] = 0;
    this.pos[i3 + 1] = -500;
    this.pos[i3 + 2] = 0;
    this.vel[i3] = this.vel[i3 + 1] = this.vel[i3 + 2] = 0;
    this.data[i * 4 + 1] = 0;
    this.data[i * 4 + 2] = 0;
    this.data[i * 4 + 3] = 1;
  }

  /** Emits one burst particle from the fixed pool. */
  emit(px: number, py: number, pz: number, vx: number, vy: number, vz: number, life: number, size = 1): void {
    const i = this.burstHead;
    this.burstHead = (this.burstHead + 1) % this.burstCapacity;
    const i3 = i * 3;
    this.pos[i3] = px;
    this.pos[i3 + 1] = py;
    this.pos[i3 + 2] = pz;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    const i4 = i * 4;
    this.data[i4] = this.rng();
    this.data[i4 + 1] = size;
    this.data[i4 + 2] = 1;
    this.data[i4 + 3] = 1;
    this.lifetime[i] = life;
    this.burstDirty = true;
  }

  /** Tear: particles near the fissure are flung apart; a burst escapes from it. */
  applyTear(t: TearState, emission: number): void {
    const { origin, dir, normal, length } = t;
    for (let i = this.burstCapacity; i < this.activeCount; i++) {
      const i3 = i * 3;
      const rx = this.pos[i3] - origin.x;
      const ry = this.pos[i3 + 1] - origin.y;
      const rz = this.pos[i3 + 2] - origin.z;
      const s = rx * dir.x + ry * dir.y + rz * dir.z;
      if (s < -1 || s > length + 1) continue;
      const side = rx * normal.x + ry * normal.y + rz * normal.z;
      const band = Math.exp(-(side * side) / 3);
      if (band < 0.02) continue;
      const imp = Math.sign(side || 1) * band * 7;
      this.vel[i3] += normal.x * imp + dir.x * band * 1.5;
      this.vel[i3 + 1] += normal.y * imp + dir.y * band * 1.5;
      this.vel[i3 + 2] += normal.z * imp;
    }
    const n = Math.floor(Math.min(this.burstCapacity * 0.6, 1400) * emission);
    for (let k = 0; k < n; k++) {
      const s = this.rng() * length;
      const side = this.rng() < 0.5 ? -1 : 1;
      const sp = 2 + this.rng() * 7;
      this.emit(
        origin.x + dir.x * s,
        origin.y + dir.y * s,
        origin.z + dir.z * s + (this.rng() - 0.5) * 0.6,
        normal.x * side * sp + dir.x * (this.rng() * 3),
        normal.y * side * sp + dir.y * (this.rng() * 3),
        (this.rng() - 0.3) * 4,
        0.8 + this.rng() * 1.6,
        0.6 + this.rng() * 1.2,
      );
    }
  }

  update(simDt: number, P: PhysicsController, viewport: THREE.Vector2): void {
    this.uniforms.uViewport.value.copy(viewport);
    if (simDt <= 0) return;
    const dt = simDt;
    const t = P.simTime;
    const params = P.params;
    const pos = this.pos;
    const vel = this.vel;
    const data = this.data;
    const end = this.activeCount;

    // Storm density: an energetic hand sheds particles.
    const st = P.storm;
    if (st.energy > 0.05) {
      this.emitAccumulator += st.energy * 900 * params.emission * dt;
      while (this.emitAccumulator >= 1) {
        this.emitAccumulator -= 1;
        const r = this.rng;
        this.emit(
          st.pos.x + (r() - 0.5) * 0.8,
          st.pos.y + (r() - 0.5) * 0.8,
          st.pos.z + (r() - 0.5) * 0.8,
          st.wind.x * 0.6 + (r() - 0.5) * 2,
          st.wind.y * 0.6 + (r() - 0.5) * 2,
          (r() - 0.5) * 2,
          0.6 + r() * 1.4,
          0.4 + r() * 0.6,
        );
      }
    }

    // --- Burst particles ---------------------------------------------------
    const gUp = P.reverse * params.reverseGravity * 0.5 - 0.6 * (1 - P.reverse);
    const burstDrag = Math.exp(-1.1 * dt);
    let burstChanged = this.burstDirty;
    for (let i = 0; i < this.burstCapacity; i++) {
      const i4 = i * 4;
      if (data[i4 + 2] <= 0) continue;
      data[i4 + 2] -= dt / this.lifetime[i];
      burstChanged = true;
      if (data[i4 + 2] <= 0) {
        this.killBurst(i);
        continue;
      }
      const i3 = i * 3;
      vel[i3] = (vel[i3] + st.wind.x * 0.4 * dt) * burstDrag;
      vel[i3 + 1] = (vel[i3 + 1] + (gUp + st.wind.y * 0.4) * dt) * burstDrag;
      vel[i3 + 2] *= burstDrag;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
    }
    this.burstDirty = false;

    // --- Ambient field -----------------------------------------------------
    const rev = P.reverse;
    const homeK = 0.2 * (1 - rev * 0.92) * params.homeSpring;
    const revG = rev * params.reverseGravity;
    const damping = Math.exp(-0.6 * P.damping * dt);
    const well = P.well;
    const wellOn = well.strength > 0.01;
    const wA = well.strength * params.attraction;
    const wx = well.pos.x,
      wy = well.pos.y,
      wz = well.pos.z;
    const stretchOn = P.stretch.amount > 0.01;
    const stormOn = st.energy > 0.01 || st.wind.lengthSq() > 0.01;
    const windK = params.windStrength;
    const vortK = st.vortex * params.vortexIntensity;
    const turbK = (st.turbulence * 0.7 + st.energy * 0.3) * params.turbulence;
    const sx = st.pos.x,
      sy = st.pos.y,
      sz = st.pos.z;
    const sing = P.singularity;
    const collapsing = sing.phase === 'collapse';
    const singK = 16 * sing.amount;
    const cx = sing.pos.x,
      cy = sing.pos.y,
      cz = sing.pos.z;
    const flow = 0.06;
    const hv = this.tmp;
    const ho = this.tmpOut;

    for (let i = this.burstCapacity; i < end; i++) {
      const i3 = i * 3;
      const px = pos[i3],
        py = pos[i3 + 1],
        pz = pos[i3 + 2];
      let hx = this.home[i3],
        hy = this.home[i3 + 1],
        hz = this.home[i3 + 2];
      if (stretchOn) {
        hv.set(hx, hy, hz);
        stretchPoint(ho, hv, P, 0.85);
        hx = ho.x;
        hy = ho.y;
        hz = ho.z;
      }
      const seed = data[i * 4];
      const k = homeK * (0.6 + seed * 0.8);
      let ax = (hx - px) * k - pz * flow;
      let ay = (hy - py) * k + revG * (0.6 + seed * 0.8);
      let az = (hz - pz) * k + px * flow;

      if (wellOn) {
        const dx = wx - px,
          dy = wy - py,
          dz = wz - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const fall = Math.exp(-d2 / 24);
        if (fall > 0.002) {
          const inv = (wA * fall) / (Math.sqrt(d2) + 0.5);
          // Radial pull plus a tangential swirl: curved orbits around the palm.
          ax += dx * inv - dy * inv * 0.7;
          ay += dy * inv + dx * inv * 0.7;
          az += dz * inv;
        }
      }
      if (stormOn) {
        const dx = px - sx,
          dy = py - sy,
          dz = pz - sz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const fall = Math.exp(-d2 / 40) + 0.08;
        ax += st.wind.x * windK * fall - dy * vortK * fall;
        ay += st.wind.y * windK * fall + dx * vortK * fall;
        az += st.wind.z * windK * fall;
        if (turbK > 0.01) {
          ax += Math.sin(py * 1.7 + t * 3.1 + seed * 19) * turbK * fall;
          ay += Math.sin(pz * 1.3 + t * 2.7 + seed * 23) * turbK * fall;
          az += Math.sin(px * 1.5 + t * 2.3 + seed * 29) * turbK * fall;
        }
      }
      if (collapsing) {
        ax += (cx - px) * singK;
        ay += (cy - py) * singK;
        az += (cz - pz) * singK;
      }

      let vx = (vel[i3] + ax * dt) * damping;
      let vy = (vel[i3 + 1] + ay * dt) * damping;
      let vz = (vel[i3 + 2] + az * dt) * damping;
      if (collapsing) {
        const c = 1 - sing.amount * 0.5 * dt * 10;
        vx *= c;
        vy *= c;
        vz *= c;
      }
      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
      let ny = py + vy * dt;
      // Inverted waterfall: during reversal, particles leaving the top re-enter below.
      if (rev > 0.3 && ny > 16) {
        ny = -14 + (ny - 16);
        vel[i3 + 1] *= 0.3;
      }
      pos[i3] = px + vx * dt;
      pos[i3 + 1] = ny;
      pos[i3 + 2] = pz + vz * dt;
    }

    if (burstChanged) {
      this.dataAttr.clearUpdateRanges();
      this.dataAttr.addUpdateRange(0, this.burstCapacity * 4);
      this.dataAttr.needsUpdate = true;
    }
    this.markDirty();
  }

  /** Marks the active range of position/velocity for upload. */
  private markDirty(): void {
    const n = this.activeCount * 3;
    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, n);
    this.posAttr.needsUpdate = true;
    this.velAttr.clearUpdateRanges();
    this.velAttr.addUpdateRange(0, n);
    this.velAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
