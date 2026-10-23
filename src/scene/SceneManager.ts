import * as THREE from 'three';
import type { QualityTier } from '../app/state';
import { shaders } from '../shaders';
import { CameraController } from './CameraController';
import { createFieldUniforms, type FieldUniforms } from './InteractionFields';
import { ObjectSystem, PALETTE, type ObjectCounts } from './ObjectSystem';
import { ParticleSystem } from './ParticleSystem';
import { PhysicsController } from './PhysicsController';
import { SimulationController } from './SimulationController';

export interface TierConfig extends ObjectCounts {
  particles: number;
  maxDpr: number;
  msaa: number;
  /** Minimum interval between hand detections (ms). */
  detectIntervalMs: number;
  grain: number;
  aberration: number;
}

export const TIERS: Record<QualityTier, TierConfig> = {
  high: {
    particles: 30000,
    maxDpr: 2,
    msaa: 4,
    coreDetail: 56,
    spheres: 10,
    polys: 24,
    blobs: 30,
    shards: 160,
    ribbons: 8,
    ribbonPoints: 72,
    detectIntervalMs: 0,
    grain: 0.03,
    aberration: 1.4,
  },
  medium: {
    particles: 10000,
    maxDpr: 1.5,
    msaa: 2,
    coreDetail: 36,
    spheres: 8,
    polys: 15,
    blobs: 18,
    shards: 100,
    ribbons: 6,
    ribbonPoints: 56,
    detectIntervalMs: 30,
    grain: 0.03,
    aberration: 1.0,
  },
  low: {
    particles: 3000,
    maxDpr: 1,
    msaa: 0,
    coreDetail: 20,
    spheres: 5,
    polys: 9,
    blobs: 12,
    shards: 50,
    ribbons: 4,
    ribbonPoints: 40,
    detectIntervalMs: 66,
    grain: 0.02,
    aberration: 0.6,
  },
};

/** Picks a starting tier from coarse device signals; frame-time monitoring refines it. */
export function detectTier(): QualityTier {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile || cores <= 4) return 'low';
  if (cores >= 8 && window.devicePixelRatio <= 2) return 'high';
  return 'medium';
}

export class WebGLUnavailableError extends Error {}

