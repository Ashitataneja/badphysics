import * as THREE from 'three';
import type { PhysicsController } from './PhysicsController';

const axis = new THREE.Vector3();
const d = new THREE.Vector3();
const perp = new THREE.Vector3();

/**
 * CPU mirror of applyStretch() in fields.glsl: deforms `p` along the axis
 * between the two palms, pivoting on the world origin.
 */
export function stretchPoint(out: THREE.Vector3, p: THREE.Vector3, P: PhysicsController, influence: number): THREE.Vector3 {
  const amt = P.stretch.amount * influence;
  if (amt < 0.001) return out.copy(p);
  axis.subVectors(P.stretch.b, P.stretch.a);
  const L = axis.length();
  if (L > 1e-4) axis.divideScalar(L);
  else axis.set(1, 0, 0);
  d.copy(p);
  const along = d.dot(axis);
  perp.copy(d).addScaledVector(axis, -along);
  const f = 1 + (P.stretch.factor - 1) * amt;
  return out.copy(axis).multiplyScalar(along * f).addScaledVector(perp, 1 / Math.sqrt(Math.max(f, 0.25)));
}
