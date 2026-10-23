// Ribbons: CPU builds the strip (positions follow a lagging chain); the
// vertex shader only passes along-length and across coordinates.
attribute float aAlong;
attribute float aSide;
varying float vAlong;
varying float vSide;
varying float vDepth;
void main() {
  vAlong = aAlong;
  vSide = aSide;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
