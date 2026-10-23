// Shader E: reality inversion.
// Blends from the normal image through desaturation into an inverted,
// high-contrast treatment, controlled by a single smooth uniform.
//
// uInversion      0..1 transition amount
// uInversionMax   ceiling (lowered when reduced-flash is enabled)

uniform float uInversion;
uniform float uInversionMax;

vec3 realityInversion(vec3 c) {
  float a = uInversion * uInversionMax;
  if (a < 0.001) return c;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 desat = mix(c, vec3(l), smoothstep(0.0, 0.45, a));
  float inv = 1.0 - l;
  inv = smoothstep(0.18, 0.82, inv);
  vec3 bone = vec3(0.93, 0.91, 0.86);
  return mix(desat, bone * inv, smoothstep(0.35, 1.0, a));
}
