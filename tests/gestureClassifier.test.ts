import { describe, expect, it } from 'vitest';
import { GestureEngine, type GestureEvent, type GestureFrame } from '../src/camera/gestureClassifier';
import { defaultGestureConfig } from '../src/camera/gestureConfig';
import { extractFeatures, type RawHand } from '../src/camera/landmarkFeatures';
import { along, makeHand } from './syntheticHands';

const FPS_MS = 33;
const OPTS = { aspect: 16 / 9, mirror: true };

function engine() {
  return new GestureEngine(defaultGestureConfig(), { aspect: 16 / 9, debug: true });
}

/** Drives the engine from `t0` to `t1` (ms), collecting all events and the last frame. */
function run(
  e: GestureEngine,
  t0: number,
  t1: number,
  hands: (t: number, k: number) => RawHand[],
): { events: GestureEvent[]; last: GestureFrame; frames: GestureFrame[] } {
  const events: GestureEvent[] = [];
  const frames: GestureFrame[] = [];
  let last!: GestureFrame;
  for (let t = t0; t <= t1; t += FPS_MS) {
    last = e.update(hands(t, (t - t0) / Math.max(1, t1 - t0)), t);
    events.push(...last.events);
    frames.push(last);
  }
  return { events, last, frames };
}

const types = (events: GestureEvent[]) => events.map((e) => e.type);

