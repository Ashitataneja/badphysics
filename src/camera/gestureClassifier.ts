import { clamp, clamp01, type Vec2 } from '../utils/math';
import { KinematicSmoother, ScalarSmoother } from '../utils/smoothing';
import { defaultGestureConfig, type GestureConfig } from './gestureConfig';
import { extractFeatures, type HandFeatures, type RawHand } from './landmarkFeatures';

export type GestureName =
  | 'NONE'
  | 'GRAB_GRAVITY'
  | 'STRETCH_REALITY'
  | 'TEAR_REALITY'
  | 'REVERSE_GRAVITY'
  | 'CONDUCT_STORM'
  | 'SNAP_UNIVERSE'
  | 'FREEZE_TIME'
  | 'ERASE_YOURSELF';

export type Pose = 'neutral' | 'open' | 'fist';
export type InputSource = 'hand' | 'keyboard' | 'pointer';

/** Discrete, one-shot interaction events. Keyboard and pointer input emit the same events. */
export type GestureEvent =
  | { type: 'tear'; origin: Vec2; direction: Vec2; speed: number; source: InputSource }
  | { type: 'reverse'; origin: Vec2; source: InputSource }
  | { type: 'snap'; origin: Vec2; source: InputSource }
  | { type: 'freeze'; source: InputSource }
  | { type: 'resume'; source: InputSource }
  | { type: 'eraseStart'; source: InputSource; occluded?: boolean }
  | { type: 'eraseEnd'; source: InputSource };

export interface HandControl {
  id: number;
  /** Position in control space: x, y in roughly -1..1, +x right, +y up. */
  pos: Vec2;
  vel: Vec2;
  speed: number;
  pose: Pose;
  pinching: boolean;
  /** 1 while tracked, fading to 0 after tracking loss. */
  presence: number;
  score: number;
  tracked: boolean;
  openness: number;
  palmSize: number;
}

/** Continuous interaction values consumed by the simulation. */
export interface ControlState {
  hands: HandControl[];
  grab: { active: boolean; pos: Vec2; strength: number };
  stretch: { active: boolean; a: Vec2; b: Vec2; factor: number };
  storm: { active: boolean; pos: Vec2; vel: Vec2; energy: number; turbulence: number; vortex: number };
  erase: boolean;
}

export type CandidateStatus = 'active' | 'fired' | 'pending' | 'rejected';

export interface GestureCandidate {
  gesture: GestureName;
  hand: number;
  confidence: number;
  status: CandidateStatus;
  reason: string;
}

export interface HandDebug {
  id: number;
  handedness: string;
  pose: Pose;
  pinching: boolean;
  openness: number;
  curl: number;
  pinchDistance: number;
  facing: number;
  speed: number;
  vel: Vec2;
  bboxArea: number;
}

export interface GestureFrame {
  time: number;
  /** The gesture currently shown to the user (only after stability checks). */
  gesture: GestureName;
  confidence: number;
  events: GestureEvent[];
  controls: ControlState;
  handCount: number;
  trackingConfidence: number;
  debug: { hands: HandDebug[]; candidates: GestureCandidate[] };
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

const HISTORY = 48;

class HandTrack {
  readonly kin: KinematicSmoother;
  features!: HandFeatures;
  lastSeen = 0;
  presence = 1;
  tracked = true;
  pose: Pose = 'neutral';
  poseSince = 0;
  pinching = false;
  pinchSince = 0;
  /** Pinch held too long: must release before another snap can register. */
  pinchSpent = false;
  stormActive = false;
  readonly energy: ScalarSmoother;
  readonly vortex = new ScalarSmoother(0.25);
  grabSuppressedUntil = 0;
  freezeSince: number | null = null;
  freezeArmed = true;
  freezeBrokenSince: number | null = null;
  /** Fixed-capacity ring buffer of smoothed positions. */
  readonly history: Sample[] = Array.from({ length: HISTORY }, () => ({ t: -1, x: 0, y: 0 }));
  historyHead = 0;
  control!: Vec2;

