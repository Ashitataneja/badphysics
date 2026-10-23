// Final composite: one full-screen pass combining Shaders B, C and E with
// restrained chromatic offset, breach intensity, freeze grade, vignette and
// grain. A single pass keeps overdraw to one screen-sized triangle.
//
// tScene        scene render target
// uResolution   drawing-buffer size
// uBreach       0..1 intensity of a reality breach
// uFreeze       0..1 frozen-time grade
// uFlash        0..1 brief exposure lift (already scaled by reduced-flash)
// uAberration   chromatic offset in pixels
// uGrain        film grain amount

uniform sampler2D tScene;
uniform vec2 uResolution;
uniform float uFrame;
uniform float uBreach;
uniform float uFreeze;
uniform float uFlash;
uniform float uAberration;
uniform float uGrain;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float aspect = uResolution.x / uResolution.y;
  float ring;
  vec2 uv = gravityLens(vUv, aspect, ring);
  Tear tear = spatialTear(uv, aspect);
  uv += tear.offset;

  vec2 fromCentre = uv - 0.5;
  vec2 ab = fromCentre * (uAberration * (1.0 + uBreach * 3.0)) / uResolution.x;
  vec3 col;
  col.r = texture2D(tScene, uv + ab).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - ab).b;

  // Fissure: a void with a hot edge.
  vec3 voidCol = vec3(0.0, 0.004, 0.02) + vec3(0.16, 0.34, 1.0) * 0.25 * hash(floor(vUv * uResolution / 3.0) + uFrame);
  col = mix(col, voidCol, tear.fissure);
  col += tear.edge * mix(vec3(1.0, 0.3, 0.12), vec3(0.95, 0.93, 0.88), 0.55) * 0.7;
  col += ring * vec3(0.91, 0.89, 0.84) * 0.25;

  // Frozen time: cool, slightly desaturated hold.
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(l) * vec3(0.86, 0.92, 1.08), uFreeze * 0.55);

  col += uFlash * vec3(0.9, 0.92, 1.0) * 0.35;

  float vig = smoothstep(1.15, 0.25, length(fromCentre * vec2(aspect * 0.8, 1.0)));
  col *= mix(0.55, 1.0, vig);

  col = realityInversion(col);

  col += (hash(vUv * uResolution + uFrame) - 0.5) * uGrain;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
