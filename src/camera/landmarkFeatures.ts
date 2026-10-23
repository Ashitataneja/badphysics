import { clamp01, isFiniteNumber, remap01, type Vec2, type Vec3 } from '../utils/math';

/** A single MediaPipe normalised landmark (x, y in 0..1 image space, z relative depth). */
export interface RawLandmark {
  x: number;
  y: number;
  z: number;
}

export interface RawHand {
  landmarks: RawLandmark[];
  /** 'Left' | 'Right' as reported by MediaPipe. */
  handedness: string;
  /** Handedness classification score, used as a tracking confidence proxy. */
  score: number;
}

/** Landmark indices (MediaPipe hand model). */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

const FINGERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
];

/** Geometric description of one hand, independent of rendering. */
export interface HandFeatures {
  handedness: string;
  score: number;
  /** Palm centre in image space (0..1), already mirrored if requested. */
  palm: Vec2;
  wrist: Vec2;
  thumbTip: Vec2;
  indexTip: Vec2;
  /** Wrist → middle MCP length in aspect-corrected image units. */
  palmSize: number;
  /** Extension per finger, 0 = curled, 1 = straight. Order: thumb, index, middle, ring, pinky. */
  extension: [number, number, number, number, number];
  /** 0 = closed fist, 1 = fully open. */
  openness: number;
  /** Mean curl of the four fingers (1 - extension). */
  curl: number;
  /** Thumb-tip to index-tip distance divided by palm size. */
  pinchDistance: number;
  /** Unit palm normal (aspect-corrected). */
  palmNormal: Vec3;
  /** |normal.z|: 1 when the palm faces the camera squarely. */
  facing: number;
  /** Axis-aligned bounding box area as a fraction of the frame. */
  bboxArea: number;
  bboxSize: number;
}

export interface FeatureOptions {
  /** Video width / height. */
  aspect: number;
  mirror: boolean;
}

/** Validates landmark data. Returns false for missing, short or non-finite input. */
export function isValidHand(hand: RawHand | null | undefined): hand is RawHand {
  if (!hand || !Array.isArray(hand.landmarks) || hand.landmarks.length < 21) return false;
  for (let i = 0; i < 21; i++) {
    const p = hand.landmarks[i];
    if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return false;
    if (p.z !== undefined && !isFiniteNumber(p.z)) return false;
  }
  return true;
}

/**
 * Converts 21 landmarks into features. Returns null for invalid data or a
 * degenerate (zero-size) hand.
 */
export function extractFeatures(hand: RawHand, opts: FeatureOptions): HandFeatures | null {
  if (!isValidHand(hand)) return null;
  const { aspect, mirror } = opts;
  const lm = hand.landmarks;
  // Aspect-corrected 3D points so distances are isotropic.
  const P: Vec3[] = new Array(21);
  for (let i = 0; i < 21; i++) {
    const l = lm[i];
    const x = mirror ? 1 - l.x : l.x;
    P[i] = { x: x * aspect, y: l.y, z: (l.z ?? 0) * aspect };
  }
  const d = (a: number, b: number) => Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y, P[a].z - P[b].z);

  const palmSize = d(LM.WRIST, LM.MIDDLE_MCP);
  if (!(palmSize > 1e-4)) return null;

  const palmIdx = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let pcx = 0,
    pcy = 0,
    pcz = 0;
  for (const i of palmIdx) {
    pcx += P[i].x;
    pcy += P[i].y;
    pcz += P[i].z;
  }
  pcx /= 5;
  pcy /= 5;
  pcz /= 5;

  const extension: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (let f = 0; f < 4; f++) {
    const [mcp, pip, dip, tip] = FINGERS[f];
    const chain = d(mcp, pip) + d(pip, dip) + d(dip, tip);
    const straightness = chain > 1e-6 ? d(mcp, tip) / chain : 0;
    const tipToPalm =
      Math.hypot(P[tip].x - pcx, P[tip].y - pcy, P[tip].z - pcz) / palmSize;
    extension[f + 1] = 0.5 * remap01(straightness, 0.55, 0.95) + 0.5 * remap01(tipToPalm, 0.75, 1.2);
  }
  // Thumb: how far the tip sits from the index MCP relative to the palm.
  extension[0] = remap01(d(LM.THUMB_TIP, LM.INDEX_MCP) / palmSize, 0.35, 0.85);

  const fingerMean = (extension[1] + extension[2] + extension[3] + extension[4]) / 4;
  const openness = clamp01(fingerMean * 0.85 + extension[0] * 0.15);
  const curl = 1 - fingerMean;

  // Palm normal from the wrist → index MCP and wrist → pinky MCP vectors.
  const ax = P[LM.INDEX_MCP].x - P[LM.WRIST].x;
  const ay = P[LM.INDEX_MCP].y - P[LM.WRIST].y;
  const az = P[LM.INDEX_MCP].z - P[LM.WRIST].z;
  const bx = P[LM.PINKY_MCP].x - P[LM.WRIST].x;
  const by = P[LM.PINKY_MCP].y - P[LM.WRIST].y;
  const bz = P[LM.PINKY_MCP].z - P[LM.WRIST].z;
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < 21; i++) {
    const x = clamp01(lm[i].x);
    const y = clamp01(lm[i].y);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bw = maxX - minX;
  const bh = maxY - minY;

  const toImage = (p: Vec3): Vec2 => ({ x: p.x / aspect, y: p.y });

  return {
    handedness: hand.handedness,
    score: clamp01(hand.score),
    palm: { x: pcx / aspect, y: pcy },
    wrist: toImage(P[LM.WRIST]),
    thumbTip: toImage(P[LM.THUMB_TIP]),
    indexTip: toImage(P[LM.INDEX_TIP]),
    palmSize,
    extension,
    openness,
    curl,
    pinchDistance: d(LM.THUMB_TIP, LM.INDEX_TIP) / palmSize,
    palmNormal: { x: nx, y: ny, z: nz },
    facing: Math.abs(nz),
    bboxArea: bw * bh,
    bboxSize: Math.max(bw, bh),
  };
}