  constructor(
    readonly id: number,
    cfg: GestureConfig,
  ) {
    const s = cfg.smoothing;
    this.kin = new KinematicSmoother(s.positionTau, s.velocityTau, s.maxSpeed, s.jumpThreshold);
    this.energy = new ScalarSmoother(cfg.storm.energyTau);
  }

  push(t: number, x: number, y: number): void {
    const s = this.history[this.historyHead];
    s.t = t;
    s.x = x;
    s.y = y;
    this.historyHead = (this.historyHead + 1) % HISTORY;
  }

  clearHistory(): void {
    for (const s of this.history) s.t = -1;
  }

  /** Iterates samples newer than `since`, newest first. */
  forEachSince(since: number, fn: (s: Sample) => void): void {
    for (let i = 1; i <= HISTORY; i++) {
      const s = this.history[(this.historyHead - i + HISTORY) % HISTORY];
      if (s.t < 0 || s.t < since) break;
      fn(s);
    }
  }
}

const emptyControls = (): ControlState => ({
  hands: [],
  grab: { active: false, pos: { x: 0, y: 0 }, strength: 0 },
  stretch: { active: false, a: { x: -0.5, y: 0 }, b: { x: 0.5, y: 0 }, factor: 1 },
  storm: { active: false, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, energy: 0, turbulence: 0, vortex: 0 },
  erase: false,
});

export interface GestureEngineOptions {
  /** Video aspect ratio (width / height). */
  aspect?: number;
  /** Collect per-candidate debug data. */
  debug?: boolean;
}

/**
 * Converts streams of landmark detections into stable gestures, continuous
 * control values and one-shot events. Pure logic: no DOM, no rendering.
 *
 * Priority (most specific first):
 *   1. ERASE (hand covering the lens) suppresses everything else.
 *   2. Completed discrete gestures: SNAP (pinch-release), REVERSE (upward
 *      fist punch), TEAR (fast straight open-hand swipe), FREEZE (stable
 *      camera-facing palm).
 *   3. Continuous states: STRETCH (two open hands) > GRAB (stable fist) > STORM.
 * A pinch overrides the generic open-hand classification, and a fist that is
 * rising fast is treated as a punch candidate rather than a gravity well.
 */
export class GestureEngine {
  config: GestureConfig;
  aspect: number;
  debugEnabled: boolean;

  private tracks: HandTrack[] = [];
  private nextId = 1;
  private lastTime = -1;
  private lastEvent: { gesture: GestureName; at: number; confidence: number } | null = null;
  private cooldowns = { tear: -Infinity, reverse: -Infinity, snap: -Infinity };
  private stretch = { active: false, initialDistance: 1, factor: 1 };
  private erase = {
    active: false,
    occluded: false,
    candidateSince: null as number | null,
    exitSince: null as number | null,
    activeNoHandSince: null as number | null,
    lastArea: 0,
    areaHistory: [] as { t: number; area: number }[],
  };

  constructor(config: GestureConfig = defaultGestureConfig(), opts: GestureEngineOptions = {}) {
    this.config = config;
    this.aspect = opts.aspect ?? 16 / 9;
    this.debugEnabled = opts.debug ?? false;
  }

  reset(): void {
    this.tracks = [];
    this.lastTime = -1;
    this.lastEvent = null;
    this.cooldowns = { tear: -Infinity, reverse: -Infinity, snap: -Infinity };
    this.stretch = { active: false, initialDistance: 1, factor: 1 };
    this.erase = {
      active: false,
      occluded: false,
      candidateSince: null,
      exitSince: null,
      activeNoHandSince: null,
      lastArea: 0,
      areaHistory: [],
    };
  }

  get isErasing(): boolean {
    return this.erase.active;
  }

  /** Maps an image-space point (0..1) to control space with calibration and dead zone. */
  mapToControl(p: Vec2): Vec2 {
    const m = this.config.mapping;
    let x = ((p.x - 0.5) / (m.rangeX / 2)) * m.sensitivity;
    let y = (-(p.y - 0.5) / (m.rangeY / 2)) * m.sensitivity;
    if (m.invertY) y = -y;
    const r = Math.hypot(x, y);
    if (m.deadZone > 0 && r > 1e-9) {
      const dz = m.deadZone;
      const r2 = r < dz ? (r * r) / (2 * dz) : r - dz / 2;
      x *= r2 / r;
      y *= r2 / r;
    }
    return { x: clamp(x, -1.5, 1.5), y: clamp(y, -1.5, 1.5) };
  }

