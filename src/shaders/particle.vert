// Shader D (vertex): particle storm.
// Each particle is an instanced quad stretched between its current position
// and a tail point derived from its velocity, giving motion-dependent trails.
// Shader B is applied here too: positions near the gravity well are pushed
// radially in view space, producing a gravitational-lens ring.
//
// iPos   instance position (world)
// iVel   instance velocity (world units / s)
// iData  x: seed, y: size multiplier, z: life 0..1, w: kind (0 ambient, 1 burst)
// uSize        base world size
// uTrail       seconds of velocity rendered as trail
// uViewport    drawing buffer size in pixels
// uLensStrength / uLensRadius   view-space lens around uWell / singularity
// uFogDensity  depth fade

attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData;

uniform float uSize;
uniform float uTrail;
uniform vec2 uViewport;
uniform float uLensStrength;
uniform float uLensRadius;
uniform vec3 uLensCenter;
uniform float uFogDensity;

varying vec2 vQuad;
varying float vAlpha;
varying vec3 vColor;

vec3 lens(vec3 p, vec3 c) {
  vec2 d = p.xy - c.xy;
  float r = length(d);
  float R = uLensRadius;
  // Bounded radial push: points inside the radius are moved towards the ring.
  float push = uLensStrength * R * R / (r + R * 0.35) * smoothstep(R * 3.0, 0.0, r);
  return vec3(c.xy + (r > 1e-4 ? d / r : vec2(0.0)) * (r + push), p.z);
}

void main() {
  float seed = iData.x;
  vec3 p = iPos;
  p += 0.035 * vec3(sin(uTime * 1.3 + seed * 40.0), cos(uTime * 1.1 + seed * 31.0), sin(uTime * 0.9 + seed * 17.0));

  vec3 trail = iVel * uTrail;
  float tl = length(trail);
  if (tl > 2.4) trail *= 2.4 / tl;
  vec3 tail = p - trail;

  vec4 hv = viewMatrix * vec4(p, 1.0);
  vec4 tv = viewMatrix * vec4(tail, 1.0);
  vec3 lc = (viewMatrix * vec4(uLensCenter, 1.0)).xyz;
  if (uLensStrength > 0.001) {
    hv.xyz = lens(hv.xyz, lc);
    tv.xyz = lens(tv.xyz, lc);
  }
  vec4 hc = projectionMatrix * hv;
  vec4 tc = projectionMatrix * tv;
  if (hc.w < 0.2 || tc.w < 0.2) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }
  vec2 half_ = uViewport * 0.5;
  vec2 hs = hc.xy / hc.w * half_;
  vec2 ts = tc.xy / tc.w * half_;
  vec2 dir = hs - ts;
  float L = length(dir);
  vec2 fwd = L > 1e-3 ? dir / L : vec2(1.0, 0.0);
  vec2 side = vec2(-fwd.y, fwd.x);
  float sizePx = max(uSize * iData.y * projectionMatrix[1][1] * half_.y / hc.w, 0.9);

  // position.x: 0 = tail, 1 = head; position.y: -1..1 across.
  vec2 base = mix(ts - fwd * sizePx, hs + fwd * sizePx, position.x);
  vec2 px = base + side * position.y * sizePx;
  float w = mix(tc.w, hc.w, position.x);
  float z = mix(tc.z / tc.w, hc.z / hc.w, position.x);
  gl_Position = vec4(px / half_ * w, z * w, w);
  vQuad = vec2(position.x, position.y);

  // Colour follows physical behaviour: speed and kind, not screen position.
  float speed = length(iVel);
  vec3 bone = vec3(0.91, 0.89, 0.84);
  vec3 cobalt = vec3(0.16, 0.34, 1.0);
  vec3 lime = vec3(0.78, 0.96, 0.22);
  vec3 vermilion = vec3(1.0, 0.28, 0.1);
  vec3 c = mix(bone * 0.75, cobalt, smoothstep(1.2, 4.5, speed));
  c = mix(c, lime, smoothstep(6.0, 11.0, speed) * 0.8);
  if (seed > 0.985) c = cobalt * 1.2;
  if (iData.w > 0.5) c = mix(vermilion, bone, 1.0 - iData.z);
  vColor = c;

  float depth = -hv.z;
  float fog = exp(-uFogDensity * uFogDensity * depth * depth);
  float life = iData.w > 0.5 ? smoothstep(0.0, 0.25, iData.z) : 1.0;
  // Long trails spread their energy so fast particles don't saturate.
  vAlpha = fog * life * (0.35 + 0.65 * smoothstep(0.0, 1.0, iData.y)) * clamp(sizePx * 2.0 / (L + sizePx * 2.0), 0.18, 1.0);
}