describe('landmark features', () => {
  it('recognises an open palm as open and facing the camera', () => {
    const f = extractFeatures(makeHand({ pose: 'open' }), OPTS)!;
    expect(f.openness).toBeGreaterThan(0.8);
    expect(f.curl).toBeLessThan(0.3);
    expect(f.facing).toBeGreaterThan(0.9);
    expect(f.pinchDistance).toBeGreaterThan(0.5);
  });

  it('recognises a closed fist as curled', () => {
    const f = extractFeatures(makeHand({ pose: 'fist' }), OPTS)!;
    expect(f.curl).toBeGreaterThan(0.75);
    expect(f.openness).toBeLessThan(0.3);
  });

  it('measures a small thumb-index distance for a pinch', () => {
    const f = extractFeatures(makeHand({ pose: 'pinch' }), OPTS)!;
    expect(f.pinchDistance).toBeLessThan(0.2);
    expect(f.extension[2]).toBeGreaterThan(0.7); // middle finger still extended
  });

  it('detects a palm turned edge-on', () => {
    const f = extractFeatures(makeHand({ pose: 'open', yaw: 1.3 }), OPTS)!;
    expect(f.facing).toBeLessThan(0.5);
  });

  it('mirrors x so the user-facing direction matches', () => {
    const f = extractFeatures(makeHand({ center: { x: 0.2, y: 0.5 } }), OPTS)!;
    expect(f.palm.x).toBeCloseTo(0.8, 1);
  });

  it('rejects invalid landmark data', () => {
    expect(extractFeatures({ landmarks: [], handedness: 'Right', score: 1 }, OPTS)).toBeNull();
    const bad = makeHand();
    bad.landmarks[7] = { x: Number.NaN, y: 0.4, z: 0 };
    expect(extractFeatures(bad, OPTS)).toBeNull();
    const collapsed = makeHand();
    collapsed.landmarks = collapsed.landmarks.map(() => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(extractFeatures(collapsed, OPTS)).toBeNull();
  });
});

describe('static poses', () => {
  it('a stationary fist activates GRAB GRAVITY after the stability window', () => {
    const e = engine();
    const early = run(e, 0, 120, () => [makeHand({ pose: 'fist' })]);
    expect(early.last.controls.grab.active).toBe(false);
    const { last, events } = run(e, 153, 600, () => [makeHand({ pose: 'fist' })]);
    expect(last.controls.grab.active).toBe(true);
    expect(last.gesture).toBe('GRAB_GRAVITY');
    expect(last.controls.grab.strength).toBeGreaterThan(0.5);
    expect(types(events)).not.toContain('reverse');
  });

  it('dragging a fist sideways moves the well and never reverses gravity', () => {
    const e = engine();
    run(e, 0, 400, () => [makeHand({ pose: 'fist', center: { x: 0.3, y: 0.5 } })]);
    const { events, last } = run(e, 433, 1600, (_t, k) => [
      makeHand({ pose: 'fist', center: along({ x: 0.3, y: 0.55 }, { x: 0.7, y: 0.45 }, k) }),
    ]);
    expect(types(events)).not.toContain('reverse');
    expect(last.controls.grab.active).toBe(true);
    // Mirrored: image x 0.7 -> user-facing left.
    expect(last.controls.grab.pos.x).toBeLessThan(0);
  });

  it('a stable camera-facing palm freezes time exactly once', () => {
    const e = engine();
    const { events, frames } = run(e, 0, 1500, () => [makeHand({ pose: 'open' })]);
    expect(types(events).filter((t) => t === 'freeze')).toHaveLength(1);
    const firedAt = frames.findIndex((f) => f.events.some((ev) => ev.type === 'freeze'));
    expect(firedAt * FPS_MS).toBeGreaterThanOrEqual(500);
  });

  it('an edge-on palm does not freeze', () => {
    const e = engine();
    const { events, last } = run(e, 0, 1500, () => [makeHand({ pose: 'open', yaw: 1.3 })]);
    expect(types(events)).not.toContain('freeze');
    expect(last.debug.candidates.some((c) => c.gesture === 'FREEZE_TIME' && /facing/.test(c.reason))).toBe(true);
  });
});

describe('pinch / snap', () => {
  it('pinch then release triggers exactly one snap', () => {
    const e = engine();
    run(e, 0, 200, () => [makeHand({ pose: 'neutral' })]);
    const pinched = run(e, 233, 500, () => [makeHand({ pose: 'pinch' })]);
    expect(types(pinched.events)).not.toContain('snap');
    const released = run(e, 533, 900, () => [makeHand({ pose: 'open', yaw: 0.9 })]);
    expect(types(released.events)).toEqual(['snap']);
  });

  it('pinch takes precedence over the open-hand classification', () => {
    const e = engine();
    // Pinching with the other fingers extended (an "OK" sign) must not freeze time.
    const { events, last } = run(e, 0, 1200, () => [makeHand({ pose: 'pinch' })]);
    expect(types(events)).not.toContain('freeze');
    expect(last.controls.hands[0].pinching).toBe(true);
  });

  it('respects the snap cooldown', () => {
    const e = engine();
    const cycle = (t0: number) => {
      const a = run(e, t0, t0 + 200, () => [makeHand({ pose: 'pinch' })]);
      const b = run(e, t0 + 233, t0 + 330, () => [makeHand({ pose: 'open', yaw: 0.9 })]);
      return [...a.events, ...b.events].filter((x) => x.type === 'snap').length;
    };
    run(e, 0, 100, () => [makeHand({ pose: 'neutral' })]);
    expect(cycle(133)).toBe(1);
    expect(cycle(500)).toBe(0); // within 1200 ms cooldown
    expect(cycle(2000)).toBe(1);
  });

  it('a pinch held too long is cancelled', () => {
    const e = engine();
    run(e, 0, 100, () => [makeHand({ pose: 'neutral' })]);
    run(e, 133, 2200, () => [makeHand({ pose: 'pinch' })]);
    const { events } = run(e, 2233, 2600, () => [makeHand({ pose: 'open', yaw: 0.9 })]);
    expect(types(events)).not.toContain('snap');
  });
});

describe('motion gestures', () => {
  it('an upward fist punch reverses gravity once', () => {
    const e = engine();
    run(e, 0, 300, () => [makeHand({ pose: 'fist', center: { x: 0.5, y: 0.8 } })]);
    const { events } = run(e, 333, 533, (_t, k) => [
      makeHand({ pose: 'fist', center: along({ x: 0.5, y: 0.8 }, { x: 0.5, y: 0.2 }, k) }),
    ]);
    expect(types(events).filter((t) => t === 'reverse')).toHaveLength(1);
    // Holding the fist up afterwards does not retrigger.
    const hold = run(e, 566, 2000, () => [makeHand({ pose: 'fist', center: { x: 0.5, y: 0.2 } })]);
    expect(types(hold.events)).not.toContain('reverse');
  });

  it('a slow rising fist stays a gravity well', () => {
    const e = engine();
    run(e, 0, 300, () => [makeHand({ pose: 'fist', center: { x: 0.5, y: 0.7 } })]);
    const { events, last } = run(e, 333, 2333, (_t, k) => [
      makeHand({ pose: 'fist', center: along({ x: 0.5, y: 0.7 }, { x: 0.5, y: 0.4 }, k) }),
    ]);
    expect(types(events)).not.toContain('reverse');
    expect(last.controls.grab.active).toBe(true);
  });

  it('a fast outward swipe tears reality once, with direction', () => {
    const e = engine();
    run(e, 0, 200, () => [makeHand({ pose: 'open', center: { x: 0.5, y: 0.5 }, yaw: 0.9 })]);
    // Image x 0.45 -> 0.05 is a rightward (outward) swipe after mirroring.
    const { events } = run(e, 233, 400, (_t, k) => [
      makeHand({ pose: 'open', center: along({ x: 0.45, y: 0.5 }, { x: 0.05, y: 0.5 }, k), yaw: 0.9 }),
    ]);
    const tears = events.filter((x) => x.type === 'tear');
    expect(tears).toHaveLength(1);
    const tear = tears[0] as Extract<GestureEvent, { type: 'tear' }>;
    expect(tear.direction.x).toBeGreaterThan(0.9);
  });

  it('a gentle wave conducts a storm without tearing', () => {
    const e = engine();
    run(e, 0, 200, () => [makeHand({ pose: 'open', yaw: 0.9 })]);
    const { events, frames } = run(e, 233, 2233, (t) => [
      makeHand({ pose: 'open', yaw: 0.9, center: { x: 0.5 + 0.12 * Math.sin(t / 220), y: 0.5 } }),
    ]);
    expect(types(events)).not.toContain('tear');
    expect(frames.some((f) => f.controls.storm.active && f.gesture === 'CONDUCT_STORM')).toBe(true);
  });

  it('storm energy decays smoothly after the hand stops', () => {
    const e = engine();
    run(e, 0, 1000, (t) => [makeHand({ pose: 'open', yaw: 0.9, center: { x: 0.5 + 0.12 * Math.sin(t / 200), y: 0.5 } })]);
    const after = run(e, 1033, 1300, () => [makeHand({ pose: 'open', yaw: 0.9, center: { x: 0.5, y: 0.5 } })]);
    const energies = after.frames.map((f) => f.controls.storm.energy);
    expect(energies[0]).toBeGreaterThan(energies[energies.length - 1]);
  });
});

describe('two-hand stretch', () => {
  const pair = (gap: number) => [
    makeHand({ pose: 'open', center: { x: 0.5 - gap / 2, y: 0.5 }, handedness: 'Right', yaw: 0.9 }),
    makeHand({ pose: 'open', center: { x: 0.5 + gap / 2, y: 0.5 }, handedness: 'Left', yaw: 0.9 }),
  ];

  it('detects two open hands and tracks the distance ratio', () => {
    const e = engine();
    run(e, 0, 300, () => pair(0.3));
    const apart = run(e, 333, 1300, (_t, k) => pair(0.3 + 0.3 * k));
    expect(apart.last.controls.stretch.active).toBe(true);
    expect(apart.last.gesture).toBe('STRETCH_REALITY');
    expect(apart.last.controls.stretch.factor).toBeGreaterThan(1.6);
    const together = run(e, 1333, 2300, (_t, k) => pair(0.6 - 0.45 * k));
    expect(together.last.controls.stretch.factor).toBeLessThan(0.7);
  });

  it('stretching suppresses tears and freezes', () => {
    const e = engine();
    run(e, 0, 300, () => pair(0.3));
    const fast = run(e, 333, 450, (_t, k) => pair(0.3 + 0.5 * k));
    expect(types(fast.events)).not.toContain('tear');
    const flat = run(e, 0 + 500, 2000, () => [
      makeHand({ pose: 'open', center: { x: 0.3, y: 0.5 } }),
      makeHand({ pose: 'open', center: { x: 0.7, y: 0.5 }, handedness: 'Left' }),
    ]);
    expect(types(flat.events)).not.toContain('freeze');
  });

  it('clamps the deformation factor', () => {
    const e = engine();
    run(e, 0, 300, () => pair(0.1));
    const { last } = run(e, 333, 1500, (_t, k) => pair(0.1 + 0.8 * k));
    expect(last.controls.stretch.factor).toBeLessThanOrEqual(defaultGestureConfig().stretch.maxFactor);
  });
});

describe('erase', () => {
  it('a hand covering the lens erases, and moving away restores', () => {
    const e = engine();
    const { events } = run(e, 0, 600, () => [makeHand({ pose: 'open', scale: 0.62 })]);
    expect(types(events)).toEqual(['eraseStart']);
    expect(types(events)).not.toContain('freeze');
    const away = run(e, 633, 1200, () => [makeHand({ pose: 'neutral', scale: 0.15 })]);
    expect(types(away.events)).toEqual(['eraseEnd']);
  });

  it('a single large noisy frame does not erase', () => {
    const e = engine();
    const { events } = run(e, 0, 600, (t) => [makeHand({ pose: 'neutral', scale: t === 198 ? 0.62 : 0.15 })]);
    expect(types(events)).not.toContain('eraseStart');
  });

  it('infers occlusion only when the hand was approaching before tracking loss', () => {
    const e = engine();
    run(e, 0, 400, (_t, k) => [makeHand({ pose: 'neutral', scale: 0.3 + 0.18 * k })]);
    const lost = run(e, 433, 800, () => []);
    expect(types(lost.events)).toEqual(['eraseStart']);
    const later = run(e, 833, 3500, () => []);
    expect(types(later.events)).toEqual(['eraseEnd']);

    const e2 = engine();
    run(e2, 0, 400, () => [makeHand({ pose: 'neutral', scale: 0.15 })]);
    expect(types(run(e2, 433, 900, () => []).events)).toEqual([]);
  });
});

describe('transitions, tracking loss and conflicts', () => {
  it('uses hysteresis: a slightly relaxed fist stays a fist', () => {
    const e = engine();
    run(e, 0, 400, () => [makeHand({ pose: 'fist' })]);
    // Blend toward open until curl drops below the enter threshold but stays above exit.
    const fist = makeHand({ pose: 'fist' });
    const open = makeHand({ pose: 'open' });
    const blend = (w: number): RawHand => ({
      ...fist,
      landmarks: fist.landmarks.map((p, i) => ({
        x: p.x * (1 - w) + open.landmarks[i].x * w,
        y: p.y * (1 - w) + open.landmarks[i].y * w,
        z: p.z * (1 - w) + open.landmarks[i].z * w,
      })),
    });
    const target = (defaultGestureConfig().pose.fistEnter + defaultGestureConfig().pose.fistExit) / 2;
    let mixed = blend(0);
    let bestErr = Infinity;
    for (let w = 0; w <= 1; w += 0.01) {
      const err = Math.abs(extractFeatures(blend(w), OPTS)!.curl - target);
      if (err < bestErr) {
        bestErr = err;
        mixed = blend(w);
      }
    }
    const curl = extractFeatures(mixed, OPTS)!.curl;
    const cfg = defaultGestureConfig().pose;
    expect(curl).toBeLessThan(cfg.fistEnter);
    expect(curl).toBeGreaterThan(cfg.fistExit);
    const { last } = run(e, 433, 700, () => [mixed]);
    expect(last.controls.hands[0].pose).toBe('fist');
    // A fresh engine does not enter fist from the same ambiguous shape.
    const e2 = engine();
    expect(run(e2, 0, 300, () => [mixed]).last.controls.hands[0].pose).not.toBe('fist');
  });

  it('transitions from fist (grab) to open hand (release) cleanly', () => {
    const e = engine();
    expect(run(e, 0, 500, () => [makeHand({ pose: 'fist' })]).last.controls.grab.active).toBe(true);
    const { last } = run(e, 533, 700, () => [makeHand({ pose: 'open', yaw: 0.9 })]);
    expect(last.controls.grab.active).toBe(false);
    expect(last.controls.hands[0].pose).toBe('open');
  });

  it('fades forces out on tracking loss instead of snapping', () => {
    const e = engine();
    run(e, 0, 600, () => [makeHand({ pose: 'fist' })]);
    const lost = run(e, 633, 1300, () => []);
    const strengths = lost.frames.map((f) => f.controls.grab.strength);
    expect(strengths[0]).toBeGreaterThan(0.3);
    expect(strengths[1]).toBeLessThan(strengths[0]);
    expect(strengths[strengths.length - 1]).toBe(0);
    expect(lost.frames[0].controls.hands[0].tracked).toBe(false);
    expect(lost.last.controls.hands).toHaveLength(0);
  });

  it('does not inject huge velocities on a tracking jump', () => {
    const e = engine();
    run(e, 0, 300, () => [makeHand({ pose: 'open', yaw: 0.9, center: { x: 0.5, y: 0.5 } })]);
    const { events, last } = run(e, 333, 400, () => [makeHand({ pose: 'open', yaw: 0.9, center: { x: 0.05, y: 0.1 } })]);
    expect(types(events)).not.toContain('tear');
    expect(last.controls.hands[0].speed).toBeLessThan(defaultGestureConfig().smoothing.maxSpeed);
  });

  it('ignores invalid and low-confidence detections', () => {
    const e = engine();
    const bad = { landmarks: [{ x: 0, y: 0, z: 0 }], handedness: 'Right', score: 1 } as RawHand;
    const { last } = run(e, 0, 300, () => [bad, null as unknown as RawHand, makeHand({ score: 0.1 })]);
    expect(last.handCount).toBe(0);
    expect(last.events).toHaveLength(0);
  });

  it('never reports grab and reverse for the same punch frame', () => {
    const e = engine();
    run(e, 0, 400, () => [makeHand({ pose: 'fist', center: { x: 0.5, y: 0.85 } })]);
    const { frames } = run(e, 433, 633, (_t, k) => [
      makeHand({ pose: 'fist', center: along({ x: 0.5, y: 0.85 }, { x: 0.5, y: 0.2 }, k) }),
    ]);
    const fired = frames.find((f) => f.events.some((ev) => ev.type === 'reverse'))!;
    expect(fired).toBeDefined();
    expect(fired.controls.grab.active).toBe(false);
    expect(fired.gesture).toBe('REVERSE_GRAVITY');
  });

  it('a fast open-hand swipe tears but does not reverse gravity', () => {
    const e = engine();
    run(e, 0, 300, () => [makeHand({ pose: 'open', yaw: 0.9, center: { x: 0.5, y: 0.6 } })]);
    const { events } = run(e, 333, 500, (_t, k) => [
      makeHand({ pose: 'open', yaw: 0.9, center: along({ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.05 }, k) }),
    ]);
    expect(types(events)).toEqual(['tear']);
  });

  it('respects the tear cooldown', () => {
    const e = engine();
    let count = 0;
    let t = 0;
    for (let i = 0; i < 4; i++) {
      run(e, t, t + 100, () => [makeHand({ pose: 'open', yaw: 0.9, center: { x: 0.45, y: 0.5 } })]);
      count += run(e, t + 133, t + 260, (_t, k) => [
        makeHand({ pose: 'open', yaw: 0.9, center: along({ x: 0.45, y: 0.5 }, { x: 0.05, y: 0.5 }, k) }),
      ]).events.filter((x) => x.type === 'tear').length;
      t += 300;
    }
    // Swipes every 300 ms against a 700 ms cooldown.
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(2);
  });
});