  /**
   * Feed one detection result. `hands` may be empty (nothing detected) and may
   * contain invalid entries, which are ignored. `now` is in milliseconds.
   */
  update(hands: ReadonlyArray<RawHand | null | undefined>, now: number): GestureFrame {
    const cfg = this.config;
    const dt = this.lastTime < 0 ? 1 / 30 : clamp((now - this.lastTime) / 1000, 1e-3, 0.25);
    this.lastTime = now;
    const events: GestureEvent[] = [];
    const candidates: GestureCandidate[] = [];
    const dbg = this.debugEnabled;
    const reject = (gesture: GestureName, hand: number, reason: string, confidence = 0) => {
      if (dbg) candidates.push({ gesture, hand, confidence, status: 'rejected', reason });
    };
    const note = (gesture: GestureName, hand: number, status: CandidateStatus, confidence: number, reason = '') => {
      if (dbg) candidates.push({ gesture, hand, confidence, status, reason });
    };

    // --- 1. Features ---------------------------------------------------------
    const detections: { f: HandFeatures; c: Vec2 }[] = [];
    for (const h of hands) {
      if (!h) continue;
      const f = extractFeatures(h, { aspect: this.aspect, mirror: cfg.mapping.mirror });
      if (!f || f.score < cfg.minTrackingScore) continue;
      detections.push({ f, c: this.mapToControl(f.palm) });
      if (detections.length === 2) break;
    }

    // --- 2. Associate detections with tracked hands -------------------------
    const assigned = new Set<HandTrack>();
    const pairs: { t: HandTrack; d: number; i: number }[] = [];
    for (const t of this.tracks) {
      detections.forEach((det, i) => {
        const penalty = t.features && t.features.handedness !== det.f.handedness ? 0.3 : 0;
        pairs.push({ t, i, d: Math.hypot(t.kin.pos.x - det.c.x, t.kin.pos.y - det.c.y) + penalty });
      });
    }
    pairs.sort((a, b) => a.d - b.d);
    const usedDet = new Set<number>();
    for (const p of pairs) {
      if (assigned.has(p.t) || usedDet.has(p.i) || p.d > cfg.smoothing.matchDistance) continue;
      assigned.add(p.t);
      usedDet.add(p.i);
      this.observe(p.t, detections[p.i].f, detections[p.i].c, now, dt);
    }
    detections.forEach((det, i) => {
      if (usedDet.has(i)) return;
      const t = new HandTrack(this.nextId++, cfg);
      this.tracks.push(t);
      assigned.add(t);
      this.observe(t, det.f, det.c, now, dt);
    });
    // Lost hands fade out instead of snapping away.
    for (const t of this.tracks) {
      if (assigned.has(t)) continue;
      t.tracked = false;
      t.presence = clamp01(1 - (now - t.lastSeen) / cfg.smoothing.lostFadeMs);
      t.stormActive = false;
      t.pinching = false;
      t.freezeSince = null;
    }
    this.tracks = this.tracks.filter((t) => t.tracked || t.presence > 0);
    const live = this.tracks.filter((t) => t.tracked);

    // --- 3. Erase (hand covering the camera) --------------------------------
    this.updateErase(live, now, events, note, reject);
    const erasing = this.erase.active;

    // --- 4. Discrete gestures ------------------------------------------------
    const bothOpen =
      live.length === 2 &&
      live.every((t) => t.pose === 'open' && !t.pinching && now - t.poseSince >= cfg.stretch.stableMs);

    for (const t of live) {
      if (erasing) break;
      this.detectSnap(t, now, events, note, reject);
      this.detectReverse(t, now, events, note, reject);
      if (!bothOpen && !this.stretch.active) this.detectTear(t, now, events, note, reject);
      if (!bothOpen && !this.stretch.active) this.detectFreeze(t, now, events, note, reject);
    }

    // --- 5. Continuous states ------------------------------------------------
    const controls = emptyControls();

    // Stretch
    if (!erasing && bothOpen) {
      const [h1, h2] = live[0].kin.pos.x <= live[1].kin.pos.x ? [live[0], live[1]] : [live[1], live[0]];
      const d = Math.max(0.05, Math.hypot(h1.kin.pos.x - h2.kin.pos.x, h1.kin.pos.y - h2.kin.pos.y));
      if (!this.stretch.active) {
        this.stretch.active = true;
        this.stretch.initialDistance = d;
      }
      this.stretch.factor = clamp(d / this.stretch.initialDistance, cfg.stretch.minFactor, cfg.stretch.maxFactor);
      controls.stretch = {
        active: true,
        a: { ...h1.kin.pos },
        b: { ...h2.kin.pos },
        factor: this.stretch.factor,
      };
      note('STRETCH_REALITY', h1.id, 'active', this.confidence(h1, h1.features.openness, cfg.pose.openExit));
    } else {
      if (this.stretch.active) this.stretch.active = false;
      if (live.length === 2 && dbg) reject('STRETCH_REALITY', 0, 'both hands must be open and stable');
    }

    // Grab: the most confident stable, non-rising fist.
    if (!erasing && !controls.stretch.active) {
      let best: HandTrack | null = null;
      for (const t of this.tracks) {
        if (t.pose !== 'fist') continue;
        const held = now - t.poseSince;
        if (held < cfg.grab.stableMs) {
          reject('GRAB_GRAVITY', t.id, `fist held ${held.toFixed(0)}ms < ${cfg.grab.stableMs}ms`);
          continue;
        }
        if (now < t.grabSuppressedUntil) {
          reject('GRAB_GRAVITY', t.id, 'suppressed after punch');
          continue;
        }
        if (t.tracked && t.kin.vel.y > cfg.reverse.minUpSpeed * 0.6) {
          reject('GRAB_GRAVITY', t.id, 'rising fast: punch candidate');
          continue;
        }
        if (!best || t.presence * t.features.score > best.presence * best.features.score) best = t;
      }
      if (best) {
        const held = now - best.poseSince - cfg.grab.stableMs;
        const ramp = clamp01(held / cfg.grab.rampMs);
        controls.grab = {
          active: true,
          pos: { ...best.kin.pos },
          strength: (0.35 + 0.65 * ramp * ramp * (3 - 2 * ramp)) * best.presence,
        };
        note('GRAB_GRAVITY', best.id, 'active', this.confidence(best, best.features.curl, cfg.pose.fistExit));
      }
    }

    // Storm: open hand in motion. Momentum decays through the energy smoother.
    let stormHand: HandTrack | null = null;
    for (const t of this.tracks) {
      const eligible = t.tracked && !erasing && !controls.stretch.active && t.pose === 'open' && !t.pinching;
      if (eligible) {
        if (!t.stormActive && t.kin.speed >= cfg.storm.enterSpeed) t.stormActive = true;
        else if (t.stormActive && t.kin.speed < cfg.storm.exitSpeed) t.stormActive = false;
      } else {
        t.stormActive = false;
      }
      const target = t.stormActive ? clamp01(t.kin.speed / cfg.storm.energyFullSpeed) : 0;
      t.energy.update(target * t.presence, dt);
      const sp2 = t.kin.speed * t.kin.speed;
      const omega = sp2 > 0.04 ? (t.kin.vel.x * t.kin.acc.y - t.kin.vel.y * t.kin.acc.x) / sp2 : 0;
      t.vortex.update(t.stormActive ? clamp(omega / 8, -1, 1) * clamp01(t.kin.speed / 1.5) : 0, dt);
      if (t.energy.value > 0.01 && (!stormHand || t.energy.value > stormHand.energy.value)) stormHand = t;
    }
    if (stormHand) {
      const e = stormHand.energy.value;
      controls.storm = {
        active: e > 0.04,
        pos: { ...stormHand.kin.pos },
        vel: { x: stormHand.kin.vel.x * stormHand.presence, y: stormHand.kin.vel.y * stormHand.presence },
        energy: e,
        turbulence: clamp01(Math.hypot(stormHand.kin.acc.x, stormHand.kin.acc.y) / 30) * stormHand.presence,
        vortex: stormHand.vortex.value,
      };
      if (controls.storm.active) note('CONDUCT_STORM', stormHand.id, 'active', clamp01(e * 2));
    }

    controls.erase = erasing;
    controls.hands = this.tracks.map((t) => ({
      id: t.id,
      pos: { ...t.kin.pos },
      vel: { ...t.kin.vel },
      speed: t.kin.speed,
      pose: t.pose,
      pinching: t.pinching,
      presence: t.presence,
      score: t.features.score,
      tracked: t.tracked,
      openness: t.features.openness,
      palmSize: t.features.palmSize,
    }));

    // --- 6. Display gesture --------------------------------------------------
    for (const e of events) {
      const g = eventGesture(e);
      if (g) this.lastEvent = { gesture: g, at: now, confidence: 1 };
    }
    let gesture: GestureName = 'NONE';
    let confidence = 0;
    if (this.lastEvent && now - this.lastEvent.at < cfg.eventDisplayMs) {
      gesture = this.lastEvent.gesture;
      confidence = this.lastEvent.confidence;
    } else if (erasing) {
      gesture = 'ERASE_YOURSELF';
      confidence = 1;
    } else if (controls.stretch.active) {
      gesture = 'STRETCH_REALITY';
      confidence = this.avgScore(live);
    } else if (controls.grab.active) {
      gesture = 'GRAB_GRAVITY';
      confidence = clamp01(controls.grab.strength);
    } else if (controls.storm.active && controls.storm.energy > 0.12) {
      gesture = 'CONDUCT_STORM';
      confidence = clamp01(controls.storm.energy * 2);
    }

    return {
      time: now,
      gesture,
      confidence,
      events,
      controls,
      handCount: live.length,
      trackingConfidence: this.avgScore(live),
      debug: {
        hands: dbg
          ? this.tracks.map((t) => ({
              id: t.id,
              handedness: t.features.handedness,
              pose: t.pose,
              pinching: t.pinching,
              openness: t.features.openness,
              curl: t.features.curl,
              pinchDistance: t.features.pinchDistance,
              facing: t.features.facing,
              speed: t.kin.speed,
              vel: { ...t.kin.vel },
              bboxArea: t.features.bboxArea,
            }))
          : [],
        candidates,
      },
    };
  }

