// Practical "volumetric" light: a soft additive gradient on a long plane,
// with slow drifting dust bands. uColor, uIntensity, uSeed per shaft.
uniform vec3 uColor;
uniform float uIntensity;
uniform float uSeed;
uniform float uTime;
uniform float uErase;
varying vec2 vUv;

void main() {
  float across = exp(-pow((vUv.x - 0.5) / 0.18, 2.0));
  float along = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
  float bands = 0.75 + 0.25 * sin(vUv.y * 14.0 - uTime * 0.35 + uSeed * 6.0) * sin(vUv.x * 9.0 + uTime * 0.2);
  float a = across * along * bands * uIntensity * (1.0 - uErase * 0.7);
  gl_FragColor = vec4(uColor * a, a);
}
