import * as THREE from 'three';
import { damp } from '../utils/math';
import type { PhysicsController } from './PhysicsController';

/**
 * Cinematic, slightly off-axis camera. Drifts slowly on simulation time (so
 * it holds still when time is frozen), leans toward the active hand, tilts
 * during gravity reversal and shakes on discontinuities. Reduced motion
 * scales all of this down.
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  reducedMotion = false;
  private readonly base = new THREE.Vector3(4.2, 1.5, 13.5);
  private readonly target = new THREE.Vector3(0, 0.2, 0);
  private readonly lean = new THREE.Vector2();
  private readonly pointer = new THREE.Vector2();
  private roll = 0;
  private readonly lookAt = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane();
  private readonly ndc = new THREE.Vector2();
  private readonly normal = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
    this.camera.position.copy(this.base);
    this.camera.lookAt(this.target);
  }

  setPointer(x: number, y: number): void {
    this.pointer.set(x, y);
  }

  update(dt: number, P: PhysicsController, focus: THREE.Vector3 | null, focusWeight: number): void {
    const m = this.reducedMotion ? 0.25 : 1;
    const t = P.simTime;
    const leanX = (focus ? focus.x * 0.08 * focusWeight : 0) + this.pointer.x * 0.35;
    const leanY = (focus ? focus.y * 0.06 * focusWeight : 0) + this.pointer.y * 0.2;
    this.lean.x = damp(this.lean.x, leanX * m, 0.6, dt);
    this.lean.y = damp(this.lean.y, leanY * m, 0.6, dt);
    this.roll = damp(this.roll, P.reverse * 0.12 * m, 0.5, dt);

    const drift = m;
    const cam = this.camera;
    cam.position.set(
      this.base.x + Math.sin(t * 0.05) * 1.6 * drift + this.lean.x * 2,
      this.base.y + Math.sin(t * 0.07) * 0.6 * drift + this.lean.y * 1.5 - P.reverse * 1.2 * m,
      this.base.z + Math.cos(t * 0.04) * 0.8 * drift,
    );
    this.lookAt.set(this.target.x + this.lean.x, this.target.y + this.lean.y + P.reverse * 0.8 * m, this.target.z);
    // Shake: discontinuity, not a wobble.
    const sh = P.shake * P.shake * 0.12 * m;
    if (sh > 1e-4) {
      cam.position.x += (Math.random() - 0.5) * sh;
      cam.position.y += (Math.random() - 0.5) * sh;
    }
    cam.up.set(Math.sin(this.roll), Math.cos(this.roll), 0);
    cam.lookAt(this.lookAt);
    // Brief FOV pull during singularity collapse.
    const fov = 42 + P.singularity.amount * 6 * m - P.stretch.amount * (P.stretch.factor - 1) * 2 * m;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Maps a control-space point (x, y in about -1..1) to world space on the
   * plane through the scene centre facing the camera, so a hand on screen
   * and its effect in the scene line up.
   */
  controlToWorld(x: number, y: number, out: THREE.Vector3, depth = 0): THREE.Vector3 {
    this.ndc.set(x * 0.85, y * 0.85);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.camera.getWorldDirection(this.normal).negate();
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.tmp.copy(this.lookAt).addScaledVector(this.normal, depth));
    if (!this.raycaster.ray.intersectPlane(this.plane, out)) out.set(x * 6, y * 3.5, 0);
    return out;
  }

  /** Converts a world-space direction from a control-space direction (same plane). */
  controlDirToWorld(dx: number, dy: number, out: THREE.Vector3): THREE.Vector3 {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    return out.copy(right).multiplyScalar(dx).addScaledVector(up, dy).normalize();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