  // ---------------------------------------------------------------------------

  private observe(t: HandTrack, f: HandFeatures, c: Vec2, now: number, dt: number): void {
    const cfg = this.config;
    const jumped = t.kin.update(c.x, c.y, t.lastSeen === 0 ? 0 : dt);
    if (jumped) t.clearHistory();
    t.features = f;
    t.lastSeen = now;
    t.presence = 1;
    t.tracked = true;
    t.control = c;
    t.push(now, t.kin.pos.x, t.kin.pos.y);

    // Pose with hysteresis: entering a pose needs a stricter threshold than staying in it.
    const p = cfg.pose;
    let next: Pose = t.pose;
    if (t.pose === 'fist') {
      if (f.curl < p.fistExit) next = f.openness >= p.openEnter ? 'open' : 'neutral';
    } else if (t.pose === 'open') {
      if (f.openness < p.openExit) next = f.curl >= p.fistEnter ? 'fist' : 'neutral';
    } else {
      if (f.curl >= p.fistEnter) next = 'fist';
      else if (f.openness >= p.openEnter) next = 'open';
    }
    if (next !== t.pose || t.poseSince === 0) {
      t.pose = next;
      t.poseSince = now;
    }

    // Pinch with hysteresis; never while the hand is a fist (thumb rests on the index in a fist).
    const indexUp = f.extension[1] >= 0.15;
    if (!t.pinching) {
      if (f.pinchDistance < p.pinchEnter && t.pose !== 'fist' && indexUp && !t.pinchSpent) {
        t.pinching = true;
        t.pinchSince = now;
      }
      if (t.pinchSpent && f.pinchDistance > p.pinchExit) t.pinchSpent = false;
    }
  }

