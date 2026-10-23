// Shader D (fragment): soft capsule with a bright head and fading tail.
// When reality is erased, particles dissolve into outlines.
uniform float uOpacity;
uniform float uErase;

varying vec2 vQuad;
varying float vAlpha;
varying vec3 vColor;

void main() {
  float across = abs(vQuad.y);
  float body = (1.0 - across * across);
  body *= body;
  float along = mix(0.08, 1.0, smoothstep(0.0, 1.0, vQuad.x));
  float filled = body * along;
  float outline = smoothstep(0.55, 0.78, across) * (1.0 - smoothstep(0.82, 1.0, across)) * along;
  float a = mix(filled, outline * 1.6, uErase) * vAlpha * uOpacity;
  if (a < 0.002) discard;
  vec3 col = mix(vColor, vec3(0.95), uErase);
  gl_FragColor = vec4(col * a, a);
}
