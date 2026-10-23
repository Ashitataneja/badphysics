import * as THREE from 'three';
import { shaders } from '../shaders';
import { createRng, expAlpha } from '../utils/math';
import type { FieldUniforms } from './InteractionFields';
import type { PhysicsController, TearState } from './PhysicsController';
import { stretchPoint } from './stretch';

export const PALETTE = {
  void: new THREE.Color(0.012, 0.015, 0.035),
  bone: new THREE.Color(0.91, 0.89, 0.84),
  cobalt: new THREE.Color(0.16, 0.34, 1.0),
  lime: new THREE.Color(0.78, 0.96, 0.22),
  vermilion: new THREE.Color(1.0, 0.28, 0.1),
  chrome: new THREE.Color(0.82, 0.85, 0.92),
};

// Lime stays a rare highlight; it never becomes a surface accent.
const ACCENTS = [PALETTE.cobalt, PALETTE.vermilion, PALETTE.bone];

export interface ObjectCounts {
  coreDetail: number;
  spheres: number;
  polys: number;
  blobs: number;
  shards: number;
  ribbons: number;
  ribbonPoints: number;
}

interface LiquidOptions {
  displace?: number;
  frequency?: number;
  fieldInfluence?: number;
  stretchInfluence?: number;
  tint?: THREE.Color;
  chrome?: number;
  opacity?: number;
  flat?: boolean;
  wire?: boolean;
  melt?: number;
}

/** Shared material factory for Shader A (liquid displacement) variants. */
function liquidMaterial(fields: FieldUniforms, common: Record<string, THREE.IUniform>, o: LiquidOptions) {
  const defines: Record<string, string> = {};
  if (o.flat) defines.FLAT = '';
  if (o.wire) defines.WIRE = '';
  return new THREE.ShaderMaterial({
    vertexShader: shaders.liquid.vertex,
    fragmentShader: shaders.liquid.fragment,
    defines,
    wireframe: !!o.wire,
    transparent: !!o.wire || (o.opacity ?? 1) < 1,
    depthWrite: !o.wire,
    blending: o.wire ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      ...fields,
      ...common,
      uDisplace: { value: o.displace ?? 0 },
      uFrequency: { value: o.frequency ?? 0.8 },
      uSeed: { value: 0 },
      uFieldInfluence: { value: o.fieldInfluence ?? 1 },
      uStretchInfluence: { value: o.stretchInfluence ?? 0 },
      uMelt: { value: o.melt ?? 0 },
      uTint: { value: (o.tint ?? PALETTE.chrome).clone() },
      uChrome: { value: o.chrome ?? 1 },
      uOpacity: { value: o.opacity ?? 1 },
    },
  });
}

/** Structure-of-arrays state for every floating body, rendered through InstancedMesh. */
class Bodies {
  count = 0;
  pos: Float32Array;
  vel: Float32Array;
  home: Float32Array;
  rot: Float32Array;
  ang: Float32Array;
  scale: Float32Array;
  rand: Float32Array;
  mesh: THREE.InstancedMesh[] = [];
  index: Uint16Array;

  constructor(capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.home = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.ang = new Float32Array(capacity * 3);
    this.scale = new Float32Array(capacity);
    this.rand = new Float32Array(capacity);
    this.index = new Uint16Array(capacity);
  }

  add(mesh: THREE.InstancedMesh, index: number, home: THREE.Vector3, scale: number, rand: number): void {
    const i = this.count++;
    this.mesh[i] = mesh;
    this.index[i] = index;
    this.home.set([home.x, home.y, home.z], i * 3);
    this.pos.set([home.x, home.y, home.z], i * 3);
    this.scale[i] = scale;
    this.rand[i] = rand;
    this.rot.set([rand * 6, rand * 13, rand * 3], i * 3);
    this.ang.set([(rand - 0.5) * 0.4, (rand - 0.3) * 0.5, (0.5 - rand) * 0.3], i * 3);
  }
}

interface Ribbon {
  points: Float32Array;
  geometry: THREE.BufferGeometry;
  position: THREE.BufferAttribute;
  phase: number;
  radius: number;
  speed: number;
}

