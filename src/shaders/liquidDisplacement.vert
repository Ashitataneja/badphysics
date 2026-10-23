// Shader A: liquid displacement.
// Layered noise displaces vertices along their normals; the shared interaction
// fields then bend the result in world space (stretch, well, tear, singularity).
// Normals are re-derived from neighbouring displaced samples.
//
// uDisplace          noise displacement amplitude (0 for rigid shards)
// uFrequency         base noise frequency
// uSeed              arrangement seed (changes on SNAP)
// uFieldInfluence    how strongly the interaction fields act on this mesh
// uStretchInfluence  how strongly STRETCH deforms this mesh
// uMelt              downward (or upward when reversed) drip amount

uniform float uDisplace;
uniform float uFrequency;
uniform float uSeed;
uniform float uFieldInfluence;
uniform float uStretchInfluence;
uniform float uMelt;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vDisp;

float shape(vec3 p, float seed) {
  float t = uTime * 0.16;
  float n = snoise(p * uFrequency + vec3(seed, t, -t * 0.7));
  n += 0.38 * snoise(p * uFrequency * 2.07 + vec3(t * 1.3, seed * 1.7, t));
  n += 0.08 * snoise(p * uFrequency * 4.3 - vec3(t * 2.1, 0.0, seed));
  return n;
}

void main() {
  vec3 pos = position;
  vec3 nor = normalize(normal);
  float seed = uSeed;
#ifdef USE_INSTANCING
  seed += instanceMatrix[3].x * 0.37 + instanceMatrix[3].y * 0.71 + instanceMatrix[3].z * 0.13;
#endif

  vec3 displaced = pos;
  vec3 dn = nor;
  vDisp = 0.0;
  if (uDisplace > 0.0) {
    vec3 t1 = normalize(cross(nor, abs(nor.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(nor, t1);
    float e = 0.03;
    float d0 = shape(pos, seed);
    displaced = pos + nor * d0 * uDisplace;
    vec3 pa = pos + t1 * e;
    vec3 pb = pos + t2 * e;
    pa += nor * shape(pa, seed) * uDisplace;
    pb += nor * shape(pb, seed) * uDisplace;
    dn = normalize(cross(pa - displaced, pb - displaced));
    if (dot(dn, nor) < 0.0) dn = -dn;
    vDisp = d0;
  }

  vec4 local = vec4(displaced, 1.0);
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
  dn = mat3(instanceMatrix) * dn;
#endif
  vec3 w = (modelMatrix * local).xyz;

  // Melt: vertices drip along gravity, more where the noise is high.
  if (uMelt > 0.0) {
    float g = mix(-1.0, 1.0, uReverse);
    w.y += g * uMelt * max(vDisp, 0.0) * (0.5 + 0.5 * snoise(w * 0.7 + uTime * 0.3));
  }

  w = applyStretch(w, uStretchInfluence);
  w = applyWell(w, uFieldInfluence);
  w = applyTear(w, uFieldInfluence);
  w = applySingularity(w, uFieldInfluence);

  vWorldPos = w;
  vNormal = normalize(mat3(modelMatrix) * dn);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