  private detectSnap(t: HandTrack, now: number, events: GestureEvent[], note: Note, reject: Reject): void {
    const cfg = this.config;
    if (!t.pinching) return;
    const f = t.features;
    const held = now - t.pinchSince;
    if (held > cfg.snap.maxHoldMs) {
      t.pinching = false;
      t.pinchSpent = true;
      reject('SNAP_UNIVERSE', t.id, `pinch held ${held.toFixed(0)}ms > ${cfg.snap.maxHoldMs}ms`);
      return;
    }
    if (f.pinchDistance <= cfg.pose.pinchExit) {
      note('SNAP_UNIVERSE', t.id, 'pending', 0.5, 'pinched: release to snap');
      return;
    }
    // Released.
    t.pinching = false;
    if (t.pose === 'fist') return reject('SNAP_UNIVERSE', t.id, 'released into a fist');
    if (held < cfg.snap.minHoldMs) return reject('SNAP_UNIVERSE', t.id, `pinch too brief (${held.toFixed(0)}ms)`);
    const cd = now - this.cooldowns.snap;
    if (cd < cfg.snap.cooldownMs) return reject('SNAP_UNIVERSE', t.id, `cooldown ${(cfg.snap.cooldownMs - cd).toFixed(0)}ms`);
    this.cooldowns.snap = now;
    events.push({ type: 'snap', origin: { ...t.kin.pos }, source: 'hand' });
    note('SNAP_UNIVERSE', t.id, 'fired', f.score);
  }

