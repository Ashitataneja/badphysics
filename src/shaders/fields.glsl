// Shared world-space interaction fields. The same uniform objects are bound to
// every material, so one CPU update per frame drives all deformation.
//
// uTime         simulation time in seconds (stops while frozen)
// uWell         xyz: gravity-well position, w: strength 0..1      (GRAB GRAVITY)
// uStretchA     xyz: palm A endpoint,       w: deformation amount (STRETCH REALITY)
// uStretchB     xyz: palm B endpoint,       w: stretch factor, 1 = rest
// uStretchCenter pivot of the stretch (centre of the main structure)
// uSingularity  xyz: collapse point,        w: collapse amount 0..1 (SNAP)
// uTearOrigin   xyz: fissure start,         w: strength 0..1      (TEAR REALITY)
// uTearDir      xyz: unit direction,        w: fissure length
// uTearProgress 0..1 how far the fissure has propagated
// uReverse      0..1 gravity reversal
// uErase        0..1 reality inversion
uniform float uTime;
uniform vec4 uWell;
uniform vec4 uStretchA;
uniform vec4 uStretchB;
uniform vec3 uStretchCenter;
uniform vec4 uSingularity;
uniform vec4 uTearOrigin;
uniform vec4 uTearDir;
uniform float uTearProgress;
uniform float uReverse;
uniform float uErase;

vec3 applyStretch(vec3 p, float influence) {
  float amt = uStretchA.w * influence;
  if (amt < 0.001) return p;
  vec3 axis = uStretchB.xyz - uStretchA.xyz;
  float L = length(axis);
  axis = L > 1e-4 ? axis / L : vec3(1.0, 0.0, 0.0);
  vec3 d = p - uStretchCenter;
  float along = dot(d, axis);
  vec3 perp = d - along * axis;
  float f = mix(1.0, uStretchB.w, amt);
  // Approximately volume-preserving: thin out as it lengthens.
  return uStretchCenter + axis * along * f + perp * inversesqrt(max(f, 0.25));
}

vec3 applyWell(vec3 p, float influence) {
  if (uWell.w < 0.001) return p;
  vec3 d = uWell.xyz - p;
  float r2 = dot(d, d);
  float fall = exp(-r2 / 9.0);
  return p + d * clamp(uWell.w * influence * fall * 0.5, 0.0, 0.8);
}

vec3 applyTear(vec3 p, float influence) {
  if (uTearOrigin.w < 0.001) return p;
  vec3 rel = p - uTearOrigin.xyz;
  float s = dot(rel, uTearDir.xyz);
  float front = uTearDir.w * uTearProgress;
  float reveal = smoothstep(-1.0, 0.0, s) * (1.0 - smoothstep(front, front + 1.5, s));
  vec3 n = normalize(cross(uTearDir.xyz, vec3(0.0, 0.0, 1.0)) + vec3(0.0, 1e-4, 0.0));
  float side = dot(rel, n);
  float band = exp(-side * side / 2.5);
  return p + n * sign(side) * band * reveal * uTearOrigin.w * influence * 0.9;
}

vec3 applySingularity(vec3 p, float influence) {
  float a = clamp(uSingularity.w * influence, 0.0, 0.97);
  if (a < 0.001) return p;
  vec3 d = uSingularity.xyz - p;
  // Spiral inward as it collapses.
  float ang = a * 2.5;
  vec2 q = vec2(cos(ang) * d.x - sin(ang) * d.y, sin(ang) * d.x + cos(ang) * d.y);
  vec3 swirl = vec3(q, d.z);
  return uSingularity.xyz - mix(d, swirl * (1.0 - a), a);
}
