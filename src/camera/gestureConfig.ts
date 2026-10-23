/**
 * Gesture recognition thresholds. All values are starting points: tune them
 * against real webcam input. Distances are normalised by palm size, speeds
 * are in control units per second (the calibrated interaction area spans
 * -1..1 on each axis), and times are in milliseconds.
 */
export interface GestureConfig {
  mapping: {
    /** Fraction of the camera frame (centred) mapped onto the full -1..1 range. */
    rangeX: number;
    rangeY: number;
    /** Radius around the centre where position changes are softened. */
    deadZone: number;
    sensitivity: number;
    /** Mirror horizontally so moving your right hand right moves the world right. */
    mirror: boolean;
    invertY: boolean;
  };
  smoothing: {
    positionTau: number;
    velocityTau: number;
    maxSpeed: number;
    /** A per-frame jump larger than this is treated as a tracking discontinuity. */
    jumpThreshold: number;
    /** How long a lost hand fades out before its state is discarded. */
    lostFadeMs: number;
    /** Max distance (control units) to associate a detection with an existing tracked hand. */
    matchDistance: number;
  };
  minTrackingScore: number;
  pose: {
    fistEnter: number; // curl to enter fist
    fistExit: number;
    openEnter: number; // openness to enter open
    openExit: number;
    pinchEnter: number; // thumb-index distance / palm size
    pinchExit: number;
  };
  grab: { stableMs: number; rampMs: number; suppressAfterPunchMs: number };
  stretch: { stableMs: number; minFactor: number; maxFactor: number };
  tear: {
    minSpeed: number;
    /** Displacement / path length over the recent window. 1 = perfectly straight. */
    minStraightness: number;
    windowMs: number;
    cooldownMs: number;
    /** Swipe must move away from the centre: dot(dir, position) must exceed this. */
    minOutward: number;
  };
  reverse: {
    minUpSpeed: number;
    minRise: number;
    windowMs: number;
    /** |vx| must be below this fraction of vy. */
    maxHorizontalRatio: number;
    minFistMs: number;
    cooldownMs: number;
  };
  storm: { enterSpeed: number; exitSpeed: number; energyTau: number; energyFullSpeed: number };
  snap: { minHoldMs: number; maxHoldMs: number; cooldownMs: number };
  freeze: { stableMs: number; minOpenness: number; minFacing: number; maxSpeed: number };
  erase: {
    enterArea: number;
    exitArea: number;
    stableMs: number;
    exitMs: number;
    /** When tracking vanishes behind a hand covering the lens, keep the effect at most this long. */
    occlusionMaxMs: number;
    occlusionMinArea: number;
  };
  /** How long a discrete gesture name stays on the HUD after firing. */
  eventDisplayMs: number;
}

export const defaultGestureConfig = (): GestureConfig => ({
  mapping: { rangeX: 0.8, rangeY: 0.8, deadZone: 0.04, sensitivity: 1, mirror: true, invertY: false },
  smoothing: {
    positionTau: 0.045,
    velocityTau: 0.05,
    maxSpeed: 12,
    jumpThreshold: 0.75,
    lostFadeMs: 450,
    matchDistance: 0.9,
  },
  minTrackingScore: 0.5,
  pose: { fistEnter: 0.68, fistExit: 0.52, openEnter: 0.72, openExit: 0.58, pinchEnter: 0.28, pinchExit: 0.45 },
  grab: { stableMs: 200, rampMs: 600, suppressAfterPunchMs: 600 },
  stretch: { stableMs: 150, minFactor: 0.35, maxFactor: 2.6 },
  tear: { minSpeed: 3.4, minStraightness: 0.85, windowMs: 160, cooldownMs: 700, minOutward: -0.15 },
  reverse: { minUpSpeed: 2.2, minRise: 0.3, windowMs: 380, maxHorizontalRatio: 0.75, minFistMs: 60, cooldownMs: 2500 },
  storm: { enterSpeed: 0.35, exitSpeed: 0.2, energyTau: 0.35, energyFullSpeed: 4 },
  snap: { minHoldMs: 60, maxHoldMs: 1500, cooldownMs: 1200 },
  freeze: { stableMs: 500, minOpenness: 0.8, minFacing: 0.7, maxSpeed: 0.35 },
  erase: { enterArea: 0.3, exitArea: 0.2, stableMs: 250, exitMs: 300, occlusionMaxMs: 2200, occlusionMinArea: 0.2 },
  eventDisplayMs: 1400,
});