  private detectReverse(t: HandTrack, now: number, events: GestureEvent[], note: Note, reject: Reject): void {
    const cfg = this.config.reverse;
    if (t.pose !== 'fist') return;
    const vy = t.kin.vel.y;
    if (vy < cfg.minUpSpeed) {
      if (vy > cfg.minUpSpeed * 0.5) reject('REVERSE_GRAVITY', t.id, `upward speed ${vy.toFixed(2)} < ${cfg.minUpSpeed}`);
      return;
    }
    if (Math.abs(t.kin.vel.x) > cfg.maxHorizontalRatio * vy) return reject('REVERSE_GRAVITY', t.id, 'punch not vertical enough');
    if (now - t.poseSince < cfg.minFistMs) return reject('REVERSE_GRAVITY', t.id, 'fist not established before punch');
    let minY = Infinity;
    t.forEachSince(now - cfg.windowMs, (s) => {
      if (s.y < minY) minY = s.y;
    });
    const rise = t.kin.pos.y - minY;
    if (!(rise >= cfg.minRise)) return reject('REVERSE_GRAVITY', t.id, `rise ${rise.toFixed(2)} < ${cfg.minRise}`);
    const cd = now - this.cooldowns.reverse;
    if (cd < cfg.cooldownMs) return reject('REVERSE_GRAVITY', t.id, `cooldown ${(cfg.cooldownMs - cd).toFixed(0)}ms`);
    this.cooldowns.reverse = now;
    t.grabSuppressedUntil = now + this.config.grab.suppressAfterPunchMs;
    t.clearHistory();
    events.push({ type: 'reverse', origin: { ...t.kin.pos }, source: 'hand' });
    note('REVERSE_GRAVITY', t.id, 'fired', t.features.score);
  }

  private detectTear(t: HandTrack, now: number, events: GestureEvent[], note: Note, reject: Reject): void {
    const cfg = this.config.tear;
    if (t.pose !== 'open' || t.pinching) return;
    const speed = t.kin.speed;
    if (speed < cfg.minSpeed) {
      if (speed > cfg.minSpeed * 0.6) reject('TEAR_REALITY', t.id, `speed ${speed.toFixed(2)} < ${cfg.minSpeed}`);
      return;
    }
    let path = 0;
    let px = t.kin.pos.x;
    let py = t.kin.pos.y;
    let ox = px;
    let oy = py;
    t.forEachSince(now - cfg.windowMs, (s) => {
      path += Math.hypot(px - s.x, py - s.y);
      px = s.x;
      py = s.y;
      ox = s.x;
      oy = s.y;
    });
    const dx = t.kin.pos.x - ox;
    const dy = t.kin.pos.y - oy;
    const disp = Math.hypot(dx, dy);
    if (disp < 0.15) return reject('TEAR_REALITY', t.id, `swipe too short (${disp.toFixed(2)})`);
    const straightness = path > 1e-6 ? disp / path : 0;
    if (straightness < cfg.minStraightness)
      return reject('TEAR_REALITY', t.id, `trajectory curved (${straightness.toFixed(2)})`);
    const ux = dx / disp;
    const uy = dy / disp;
    const r = Math.hypot(ox, oy);
    if (r > 0.15) {
      const outward = (ux * ox + uy * oy) / r;
      if (outward < cfg.minOutward) return reject('TEAR_REALITY', t.id, `swipe moves inward (${outward.toFixed(2)})`);
    }
    const cd = now - this.cooldowns.tear;
    if (cd < cfg.cooldownMs) return reject('TEAR_REALITY', t.id, `cooldown ${(cfg.cooldownMs - cd).toFixed(0)}ms`);
    this.cooldowns.tear = now;
    events.push({ type: 'tear', origin: { x: ox, y: oy }, direction: { x: ux, y: uy }, speed, source: 'hand' });
    note('TEAR_REALITY', t.id, 'fired', t.features.score);
  }

