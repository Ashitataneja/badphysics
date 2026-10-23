// Deep backdrop: near-black with a midnight-blue horizon haze.
uniform float uTime;
uniform float uReverse;
varying vec2 vUv;
void main() {
  float y = vUv.y;
  vec3 top = vec3(0.006, 0.008, 0.016);
  vec3 mid = vec3(0.018, 0.026, 0.06);
  float h = exp(-pow((y - mix(0.47, 0.6, uReverse)) / 0.09, 2.0));
  vec3 col = mix(top, mid, h);
  col += vec3(0.02, 0.035, 0.09) * smoothstep(0.55, 0.0, y) * 0.4;
  gl_FragColor = vec4(col, 1.0);
}
