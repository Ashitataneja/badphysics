import noise from './noise.glsl?raw';
import fields from './fields.glsl?raw';
import liquidVert from './liquidDisplacement.vert?raw';
import liquidFrag from './liquidDisplacement.frag?raw';
import particleVert from './particle.vert?raw';
import particleFrag from './particle.frag?raw';
import gravityLens from './gravityLens.frag?raw';
import spatialTear from './spatialTear.frag?raw';
import realityInversion from './realityInversion.frag?raw';
import composite from './composite.frag?raw';
import fullscreenVert from './fullscreen.vert?raw';
import simpleVert from './simple.vert?raw';
import lightShaftFrag from './lightShaft.frag?raw';
import backdropFrag from './backdrop.frag?raw';
import ribbonVert from './ribbon.vert?raw';
import ribbonFrag from './ribbon.frag?raw';

/** Shader sources, composed from modular chunks. */
export const shaders = {
  liquid: {
    vertex: [noise, fields, liquidVert].join('\n'),
    fragment: [fields, liquidFrag].join('\n'),
  },
  particle: {
    vertex: [fields, particleVert].join('\n'),
    fragment: particleFrag,
  },
  composite: {
    vertex: fullscreenVert,
    fragment: [gravityLens, spatialTear, realityInversion, composite].join('\n'),
  },
  lightShaft: { vertex: simpleVert, fragment: lightShaftFrag },
  backdrop: { vertex: simpleVert, fragment: backdropFrag },
  ribbon: { vertex: ribbonVert, fragment: ribbonFrag },
};
