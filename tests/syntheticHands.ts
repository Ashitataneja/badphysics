import type { RawHand, RawLandmark } from '../src/camera/landmarkFeatures';

export type SynthPose = 'open' | 'fist' | 'pinch' | 'neutral';

export interface SynthOptions {
  pose?: SynthPose;
  /** Palm centre in image space (0..1, y down). */
  center?: { x: number; y: number };
  /** Palm length (wrist → middle MCP) as a fraction of image height. */
  scale?: number;
  /** Rotation of the hand about the vertical axis, radians (0 = palm faces camera). */
  yaw?: number;
  handedness?: 'Left' | 'Right';
  score?: number;
  aspect?: number;
}

type P = [number, number, number];

// Local hand frame: wrist at origin, fingers point +y, palm faces -z (toward camera).
const MCP: P[] = [
  [-0.3, 0.95, 0],
  [-0.1, 1.0, 0],
  [0.1, 0.95, 0],
  [0.3, 0.85, 0],
];
const LEN = [0.9, 1.0, 0.95, 0.75];

function extended(mcp: P, len: number): P[] {
  const spread = mcp[0] * 0.25;
  const seg = [0.45, 0.3, 0.25].map((f) => f * len);
  const pip: P = [mcp[0] + spread * seg[0], mcp[1] + seg[0], 0];
  const dip: P = [pip[0] + spread * seg[1], pip[1] + seg[1], 0];
  const tip: P = [dip[0] + spread * seg[2], dip[1] + seg[2], 0];
  return [pip, dip, tip];
}

function curled(mcp: P): P[] {
  return [
    [mcp[0], mcp[1] + 0.3, -0.22],
    [mcp[0], mcp[1] + 0.12, -0.38],
    [mcp[0], mcp[1] - 0.12, -0.22],
  ];
}

function local(pose: SynthPose): P[] {
  const pts: P[] = new Array(21);
  pts[0] = [0, 0, 0];
  const fingers = MCP.map((m, i) => {
    if (pose === 'fist') return curled(m);
    if (pose === 'neutral') return i === 0 ? extended(m, LEN[i]) : curled(m);
    if (pose === 'pinch' && i === 0)
      return [
        [-0.35, 1.32, -0.12],
        [-0.42, 1.52, -0.28],
        [-0.48, 1.45, -0.42],
      ] as P[];
    return extended(m, LEN[i]);
  });
  // Thumb
  if (pose === 'fist') {
    pts[1] = [-0.3, 0.25, -0.05];
    pts[2] = [-0.4, 0.45, -0.18];
    pts[3] = [-0.3, 0.62, -0.3];
    pts[4] = [-0.12, 0.7, -0.34];
  } else if (pose === 'pinch') {
    const tip = fingers[0][2];
    pts[1] = [-0.3, 0.25, -0.05];
    pts[2] = [-0.5, 0.5, -0.15];
    pts[3] = [-0.55, 0.95, -0.3];
    pts[4] = [tip[0] - 0.02, tip[1] - 0.03, tip[2]];
  } else {
    pts[1] = [-0.3, 0.25, 0];
    pts[2] = [-0.55, 0.45, 0];
    pts[3] = [-0.75, 0.65, 0];
    pts[4] = [-0.9, 0.8, 0];
  }
  MCP.forEach((m, i) => {
    const base = 5 + i * 4;
    pts[base] = m;
    pts[base + 1] = fingers[i][0];
    pts[base + 2] = fingers[i][1];
    pts[base + 3] = fingers[i][2];
  });
  return pts;
}

export function makeHand(opts: SynthOptions = {}): RawHand {
  const pose = opts.pose ?? 'open';
  const center = opts.center ?? { x: 0.5, y: 0.5 };
  const s = opts.scale ?? 0.16;
  const aspect = opts.aspect ?? 16 / 9;
  const yaw = opts.yaw ?? 0;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const landmarks: RawLandmark[] = local(pose).map(([x, y, z]) => {
    const rx = x * c + z * sn;
    const rz = -x * sn + z * c;
    // Palm centre in local space sits at roughly (0, 0.75).
    return { x: center.x + (rx * s) / aspect, y: center.y - (y - 0.75) * s, z: (rz * s) / aspect };
  });
  return { landmarks, handedness: opts.handedness ?? 'Right', score: opts.score ?? 0.95 };
}

/** Linear motion helper: palm centre for `t` in [0, 1]. */
export const along = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
