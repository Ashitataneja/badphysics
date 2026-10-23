import * as THREE from 'three';

/**
 * Shared uniform objects for the world-space interaction fields declared in
 * shaders/fields.glsl. Every material references these same objects, so a
 * single write per frame updates all deformation consistently and no
 * geometry is rebuilt on the CPU.
 */
export function createFieldUniforms() {
  return {
    uTime: { value: 0 },
    uWell: { value: new THREE.Vector4(0, 0, 0, 0) },
    uStretchA: { value: new THREE.Vector4(-2, 0, 0, 0) },
    uStretchB: { value: new THREE.Vector4(2, 0, 0, 1) },
    uStretchCenter: { value: new THREE.Vector3(0, 0, 0) },
    uSingularity: { value: new THREE.Vector4(0, 0, 0, 0) },
    uTearOrigin: { value: new THREE.Vector4(0, 0, 0, 0) },
    uTearDir: { value: new THREE.Vector4(1, 0, 0, 1) },
    uTearProgress: { value: 0 },
    uReverse: { value: 0 },
    uErase: { value: 0 },
  };
}

export type FieldUniforms = ReturnType<typeof createFieldUniforms>;
