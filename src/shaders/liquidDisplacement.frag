// Liquid-chrome surface. Reflections come from a procedural studio
// environment (no textures): dark void, bone-white horizon strip, cobalt
// overhead softbox, a thin acid-lime sliver and a low accent bounce.
//
// uTint      surface tint
// uAccent    accent bounce colour (changes with the arrangement)
// uChrome    reflection intensity
// uOpacity   final alpha
// uFogColor / uFogDensity  exponential-squared fog
// Defines: FLAT (faceted normals from derivatives), WIRE (unlit line colour)

uniform vec3 uTint;
uniform vec3 uAccent;
uniform float uChrome;
uniform float uOpacity;
uniform vec3 uFogColor;
uniform float uFogDensity;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vDisp;

vec3 env(vec3 r) {
  float y = r.y;
  float az = atan(r.z, r.x);
  // Near-black studio with a midnight gradient overhead.
  vec3 c = mix(vec3(0.006, 0.008, 0.016), vec3(0.018, 0.026, 0.06), smoothstep(-0.2, 1.0, y));
  // Crisp bone-white horizon strip: the main liquid-metal highlight.
  c += vec3(0.93, 0.91, 0.86) * pow(smoothstep(0.09, 0.0, abs(y - 0.04)), 1.6) * 1.05;
  // Broad, soft cobalt softbox overhead, offset to one side.
  c += vec3(0.16, 0.32, 1.0) * smoothstep(0.55, 1.0, y) * smoothstep(-0.6, 0.6, cos(az - 0.4)) * 0.45;
  // Two thin vertical strip lights; one carries the rare lime accent.
  c += vec3(0.93, 0.91, 0.86) * smoothstep(0.997, 1.0, cos(az + 2.0)) * smoothstep(0.7, 0.0, abs(y - 0.3)) * 0.7;
  c += vec3(0.78, 0.96, 0.22) * smoothstep(0.9985, 1.0, cos(az - 1.1)) * smoothstep(0.5, 0.0, abs(y - 0.2)) * 0.5;
  c += uAccent * smoothstep(-0.35, -1.0, y) * 0.14;
  return c;
}

void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  float dist = length(cameraPosition - vWorldPos);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  float wd = length(vWorldPos - uWell.xyz);
  float wellGlow = uWell.w * exp(-wd * wd * 0.5);

#ifdef WIRE
  vec3 col = uTint * (0.55 + 0.45 * sin(uTime * 0.7 + vWorldPos.y * 1.3)) + vec3(0.78, 0.96, 0.2) * wellGlow * 0.6;
  col = mix(col, uFogColor, fog);
  col = mix(col, vec3(0.9), uErase * 0.6);
  gl_FragColor = vec4(col, uOpacity * (1.0 - fog * 0.7));
#else

#ifdef FLAT
  vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
#else
  vec3 N = normalize(vNormal);
#endif
  if (dot(N, V) < 0.0) N = -N;
  vec3 R = reflect(-V, N);
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 3.0);

  vec3 col = env(R) * mix(vec3(1.0), uTint, 0.45) * uChrome;
  col += uTint * 0.03 * (0.5 + 0.5 * N.y);
  col += fres * vec3(0.5, 0.56, 0.75) * 0.45;
  // Key light: a tight specular glint keeps the surface reading as liquid.
  col += vec3(0.95, 0.93, 0.9) * pow(max(dot(R, normalize(vec3(-0.4, 0.75, 0.5))), 0.0), 90.0) * 1.2;
  col += vec3(0.12, 0.25, 0.95) * smoothstep(0.8, 1.3, vDisp) * 0.1;
  col += vec3(0.78, 0.96, 0.2) * wellGlow * 0.3;

  // Erased: material detail drains away, only silhouettes remain.
  float edge = smoothstep(0.25, 0.85, fres);
  col = mix(col, vec3(edge * 0.95), uErase * 0.9);

  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, uOpacity);
#endif
}