  private detectFreeze(t: HandTrack, now: number, events: GestureEvent[], note: Note, reject: Reject): void {
    const cfg = this.config.freeze;
    const f = t.features;
    let reason = '';
    if (t.pose !== 'open') reason = 'hand not open';
    else if (t.pinching) reason = 'pinching';
    else if (f.openness < cfg.minOpenness) reason = `openness ${f.openness.toFixed(2)} < ${cfg.minOpenness}`;
    else if (f.facing < cfg.minFacing) reason = `palm not facing camera (${f.facing.toFixed(2)} < ${cfg.minFacing})`;
    else if (t.kin.speed > cfg.maxSpeed) reason = `moving (${t.kin.speed.toFixed(2)})`;
    else if (f.bboxArea >= this.config.erase.exitArea) reason = 'too close to the lens';

    if (reason) {
      t.freezeSince = null;
      if (!t.freezeArmed) {
        t.freezeBrokenSince ??= now;
        if (now - t.freezeBrokenSince > 250) t.freezeArmed = true;
      }
      if (t.pose === 'open' && !t.stormActive) reject('FREEZE_TIME', t.id, reason);
      return;
    }
    t.freezeBrokenSince = null;
    t.freezeSince ??= now;
    const held = now - t.freezeSince;
    if (!t.freezeArmed) return note('FREEZE_TIME', t.id, 'pending', 0.5, 'already fired: move hand to re-arm');
    if (held < cfg.stableMs) return note('FREEZE_TIME', t.id, 'pending', held / cfg.stableMs, `holding ${held.toFixed(0)}ms`);
    t.freezeArmed = false;
    events.push({ type: 'freeze', source: 'hand' });
    note('FREEZE_TIME', t.id, 'fired', f.score);
  }

  private updateErase(live: HandTrack[], now: number, events: GestureEvent[], note: Note, reject: Reject): void {
    const cfg = this.config.erase;
    const e = this.erase;
    let area = 0;
    for (const t of live) area = Math.max(area, t.features.bboxArea);

    if (live.length > 0) {
      e.activeNoHandSince = null;
      e.areaHistory.push({ t: now, area });
      while (e.areaHistory.length > 0 && now - e.areaHistory[0].t > 400) e.areaHistory.shift();
      if (!e.active) {
        if (area >= cfg.enterArea) {
          e.candidateSince ??= now;
          if (now - e.candidateSince >= cfg.stableMs) {
            e.active = true;
            e.occluded = false;
            e.exitSince = null;
            events.push({ type: 'eraseStart', source: 'hand' });
            note('ERASE_YOURSELF', live[0].id, 'fired', 1);
          } else note('ERASE_YOURSELF', live[0].id, 'pending', (now - e.candidateSince) / cfg.stableMs);
        } else {
          e.candidateSince = null;
          if (area > cfg.exitArea) reject('ERASE_YOURSELF', live[0].id, `hand area ${area.toFixed(2)} < ${cfg.enterArea}`);
        }
      } else {
        e.occluded = false;
        if (area < cfg.exitArea) {
          e.exitSince ??= now;
          if (now - e.exitSince >= cfg.exitMs) this.endErase(events);
        } else e.exitSince = null;
      }
      e.lastArea = area;
      return;
    }

    // No hands visible.
    if (e.active) {
      e.activeNoHandSince ??= now;
      if (now - e.activeNoHandSince >= cfg.occlusionMaxMs) this.endErase(events);
      return;
    }
    // The hand vanished. Only infer "covering the lens" when the preceding
    // tracked motion strongly supports it: large and approaching.
    const oldest = e.areaHistory[0];
    const approaching = oldest !== undefined && e.lastArea - oldest.area > 0.03;
    if (e.lastArea >= cfg.occlusionMinArea && approaching) {
      e.active = true;
      e.occluded = true;
      e.activeNoHandSince = now;
      events.push({ type: 'eraseStart', source: 'hand', occluded: true });
      note('ERASE_YOURSELF', 0, 'fired', 0.6, 'inferred from approach before tracking loss');
    }
    e.candidateSince = null;
    e.lastArea = 0;
    e.areaHistory.length = 0;
  }

