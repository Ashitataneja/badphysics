// Shader C: spatial tear.
// A directional mask defines a narrow fissure that propagates along the hand's
// trajectory. The two sides of the scene are sampled with opposite offsets so
// reality appears split into displaced layers; the fissure itself shows a void
// with a hot edge. Up to two tears can be live at once.
//
// uTearA[i]  xy: origin uv, zw: unit direction (aspect-corrected)
// uTearB[i]  x: progress 0..1, y: strength 0..1, z: length (uv-height units), w: seed

uniform vec4 uTearA[2];
uniform vec4 uTearB[2];

struct Tear {
  vec2 offset;
  float fissure;
  float edge;
};

Tear spatialTear(vec2 uv, float aspect) {
  Tear t;
  t.offset = vec2(0.0);
  t.fissure = 0.0;
  t.edge = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 A = uTearA[i];
    vec4 B = uTearB[i];
    float strength = B.y;
    if (strength < 0.001) continue;
    vec2 d = A.zw;
    vec2 n = vec2(-d.y, d.x);
    vec2 p = (uv - A.xy) * vec2(aspect, 1.0);
    float s = dot(p, d);
    float h = dot(p, n);
    float front = B.z * B.x;
    float reveal = smoothstep(-0.03, 0.02, s) * (1.0 - smoothstep(front - 0.02, front + 0.05, s));
    // Taper toward both ends.
    float taper = smoothstep(0.0, 0.12, s) * smoothstep(0.0, 0.12, front - s + 0.05);
    float jag = 0.55 + 0.45 * sin(s * 83.0 + B.w * 7.0) * sin(s * 31.0 + B.w * 3.0);
    float width = 0.012 * strength * jag * reveal * taper;
    t.fissure = max(t.fissure, 1.0 - smoothstep(width * 0.45, width, abs(h)));
    float edgeWidth = 0.012 * strength * reveal * taper * (0.85 + 0.15 * jag);
    t.edge = max(t.edge, exp(-abs(h) / (edgeWidth * 2.0 + 1e-4)) * reveal * taper * strength);
    float band = exp(-h * h / (2.0 * 0.16 * 0.16)) * reveal * strength;
    vec2 off = (n * sign(h) * 0.03 + d * sign(h) * 0.012) * band;
    t.offset += off / vec2(aspect, 1.0);
  }
  return t;
}
