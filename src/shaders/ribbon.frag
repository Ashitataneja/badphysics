// Ribbon shading: bone-white head fading to cobalt, translucent tail.
uniform vec3 uHead;
uniform vec3 uTailColor;
uniform float uOpacity;
uniform float uTime;
uniform float uErase;
uniform float uFogDensity;
varying float vAlong;
varying float vSide;
varying float vDepth;
void main() {
  float edge = 1.0 - abs(vSide);
  float body = smoothstep(0.0, 0.6, edge);
  float shimmer = 0.75 + 0.25 * sin(vAlong * 40.0 - uTime * 3.0);
  vec3 col = mix(uTailColor, uHead, pow(vAlong, 1.5)) * shimmer;
  float fog = exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  float a = body * pow(vAlong, 0.8) * uOpacity * fog;
  float outline = smoothstep(0.0, 0.25, edge) * (1.0 - smoothstep(0.25, 0.5, edge));
  a = mix(a, outline * vAlong * uOpacity, uErase);
  col = mix(col, vec3(0.95), uErase);
  gl_FragColor = vec4(col * a, a);
}