  private endErase(events: GestureEvent[]): void {
    const e = this.erase;
    e.active = false;
    e.occluded = false;
    e.candidateSince = null;
    e.exitSince = null;
    e.activeNoHandSince = null;
    events.push({ type: 'eraseEnd', source: 'hand' });
  }

  private confidence(t: HandTrack, value: number, threshold: number): number {
    return clamp01(t.features.score * (0.6 + (value - threshold) * 2));
  }

  private avgScore(live: HandTrack[]): number {
    if (live.length === 0) return 0;
    let s = 0;
    for (const t of live) s += t.features.score;
    return s / live.length;
  }
}

type Note = (gesture: GestureName, hand: number, status: CandidateStatus, confidence: number, reason?: string) => void;
type Reject = (gesture: GestureName, hand: number, reason: string, confidence?: number) => void;

export function eventGesture(e: GestureEvent): GestureName | null {
  switch (e.type) {
    case 'tear':
      return 'TEAR_REALITY';
    case 'reverse':
      return 'REVERSE_GRAVITY';
    case 'snap':
      return 'SNAP_UNIVERSE';
    case 'freeze':
      return 'FREEZE_TIME';
    case 'eraseStart':
      return 'ERASE_YOURSELF';
    default:
      return null;
  }
}

export const GESTURE_INFO: Record<GestureName, { label: string; effect: string; how: string; key?: string }> = {
  NONE: { label: '—', effect: 'Reality is holding. For now.', how: '' },
  GRAB_GRAVITY: {
    label: 'GRAB GRAVITY',
    effect: 'A gravity well follows your fist.',
    how: 'Close one hand into a fist and move it.',
    key: 'G / hold mouse',
  },
  STRETCH_REALITY: {
    label: 'STRETCH REALITY',
    effect: 'Space stretches between your palms.',
    how: 'Two open hands, then pull apart or push together.',
    key: 'X + move mouse',
  },
  TEAR_REALITY: {
    label: 'TEAR REALITY',
    effect: 'A fissure opens along your swipe.',
    how: 'Fast, straight outward swipe with an open hand.',
    key: 'T',
  },
  REVERSE_GRAVITY: {
    label: 'REVERSE GRAVITY',
    effect: 'Everything falls upward.',
    how: 'Punch upward with a fist.',
    key: 'R',
  },
  CONDUCT_STORM: {
    label: 'CONDUCT A STORM',
    effect: 'Your motion becomes wind and vortex.',
    how: 'Wave an open hand. Circle it for a vortex.',
    key: 'move mouse',
  },
  SNAP_UNIVERSE: {
    label: 'SNAP THE UNIVERSE',
    effect: 'Collapse into a singularity, re-form anew.',
    how: 'Pinch thumb and index, then release.',
    key: 'S',
  },
  FREEZE_TIME: {
    label: 'FREEZE TIME',
    effect: 'The simulation holds its breath.',
    how: 'Hold a flat palm toward the camera. Swipe to resume.',
    key: 'F',
  },
  ERASE_YOURSELF: {
    label: 'ERASE YOURSELF',
    effect: 'Colour drains; the world inverts.',
    how: 'Cover the camera with your open hand.',
    key: 'E',
  },
};