/**
 * Owns the renderer, the scene graph, the off-screen render target and the
 * single composite pass. Builds the simulation subsystems for a quality tier
 * and disposes every GPU resource on teardown.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly fields: FieldUniforms = createFieldUniforms();
  readonly physics = new PhysicsController();
  readonly cameraCtl: CameraController;
  readonly sim: SimulationController;
  objects: ObjectSystem;
  particles: ParticleSystem;
  tier: QualityTier;
  config: TierConfig;
  shaderError: string | null = null;

  private rt: THREE.WebGLRenderTarget;
  private readonly composite: THREE.Mesh;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly compositeScene = new THREE.Scene();
  private readonly orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly viewport = new THREE.Vector2(1, 1);
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private width = 1;
  private height = 1;
  private dprScale = 1;
  private frame = 0;
  reducedFlash = false;
  private contextLost = false;

  constructor(
    readonly container: HTMLElement,
    tier: QualityTier,
  ) {
    THREE.ColorManagement.enabled = false;
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
      });
    } catch (err) {
      throw new WebGLUnavailableError(`WebGL2 is unavailable: ${(err as Error).message}`);
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.setClearColor(PALETTE.void, 1);
    r.autoClear = true;
    r.debug.checkShaderErrors = true;
    r.debug.onShaderError = (gl, program, vs, fs) => {
      const log = `${gl.getProgramInfoLog(program)}\n${gl.getShaderInfoLog(vs)}\n${gl.getShaderInfoLog(fs)}`;
      this.shaderError = log;
      console.error('[BAD PHYSICS] shader compilation failed\n', log);
    };
    r.domElement.className = 'scene-canvas';
    r.domElement.addEventListener('webglcontextlost', this.onContextLost);
    r.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    container.appendChild(r.domElement);

    this.tier = tier;
    this.config = TIERS[tier];
    this.cameraCtl = new CameraController(1);
    this.scene.fog = null;

    this.objects = new ObjectSystem(this.fields, this.config, 7);
    this.particles = new ParticleSystem(this.config.particles, this.fields, 7);
    this.scene.add(this.objects.group, this.particles.mesh);
    this.sim = new SimulationController(this.physics, this.objects, this.particles, this.cameraCtl, this.fields);

    this.rt = this.createTarget();
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: shaders.composite.vertex,
      fragmentShader: shaders.composite.fragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.rt.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uFrame: { value: 0 },
        uBreach: { value: 0 },
        uFreeze: { value: 0 },
        uFlash: { value: 0 },
        uAberration: { value: this.config.aberration },
        uGrain: { value: this.config.grain },
        uLensUv: { value: new THREE.Vector2(0.5, 0.5) },
        uLensStrength: { value: 0 },
        uLensRadius: { value: 0.2 },
        uTearA: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uTearB: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uInversion: { value: 0 },
        uInversionMax: { value: 1 },
      },
    });
    this.composite = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.composite.frustumCulled = false;
    this.compositeScene.add(this.composite);

    this.resize();
  }

  private createTarget(): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(this.width, this.height, {
      samples: this.config.msaa,
      depthBuffer: true,
      type: THREE.UnsignedByteType,
    });
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };

  private onContextRestored = () => {
    this.contextLost = false;
  };

  /** Forces shader compilation up front so failures surface immediately. */
  precompile(): string | null {
    try {
      this.renderer.compile(this.scene, this.cameraCtl.camera);
      this.renderer.compile(this.compositeScene, this.orthoCam);
    } catch (err) {
      this.shaderError = (err as Error).message;
    }
    return this.shaderError;
  }

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.config.maxDpr) * this.dprScale;
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const bw = Math.floor(w * pr);
    const bh = Math.floor(h * pr);
    this.rt.setSize(bw, bh);
    this.viewport.set(bw, bh);
    this.compositeMat.uniforms.uResolution.value.set(bw, bh);
    this.cameraCtl.setAspect(w / h);
  }

  /** Runtime degradation step used by adaptive quality. */
  setDprScale(s: number): void {
    if (Math.abs(s - this.dprScale) < 1e-3) return;
    this.dprScale = s;
    this.resize();
  }

  /** Rebuilds geometry and particles for a different tier, keeping physical state. */
  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.config = TIERS[tier];
    this.scene.remove(this.objects.group, this.particles.mesh);
    this.objects.dispose();
    this.particles.dispose();
    this.objects = new ObjectSystem(this.fields, this.config, 7);
    this.particles = new ParticleSystem(this.config.particles, this.fields, this.sim.currentSeed);
    this.scene.add(this.objects.group, this.particles.mesh);
    this.sim.setSystems(this.objects, this.particles);
    this.rt.dispose();
    this.dprScale = 1;
    this.rt = this.createTarget();
    this.compositeMat.uniforms.tScene.value = this.rt.texture;
    this.compositeMat.uniforms.uAberration.value = this.config.aberration;
    this.compositeMat.uniforms.uGrain.value = this.config.grain;
    this.resize();
  }

  /** Projects a world point to uv (0..1, y up). */
  private toUv(p: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
    this.tmp.copy(p).project(this.cameraCtl.camera);
    return out.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5);
  }

  private readonly uvA = new THREE.Vector2();
  private readonly uvB = new THREE.Vector2();

  private updateComposite(): void {
    const P = this.physics;
    const u = this.compositeMat.uniforms;
    const aspect = this.width / this.height;
    u.uFrame.value = this.frame % 1000;
    u.uBreach.value = P.breach;
    u.uFreeze.value = P.freezeBlend;
    u.uFlash.value = this.reducedFlash ? 0 : P.flash * 0.6;
    u.uInversionMax.value = this.reducedFlash ? 0.5 : 1;
    u.uInversion.value = P.erase;

    // Shader B: lens follows the well, or the singularity when it dominates.
    const s = P.singularity;
    const lensFromSing = s.amount > P.well.strength * 0.4;
    this.toUv(lensFromSing ? s.pos : P.well.pos, u.uLensUv.value);
    u.uLensStrength.value = Math.min(0.6, Math.max(P.well.strength * 0.22, s.amount * 0.55));
    u.uLensRadius.value = lensFromSing ? 0.22 : 0.13;

    // Shader C: project each tear into screen space.
    P.tears.forEach((t, i) => {
      const A = u.uTearA.value[i] as THREE.Vector4;
      const B = u.uTearB.value[i] as THREE.Vector4;
      if (t.strength <= 0.001) {
        B.set(0, 0, 0, 0);
        return;
      }
      this.toUv(t.origin, this.uvA);
      this.tmp2.copy(t.origin).addScaledVector(t.dir, t.length);
      this.toUv(this.tmp2, this.uvB);
      let dx = (this.uvB.x - this.uvA.x) * aspect;
      let dy = this.uvB.y - this.uvA.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      A.set(this.uvA.x, this.uvA.y, dx, dy);
      B.set(t.progress, t.strength, len, t.seed);
    });
  }

  render(): void {
    if (this.contextLost) return;
    this.frame++;
    this.updateComposite();
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.cameraCtl.camera);
    r.setRenderTarget(null);
    r.render(this.compositeScene, this.orthoCam);
  }

  get drawingViewport(): THREE.Vector2 {
    return this.viewport;
  }

  dispose(): void {
    this.objects.dispose();
    this.particles.dispose();
    this.rt.dispose();
    this.composite.geometry.dispose();
    this.compositeMat.dispose();
    this.scene.clear();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
