// Shader B (screen space): gravitational lens.
// A bounded radial remap of the screen around the projected well/singularity.
// Samples are drawn from closer to the centre, magnifying the region into a
// ring, and a faint Einstein-ring highlight is added on top.
//
// uLensUv        lens centre in uv space
// uLensStrength  0..~0.6 (bounded)
// uLensRadius    radius in uv-height units

uniform vec2 uLensUv;
uniform float uLensStrength;
uniform float uLensRadius;

vec2 gravityLens(vec2 uv, float aspect, out float ring) {
  ring = 0.0;
  if (uLensStrength < 0.001) return uv;
  vec2 p = (uv - uLensUv) * vec2(aspect, 1.0);
  float r = length(p);
  float R = uLensRadius;
  float k = uLensStrength * (R * R) / (r * r + R * R);
  ring = uLensStrength * exp(-pow((r - R * 0.9) / (R * 0.12), 2.0));
  vec2 q = p * (1.0 - k);
  return uLensUv + q / vec2(aspect, 1.0);
}