/**
 * The family of abstract objects: a deformable central structure with a
 * wireframe shell, chrome spheres, wireframe polyhedra, organic blob
 * clusters, fragments, procedural ribbons, light shafts, a backdrop and
 * subtle hand markers.
 */
export class ObjectSystem {
  readonly group = new THREE.Group();
  readonly core: THREE.Mesh;
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly shell: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly bodies: Bodies;
  private readonly instanced: THREE.InstancedMesh[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly liquidMats: THREE.ShaderMaterial[] = [];
  private readonly ribbons: Ribbon[] = [];
  private readonly ribbonMat: THREE.ShaderMaterial;
  private readonly shafts: THREE.Mesh[] = [];
  readonly handMarkers: THREE.Mesh[] = [];
  private readonly common: Record<string, THREE.IUniform>;
  private coreScale = 1;
  private coreScaleVel = 0;
  private coreSeed = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();
  private readonly counts: ObjectCounts;

  constructor(fields: FieldUniforms, counts: ObjectCounts, seed: number) {
    this.counts = counts;
    this.common = {
      uAccent: { value: PALETTE.cobalt.clone() },
      uFogColor: { value: PALETTE.void.clone() },
      uFogDensity: { value: 0.034 },
    };

    // Backdrop
    const backGeo = this.track(new THREE.SphereGeometry(90, 32, 16));
    const backMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: shaders.backdrop.vertex,
        fragmentShader: shaders.backdrop.fragment,
        uniforms: { uTime: fields.uTime, uReverse: fields.uReverse },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    const backdrop = new THREE.Mesh(backGeo, backMat);
    backdrop.renderOrder = -10;
    this.group.add(backdrop);

    // Light shafts: practical volumetric illusion.
    const shaftGeo = this.track(new THREE.PlaneGeometry(3.2, 34));
    const shaftDefs: [THREE.Color, number, number, number, number][] = [
      [PALETTE.bone, -6, 8, -14, 0.42],
      [PALETTE.cobalt, 3, 9, -18, -0.25],
      [PALETTE.bone, 9, 7, -22, -0.55],
    ];
    shaftDefs.forEach(([color, x, y, z, rz], i) => {
      const mat = this.trackMat(
        new THREE.ShaderMaterial({
          vertexShader: shaders.lightShaft.vertex,
          fragmentShader: shaders.lightShaft.fragment,
          uniforms: {
            uColor: { value: color.clone() },
            uIntensity: { value: i === 1 ? 0.1 : 0.07 },
            uSeed: { value: i * 1.7 },
            uTime: fields.uTime,
            uErase: fields.uErase,
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      const m = new THREE.Mesh(shaftGeo, mat);
      m.position.set(x, y, z);
      m.rotation.set(0, 0, rz);
      m.renderOrder = -5;
      this.shafts.push(m);
      this.group.add(m);
    });

    // Central structure
    const coreGeo = this.track(new THREE.IcosahedronGeometry(1.65, counts.coreDetail));
    this.coreMat = this.liquid(fields, {
      displace: 0.3,
      frequency: 0.62,
      fieldInfluence: 1,
      stretchInfluence: 1,
      melt: 0.12,
    });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.group.add(this.core);

    const shellGeo = this.track(new THREE.IcosahedronGeometry(2.9, 1));
    this.shell = new THREE.Mesh(
      shellGeo,
      this.liquid(fields, { wire: true, tint: PALETTE.bone, opacity: 0.22, fieldInfluence: 0.8, stretchInfluence: 1 }),
    );
    this.group.add(this.shell);

    const haloGeo = this.track(new THREE.TorusGeometry(3.6, 0.018, 6, 220));
    this.halo = new THREE.Mesh(
      haloGeo,
      this.liquid(fields, { tint: PALETTE.bone, chrome: 1.4, fieldInfluence: 0.9, stretchInfluence: 0.9 }),
    );
    this.halo.rotation.set(1.2, 0.2, 0.3);
    this.group.add(this.halo);

    // Floating bodies
    const total = counts.spheres + counts.polys + counts.blobs + counts.shards;
    this.bodies = new Bodies(total);
    const sphereGeo = this.track(new THREE.IcosahedronGeometry(1, Math.max(3, Math.floor(counts.coreDetail / 3))));
    const blobGeo = this.track(new THREE.IcosahedronGeometry(1, 3));
    const shardGeo = this.track(new THREE.TetrahedronGeometry(1, 0));
    const polyGeos = [
      new THREE.OctahedronGeometry(1, 0),
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.IcosahedronGeometry(1, 0),
    ].map((g) => this.track(g));

    const spheres = this.instancedMesh(
      sphereGeo,
      this.liquid(fields, { displace: 0.12, frequency: 0.8, fieldInfluence: 0.4 }),
      counts.spheres,
    );
    const polysPer = Math.ceil(counts.polys / 3);
    const polys = polyGeos.map((g, i) =>
      this.instancedMesh(
        g,
        this.liquid(fields, {
          wire: true,
          tint: i === 1 ? PALETTE.cobalt : PALETTE.bone,
          opacity: i === 1 ? 0.55 : 0.38,
          fieldInfluence: 0.3,
        }),
        polysPer,
      ),
    );
    const blobs = this.instancedMesh(
      blobGeo,
      this.liquid(fields, { displace: 0.26, frequency: 1.15, fieldInfluence: 0.5, tint: new THREE.Color(0.7, 0.74, 0.86) }),
      counts.blobs,
    );
    const shards = this.instancedMesh(
      shardGeo,
      this.liquid(fields, { flat: true, tint: PALETTE.bone, chrome: 1.1, fieldInfluence: 0.3 }),
      counts.shards,
    );

    const rng = createRng(seed);
    const h = new THREE.Vector3();
    const randDir = (out: THREE.Vector3) => {
      const u = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      return out.set(s * Math.cos(t), u, s * Math.sin(t));
    };
    for (let i = 0; i < counts.spheres; i++) {
      randDir(h).multiplyScalar(5 + rng() * 5);
      h.y *= 0.6;
      this.bodies.add(spheres, i, h, 0.3 + rng() * rng() * 1.1, rng());
    }
    for (let i = 0; i < counts.polys; i++) {
      const mesh = polys[i % 3];
      const idx = Math.floor(i / 3);
      if (idx >= polysPer) continue;
      randDir(h).multiplyScalar(4.5 + rng() * 9);
      h.z -= 2;
      this.bodies.add(mesh, idx, h, 0.25 + rng() * 0.9, rng());
    }
    const clusters = Math.max(2, Math.round(counts.blobs / 6));
    const centres = Array.from({ length: clusters }, () => {
      const c = randDir(new THREE.Vector3()).multiplyScalar(6.5 + rng() * 3);
      c.y *= 0.5;
      return c;
    });
    for (let i = 0; i < counts.blobs; i++) {
      randDir(h)
        .multiplyScalar(0.3 + rng() * 0.9)
        .add(centres[i % clusters]);
      this.bodies.add(blobs, i, h, 0.22 + rng() * 0.45, rng());
    }
    const ringTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 0, -0.25));
    for (let i = 0; i < counts.shards; i++) {
      const a = rng() * Math.PI * 2;
      const r = 3.6 + rng() * 4.5;
      h.set(Math.cos(a) * r, (rng() - 0.5) * 0.9, Math.sin(a) * r).applyQuaternion(ringTilt);
      this.bodies.add(shards, i, h, 0.05 + rng() * rng() * 0.22, rng());
    }
    for (const m of this.instanced) m.count = m.userData.capacity;
    polys.forEach((m, i) => (m.count = Math.min(polysPer, Math.floor((counts.polys - i + 2) / 3))));

    // Ribbons
    this.ribbonMat = this.trackMat(
      new THREE.ShaderMaterial({
        vertexShader: shaders.ribbon.vertex,
        fragmentShader: shaders.ribbon.fragment,
        uniforms: {
          uHead: { value: PALETTE.bone.clone() },
          uTailColor: { value: PALETTE.cobalt.clone() },
          uOpacity: { value: 0.55 },
          uTime: fields.uTime,
          uErase: fields.uErase,
          uFogDensity: this.common.uFogDensity,
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      }),
    );
    const M = counts.ribbonPoints;
    for (let r = 0; r < counts.ribbons; r++) {
      const geo = this.track(new THREE.BufferGeometry());
      const position = new THREE.BufferAttribute(new Float32Array(M * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const along = new Float32Array(M * 2);
      const side = new Float32Array(M * 2);
      const index: number[] = [];
      for (let j = 0; j < M; j++) {
        along[j * 2] = along[j * 2 + 1] = 1 - j / (M - 1);
        side[j * 2] = -1;
        side[j * 2 + 1] = 1;
        if (j < M - 1) {
          const a = j * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      geo.setAttribute('position', position);
      geo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
      geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      geo.setIndex(index);
      const mesh = new THREE.Mesh(geo, this.ribbonMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      const points = new Float32Array(M * 3);
      const ribbon: Ribbon = {
        points,
        geometry: geo,
        position,
        phase: rng() * Math.PI * 2,
        radius: 3.8 + rng() * 3,
        speed: 0.18 + rng() * 0.2,
      };
      this.ribbonHead(ribbon, r, 0, this.v);
      for (let j = 0; j < M; j++) points.set([this.v.x, this.v.y, this.v.z - j * 0.05], j * 3);
      this.ribbons.push(ribbon);
    }

    // Hand markers: a small ring that never obstructs the canvas.
    const ringGeo = this.track(new THREE.RingGeometry(0.17, 0.2, 48));
    for (let i = 0; i < 2; i++) {
      const mat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: PALETTE.bone,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const m = new THREE.Mesh(ringGeo, mat);
      m.renderOrder = 10;
      m.visible = false;
      this.handMarkers.push(m);
      this.group.add(m);
    }
  }

  private track<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private liquid(fields: FieldUniforms, o: LiquidOptions): THREE.ShaderMaterial {
    const m = this.trackMat(liquidMaterial(fields, this.common, o));
    this.liquidMats.push(m);
    return m;
  }

  private instancedMesh(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.userData.capacity = count;
    this.instanced.push(m);
    this.group.add(m);
    return m;
  }

  private ribbonHead(r: Ribbon, i: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const a = t * r.speed + r.phase;
    return out.set(
      Math.cos(a) * r.radius,
      Math.sin(a * 1.31 + i) * r.radius * 0.45,
      Math.sin(a * 0.83) * r.radius * 0.6 - 1,
    );
  }

  setFog(density: number): void {
    this.common.uFogDensity.value = density;
  }

  /** Re-forms the arrangement after a SNAP: related to the old one, but transformed. */
  rearrange(seed: number, from: THREE.Vector3): void {
    const rng = createRng(seed);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rng() - 0.5) * 1.6, rng() * Math.PI * 2, (rng() - 0.5) * 1.2),
    );
    const b = this.bodies;
    for (let i = 0; i < b.count; i++) {
      const i3 = i * 3;
      this.v.set(b.home[i3], b.home[i3 + 1], b.home[i3 + 2]).applyQuaternion(q);
      this.v.multiplyScalar(0.8 + rng() * 0.45);
      this.v.y = Math.max(-7, Math.min(7, this.v.y));
      b.home.set([this.v.x, this.v.y, this.v.z], i3);
      // Burst outward from the singularity.
      this.v2.set(b.pos[i3] - from.x, b.pos[i3 + 1] - from.y, b.pos[i3 + 2] - from.z);
      if (this.v2.lengthSq() < 1e-4) this.v2.set(rng() - 0.5, rng() - 0.5, rng() - 0.5);
      this.v2.normalize().multiplyScalar(6 + rng() * 10);
      b.vel.set([this.v2.x, this.v2.y, this.v2.z], i3);
      b.ang[i3] += (rng() - 0.5) * 6;
      b.ang[i3 + 1] += (rng() - 0.5) * 6;
    }
    this.coreSeed = rng() * 100;
    for (const m of this.liquidMats) m.uniforms.uSeed.value = this.coreSeed + (m === this.coreMat ? 0 : rng() * 10);
    this.coreMat.uniforms.uFrequency.value = 0.5 + rng() * 0.35;
    this.common.uAccent.value.copy(ACCENTS[Math.floor(rng() * ACCENTS.length)]);
    this.coreScaleVel = 9; // elastic overshoot as it re-forms
  }

  applyTear(t: TearState): void {
    const b = this.bodies;
    for (let i = 0; i < b.count; i++) {
      const i3 = i * 3;
      const rx = b.pos[i3] - t.origin.x;
      const ry = b.pos[i3 + 1] - t.origin.y;
      const rz = b.pos[i3 + 2] - t.origin.z;
      const s = rx * t.dir.x + ry * t.dir.y + rz * t.dir.z;
      if (s < -2 || s > t.length + 2) continue;
      const side = rx * t.normal.x + ry * t.normal.y + rz * t.normal.z;
      const band = Math.exp(-(side * side) / 8);
      const imp = Math.sign(side || 1) * band * 9;
      b.vel[i3] += t.normal.x * imp;
      b.vel[i3 + 1] += t.normal.y * imp;
      b.vel[i3 + 2] += t.normal.z * imp;
      b.ang[i3 + 2] += imp * 0.6;
    }
    this.coreScaleVel -= 2.5;
  }

  update(
    simDt: number,
    realDt: number,
    P: PhysicsController,
    camera: THREE.Camera,
    hands: { pos: THREE.Vector3; presence: number; pose: string; pinching: boolean }[],
  ): void {
    const t = P.simTime;
    const params = P.params;

    // Central structure: slow rotation, elastic scale, leaning toward the well.
    if (simDt > 0) {
      const target = P.singularity.phase === 'collapse' ? 0.12 : 1;
      const acc = (target - this.coreScale) * 70 - this.coreScaleVel * 6;
      this.coreScaleVel += acc * simDt;
      this.coreScale += this.coreScaleVel * simDt;
      this.core.rotation.y += simDt * 0.07;
      this.core.rotation.x = Math.sin(t * 0.11) * 0.25;
      this.shell.rotation.y -= simDt * 0.045;
      this.shell.rotation.z += simDt * 0.02;
      this.halo.rotation.z += simDt * 0.12;
    }
    const cs = Math.max(0.05, this.coreScale);
    this.core.scale.setScalar(cs);
    this.shell.scale.setScalar(cs);
    this.halo.scale.setScalar(Math.max(0.05, 0.3 + cs * 0.7));
    const lean = P.well.strength * 0.18;
    this.core.position.set(P.well.pos.x * lean, P.well.pos.y * lean, P.well.pos.z * lean);
    this.shell.position.copy(this.core.position);

    const cu = this.coreMat.uniforms;
    cu.uDisplace.value = (0.28 + P.breach * 0.22 + P.storm.energy * 0.12) * params.deformation;
    cu.uMelt.value = 0.1 + P.reverse * 0.5;

    // Floating bodies
    const b = this.bodies;
    let proximity = 0;
    if (simDt > 0) {
      const dt = simDt;
      const rev = P.reverse;
      const k = params.homeSpring * (1 - rev * 0.88);
      const damping = Math.exp(-0.9 * P.damping * dt);
      const angDamp = Math.exp(-0.4 * dt);
      const well = P.well;
      const st = P.storm;
      const sing = P.singularity;
      const collapsing = sing.phase === 'collapse';
      for (let i = 0; i < b.count; i++) {
        const i3 = i * 3;
        const px = b.pos[i3],
          py = b.pos[i3 + 1],
          pz = b.pos[i3 + 2];
        this.v.set(b.home[i3], b.home[i3 + 1], b.home[i3 + 2]);
        if (P.stretch.amount > 0.01) stretchPoint(this.v, this.v, P, 0.75);
        const r = b.rand[i];
        let ax = (this.v.x - px) * k;
        let ay = (this.v.y - py) * k - params.baseGravity * (1 - rev) * (0.5 + r);
        let az = (this.v.z - pz) * k;
        // Reverse gravity, with a soft ceiling so loose objects gather overhead.
        ay += rev * params.reverseGravity * (0.6 + r * 0.8) * (1 - smooth(5, 9.5, py));

        if (well.strength > 0.01) {
          const dx = well.pos.x - px,
            dy = well.pos.y - py,
            dz = well.pos.z - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          const fall = Math.exp(-d2 / 18);
          const inv = (params.attraction * 0.45 * well.strength * fall) / (Math.sqrt(d2) + 0.8);
          ax += dx * inv - dy * inv * 0.4;
          ay += dy * inv + dx * inv * 0.4;
          az += dz * inv;
          proximity += fall * well.strength;
        }
        if (st.energy > 0.01) {
          const dx = px - st.pos.x,
            dy = py - st.pos.y;
          const fall = Math.exp(-(dx * dx + dy * dy) / 30) + 0.05;
          ax += st.wind.x * params.windStrength * 0.6 * fall - dy * st.vortex * params.vortexIntensity * 0.3 * fall;
          ay += st.wind.y * params.windStrength * 0.6 * fall + dx * st.vortex * params.vortexIntensity * 0.3 * fall;
          az += st.wind.z * params.windStrength * 0.6 * fall;
          b.ang[i3 + 2] += st.vortex * fall * dt * 2;
        }
        if (collapsing) {
          const sk = 14 * sing.amount;
          ax += (sing.pos.x - px) * sk;
          ay += (sing.pos.y - py) * sk;
          az += (sing.pos.z - pz) * sk;
        }
        b.vel[i3] = (b.vel[i3] + ax * dt) * damping;
        b.vel[i3 + 1] = (b.vel[i3 + 1] + ay * dt) * damping;
        b.vel[i3 + 2] = (b.vel[i3 + 2] + az * dt) * damping;
        b.pos[i3] = px + b.vel[i3] * dt;
        b.pos[i3 + 1] = py + b.vel[i3 + 1] * dt;
        b.pos[i3 + 2] = pz + b.vel[i3 + 2] * dt;
        b.rot[i3] += b.ang[i3] * dt;
        b.rot[i3 + 1] += b.ang[i3 + 1] * dt;
        b.rot[i3 + 2] += b.ang[i3 + 2] * dt;
        // Spin relaxes toward a slow idle tumble.
        b.ang[i3] = b.ang[i3] * angDamp + (r - 0.5) * 0.4 * (1 - angDamp);
        b.ang[i3 + 1] = b.ang[i3 + 1] * angDamp + (r - 0.3) * 0.5 * (1 - angDamp);
        b.ang[i3 + 2] *= angDamp;
      }
      P.well.proximity = Math.min(1, proximity / 4);

      for (let i = 0; i < b.count; i++) {
        const i3 = i * 3;
        this.e.set(b.rot[i3], b.rot[i3 + 1], b.rot[i3 + 2]);
        this.q.setFromEuler(this.e);
        // Collapse squeezes bodies; the singularity makes them tiny.
        const sc = b.scale[i] * (1 - P.singularity.amount * 0.7);
        this.s.set(sc, sc, sc);
        this.v.set(b.pos[i3], b.pos[i3 + 1], b.pos[i3 + 2]);
        this.m4.compose(this.v, this.q, this.s);
        b.mesh[i].setMatrixAt(b.index[i], this.m4);
      }
      for (const m of this.instanced) m.instanceMatrix.needsUpdate = true;
    }

    this.updateRibbons(simDt, P, camera, hands);
    this.updateHandMarkers(realDt, camera, hands);

    const shaftBoost = 1 + P.breach * 1.5 + P.reverse * 0.6;
    this.shafts.forEach((m, i) => {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uIntensity.value = (i === 1 ? 0.1 : 0.07) * shaftBoost;
    });
  }

  private updateRibbons(
    dt: number,
    P: PhysicsController,
    camera: THREE.Camera,
    hands: { pos: THREE.Vector3; presence: number }[],
  ): void {
    const M = this.counts.ribbonPoints;
    const head = this.v;
    const cam = camera.position;
    const tangent = this.v2;
    const side = this.s;
    const toCam = this.toCam;
    const handCount = hands.length;
    this.ribbons.forEach((r, ri) => {
      const p = r.points;
      if (dt > 0) {
        this.ribbonHead(r, ri, P.simTime, head);
        // The first ribbons trail the hands; the rest keep the composition.
        if (handCount > 0 && ri < 4) {
          const h = hands[ri % handCount];
          const a = P.simTime * 3 + ri * 1.7;
          const tx = h.pos.x + Math.cos(a) * 0.35;
          const ty = h.pos.y + Math.sin(a) * 0.35;
          const tz = h.pos.z + 0.3;
          const w = h.presence * 0.9;
          head.set(head.x + (tx - head.x) * w, head.y + (ty - head.y) * w, head.z + (tz - head.z) * w);
        }
        const k0 = expAlpha(dt, 0.07);
        p[0] += (head.x - p[0]) * k0;
        p[1] += (head.y - p[1]) * k0;
        p[2] += (head.z - p[2]) * k0;
        const sag = (P.reverse * 1.2 - 0.15) * dt;
        for (let j = 1; j < M; j++) {
          const j3 = j * 3;
          const k = expAlpha(dt, 0.012 + j * 0.0011);
          p[j3] += (p[j3 - 3] - p[j3]) * k;
          p[j3 + 1] += (p[j3 - 2] - p[j3 + 1]) * k + sag * (j / M);
          p[j3 + 2] += (p[j3 - 1] - p[j3 + 2]) * k;
        }
        // Stretch: the ribbons become filaments bridging the palms.
        const amt = P.stretch.amount;
        if (amt > 0.01 && ri < 5) {
          const A = P.stretch.a;
          const B = P.stretch.b;
          const kk = expAlpha(dt, 0.08) * amt;
          for (let j = 0; j < M; j++) {
            const f = j / (M - 1);
            const wave = Math.sin(f * Math.PI) * Math.sin(P.simTime * 2.3 + ri * 1.3 + f * 6) * 0.5 * (ri - 2);
            const j3 = j * 3;
            const tx = A.x + (B.x - A.x) * f;
            const ty = A.y + (B.y - A.y) * f + wave;
            const tz = A.z + (B.z - A.z) * f + Math.cos(ri + f * 5) * 0.3;
            p[j3] += (tx - p[j3]) * kk;
            p[j3 + 1] += (ty - p[j3 + 1]) * kk;
            p[j3 + 2] += (tz - p[j3 + 2]) * kk;
          }
        }
      }
      const pos = r.position.array as Float32Array;
      for (let j = 0; j < M; j++) {
        const j3 = j * 3;
        const a = Math.max(0, j - 1) * 3;
        const c = Math.min(M - 1, j + 1) * 3;
        tangent.set(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]);
        toCam.set(cam.x - p[j3], cam.y - p[j3 + 1], cam.z - p[j3 + 2]);
        side.crossVectors(tangent, toCam);
        const l = side.length();
        const width = 0.075 * Math.pow(1 - j / M, 0.6) + 0.004;
        if (l > 1e-6) side.multiplyScalar(width / l);
        const o = j * 6;
        pos[o] = p[j3] - side.x;
        pos[o + 1] = p[j3 + 1] - side.y;
        pos[o + 2] = p[j3 + 2] - side.z;
        pos[o + 3] = p[j3] + side.x;
        pos[o + 4] = p[j3 + 1] + side.y;
        pos[o + 5] = p[j3 + 2] + side.z;
      }
      r.position.needsUpdate = true;
    });
  }

  private updateHandMarkers(
    dt: number,
    camera: THREE.Camera,
    hands: { pos: THREE.Vector3; presence: number; pose: string; pinching: boolean }[],
  ): void {
    this.handMarkers.forEach((m, i) => {
      const h = hands[i];
      const mat = m.material as THREE.MeshBasicMaterial;
      const targetOpacity = h ? h.presence * 0.55 : 0;
      mat.opacity += (targetOpacity - mat.opacity) * expAlpha(dt, 0.15);
      m.visible = mat.opacity > 0.01;
      if (!h) return;
      m.position.lerp(h.pos, expAlpha(dt, 0.05));
      m.quaternion.copy(camera.quaternion);
      const color = h.pinching ? PALETTE.lime : h.pose === 'fist' ? PALETTE.vermilion : PALETTE.bone;
      mat.color.lerp(color, expAlpha(dt, 0.1));
      m.scale.setScalar(h.pose === 'fist' ? 0.7 : h.pinching ? 0.55 : 1);
    });
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of this.instanced) m.dispose();
    this.group.clear();
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
