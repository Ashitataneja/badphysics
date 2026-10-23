import { AudioController } from '../audio/AudioController';
import type { CameraManager } from '../camera/CameraManager';
import {
  GestureEngine,
  type ControlState,
  type GestureEvent,
  type GestureFrame,
  type GestureName,
  eventGesture,
} from '../camera/gestureClassifier';
import { defaultGestureConfig } from '../camera/gestureConfig';
import type { HandTracker } from '../camera/HandTracker';
import type { RawHand } from '../camera/landmarkFeatures';
import { SNAP_COLLAPSE } from '../scene/PhysicsController';
import { detectTier, SceneManager } from '../scene/SceneManager';
import { PerformanceMonitor } from '../utils/performanceMonitor';
import { FallbackInput, type ShortcutAction } from './fallbackInput';
import type { BreachKind } from './interactionMachine';
import { useStore, type QualityTier, type Settings } from './state';

const BREACH_MS: Record<BreachKind, number> = { tear: 1500, reverse: 3800, snap: 1800 };
const CALIBRATION_STABLE_MS = 800;
const NO_HAND_HINT_MS = 7000;
const TRACKING_LOST_MS = 1500;

const CUES: Partial<Record<GestureEvent['type'], string>> = {
  tear: 'REALITY TORN.',
  reverse: 'GRAVITY REVERSED.',
  snap: 'UNIVERSE RESET.',
  freeze: 'TIME FROZEN.',
  resume: 'TIME RESUMED.',
  eraseStart: 'SELF ERASED.',
  eraseEnd: 'YOU RETURN.',
};

const CONTINUOUS_CUES: Partial<Record<GestureName, string>> = {
  GRAB_GRAVITY: 'GRAVITY BENT.',
  STRETCH_REALITY: 'SPACE STRETCHED.',
  CONDUCT_STORM: 'STORM CONDUCTED.',
};

/** MediaPipe hand skeleton connections (landmark index pairs). */
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export type OverlayMode = 'calibration' | 'pip';

/**
 * Orchestrates one running experience: owns the single requestAnimationFrame
 * loop and wires tracking → gesture engine → simulation → audio → render.
 * Hand detection is scheduled inside the same loop, after rendering, so a
 * slow inference frame never delays the frame already being drawn.
 */
export class Experience {
  readonly scene: SceneManager;
  readonly audio = new AudioController();
  readonly engine: GestureEngine;
  private readonly input: FallbackInput;
  private readonly perf = new PerformanceMonitor(120);
  private camera: CameraManager | null = null;
  private tracker: HandTracker | null = null;
  private raf = 0;
  private running = false;
  private last = 0;
  private lastDetect = 0;
  private extraDetectInterval = 0;
  private handFrame: GestureFrame | null = null;
  private lastHands: RawHand[] = [];
  private overlay: { canvas: HTMLCanvasElement; mode: OverlayMode } | null = null;
  private lastUiUpdate = 0;
  private lastAdapt = 0;
  private degradeStep = 0;
  private breachUntil = 0;
  private calibStableSince: number | null = null;
  private calibStart = 0;
  private lastHandSeen = 0;
  private lastCueAt: Record<string, number> = {};
  private prevContinuous: GestureName = 'NONE';
  private eventDisplay: { gesture: GestureName; until: number } | null = null;
  private readonly unsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    const s = useStore.getState();
    const tier: QualityTier = s.settings.quality === 'auto' ? detectTier() : s.settings.quality;
    this.scene = new SceneManager(container, tier);
    const err = this.scene.precompile();
    if (err) console.warn('[BAD PHYSICS] continuing despite shader warnings');

    const cfg = defaultGestureConfig();
    this.engine = new GestureEngine(cfg, { aspect: 16 / 9 });
    this.input = new FallbackInput(
      this.scene.renderer.domElement.parentElement ?? container,
      () => this.scene.physics.frozen,
      (a) => this.onShortcut(a),
    );
    this.applySettings(s.settings);

    this.unsubscribe = useStore.subscribe((state, prev) => {
      if (state.settings !== prev.settings) this.applySettings(state.settings, prev.settings);
      if (state.machine.phase !== prev.machine.phase) this.onPhase(state.machine.phase, prev.machine.phase);
    });

    this.resizeObserver = new ResizeObserver(() => this.scene.resize());
    this.resizeObserver.observe(container);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Call from the ENTER click so audio starts within a user gesture. */
  async unlockAudio(): Promise<void> {
    try {
      await this.audio.init();
      const s = useStore.getState().settings;
      this.audio.setVolume(s.volume);
      this.audio.setMuted(s.muted);
    } catch (err) {
      console.warn('[BAD PHYSICS] audio unavailable', err);
    }
  }

  attachCamera(camera: CameraManager, tracker: HandTracker): void {
    this.camera = camera;
    this.tracker = tracker;
    this.engine.aspect = camera.aspect;
    this.engine.reset();
    this.handFrame = null;
    this.calibStart = performance.now();
    this.calibStableSince = null;
    this.lastHandSeen = performance.now();
  }

  detachCamera(): void {
    this.camera = null;
    this.tracker = null;
    this.handFrame = null;
    this.lastHands = [];
    this.engine.reset();
    this.clearOverlay();
  }

  setOverlay(canvas: HTMLCanvasElement | null, mode: OverlayMode): void {
    if (!canvas) {
      if (this.overlay?.mode === mode) this.overlay = null;
      return;
    }
    this.overlay = { canvas, mode };
  }

  private clearOverlay(): void {
    const c = this.overlay?.canvas;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }

  // ---------------------------------------------------------------------------

  private tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const realDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.perf.frame(realDt * 1000, now);

    const store = useStore.getState();
    const machine = store.machine;
    const inSim = machine.phase === 'active' || machine.phase === 'breach' || machine.phase === 'frozen';

    // 1. Merge inputs.
    this.input.enabled = inSim;
    const fb = this.input.sample(now);
    const hand = this.handFrame;
    const handsPresent = !!hand && hand.controls.hands.length > 0;
    const controls = this.merge(hand?.controls ?? null, fb.controls, handsPresent);
    const events = [...(hand?.events ?? []), ...fb.events];
    if (hand) this.handFrame = { ...hand, events: [] };

    // 2. Events (only while in the simulation).
    if (inSim) for (const e of events) this.handleEvent(e);
    if (machine.phase === 'breach' && now > this.breachUntil) store.dispatch({ type: 'BREACH_END' });

    // 3. Simulation + camera + render.
    const sim = this.scene.sim;
    if (inSim) sim.applyControls(controls);
    else sim.applyControls(EMPTY_CONTROLS);
    const p = this.input.pointerPosition;
    this.scene.cameraCtl.setPointer(inSim ? p.x * 0.3 : p.x, inSim ? p.y * 0.3 : p.y);
    sim.update(realDt, this.scene.drawingViewport);
    const focus = sim.hands[0]?.pos ?? null;
    this.scene.cameraCtl.update(realDt, this.scene.physics, focus, sim.hands[0]?.presence ?? 0);
    this.scene.render();

    // 4. Audio follows actual physical parameters.
    const P = this.scene.physics;
    this.audio.update({
      grab: P.well.strength,
      proximity: P.well.proximity,
      grabPan: controls.grab.pos.x,
      stretchAmount: P.stretch.amount,
      stretchFactor: P.stretch.factor,
      stormEnergy: P.storm.energy,
      stormPan: controls.storm.pos.x,
      turbulence: P.storm.turbulence,
      reverse: P.reverse,
      frozen: P.frozen,
      erase: P.erase,
      ambience: inSim ? 1 : 0.5,
    });

    // 5. Continuous-gesture cues.
    if (inSim) this.continuousCues(controls, now);

    // 6. Hand detection, after the frame has been submitted.
    this.detect(now, machine.phase);

    // 7. Throttled UI updates.
    if (now - this.lastUiUpdate > 100) {
      this.lastUiUpdate = now;
      this.updateUi(controls, handsPresent);
    }
    if (now - this.lastAdapt > 2000) {
      this.lastAdapt = now;
      this.adaptQuality();
    }
  };

  private merge(hand: ControlState | null, fb: ControlState, handsPresent: boolean): ControlState {
    if (!hand) return fb;
    const out: ControlState = { ...hand };
    if (!hand.grab.active && fb.grab.active) out.grab = fb.grab;
    if (!hand.stretch.active && fb.stretch.active) out.stretch = fb.stretch;
    if (fb.storm.energy > hand.storm.energy && !handsPresent) out.storm = fb.storm;
    out.erase = hand.erase || fb.erase;
    return out;
  }

  private detect(now: number, phase: string): void {
    const cam = this.camera;
    const tracker = this.tracker;
    if (!cam || !tracker || !cam.active) return;
    if (phase !== 'calibrating' && phase !== 'active' && phase !== 'breach' && phase !== 'frozen') return;
    const interval = this.scene.config.detectIntervalMs + this.extraDetectInterval;
    if (now - this.lastDetect < interval || !tracker.hasNewFrame(cam.video)) return;
    this.lastDetect = now;
    let result;
    try {
      result = tracker.detect(cam.video, now);
    } catch (err) {
      console.error('[BAD PHYSICS] detection failed', err);
      return;
    }
    if (!result) return;
    this.perf.recordDetection(result.elapsed);
    // Slow inference: back off detection frequency so rendering stays smooth.
    if (this.perf.detectMs > 28) this.extraDetectInterval = Math.min(100, this.extraDetectInterval + 8);
    else if (this.perf.detectMs < 14) this.extraDetectInterval = Math.max(0, this.extraDetectInterval - 4);

    this.lastHands = result.hands;
    this.engine.aspect = cam.aspect;
    const frame = this.engine.update(result.hands, now);
    // Keep any events not yet consumed by the render loop.
    const pending = this.handFrame?.events ?? [];
    this.handFrame = pending.length ? { ...frame, events: [...pending, ...frame.events] } : frame;

    const store = useStore.getState();
    const machine = store.machine;
    if (frame.handCount > 0) this.lastHandSeen = now;
    if (machine.phase === 'calibrating') {
      if (frame.handCount > 0) {
        this.calibStableSince ??= now;
        if (now - this.calibStableSince >= CALIBRATION_STABLE_MS) store.dispatch({ type: 'HAND_STABLE' });
      } else {
        this.calibStableSince = null;
        if (now - this.calibStart > NO_HAND_HINT_MS && !machine.noHandHint) store.dispatch({ type: 'NO_HAND_TIMEOUT' });
      }
    } else if (machine.input === 'camera') {
      if (frame.handCount === 0 && now - this.lastHandSeen > TRACKING_LOST_MS && !machine.trackingLost)
        store.dispatch({ type: 'TRACKING_LOST' });
      else if (frame.handCount > 0 && machine.trackingLost) store.dispatch({ type: 'TRACKING_FOUND' });
    }
    this.drawOverlay();
  }

  private drawOverlay(): void {
    const o = this.overlay;
    const cam = this.camera;
    if (!o || !cam) return;
    const c = o.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    // The video element uses object-fit: cover; match its crop.
    const vw = cam.video.videoWidth || 16;
    const vh = cam.video.videoHeight || 9;
    const scale = Math.max(w / vw, h / vh);
    const ox = (w - vw * scale) / 2;
    const oy = (h - vh * scale) / 2;
    const X = (x: number) => ox + x * vw * scale;
    const Y = (y: number) => oy + y * vh * scale;
    const skeleton = o.mode === 'calibration' || useStore.getState().settings.debug;
    for (const hnd of this.lastHands) {
      const lm = hnd.landmarks;
      if (skeleton) {
        g.strokeStyle = 'rgba(233, 228, 216, 0.75)';
        g.lineWidth = o.mode === 'calibration' ? 2 : 1;
        g.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          g.moveTo(X(lm[a].x), Y(lm[a].y));
          g.lineTo(X(lm[b].x), Y(lm[b].y));
        }
        g.stroke();
        g.fillStyle = '#c6f432';
        for (const p of lm) {
          g.beginPath();
          g.arc(X(p.x), Y(p.y), o.mode === 'calibration' ? 3 : 1.5, 0, Math.PI * 2);
          g.fill();
        }
      } else {
        const p = lm[9];
        g.strokeStyle = 'rgba(233, 228, 216, 0.85)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(X(p.x), Y(p.y), 6, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  private handleEvent(e: GestureEvent): void {
    const store = useStore.getState();
    const sim = this.scene.sim;
    const wasFrozen = this.scene.physics.frozen;
    const major = e.type === 'tear' || e.type === 'reverse' || e.type === 'snap';
    // A transformation performed in frozen time shatters the freeze.
    if (major && wasFrozen) {
      sim.setFrozen(false);
      this.audio.play('resume');
    }
    const outcome = sim.handleEvent(e);
    if (!outcome.accepted) return;
    const reduced = store.settings.reducedFlash;
    switch (e.type) {
      case 'tear':
      case 'reverse':
      case 'snap':
        store.dispatch({ type: 'BREACH', kind: e.type });
        this.breachUntil = performance.now() + BREACH_MS[e.type];
        if (reduced) this.scene.physics.flash = 0;
        this.audio.play(e.type, outcome.pan, SNAP_COLLAPSE);
        break;
      case 'freeze':
        store.dispatch({ type: 'FREEZE' });
        this.audio.play('freeze');
        break;
      case 'resume':
        store.dispatch({ type: 'RESUME' });
        this.audio.play('resume');
        break;
      case 'eraseStart':
      case 'eraseEnd':
        this.audio.play(e.type);
        break;
    }
    const shown = eventGesture(e);
    if (shown) this.eventDisplay = { gesture: shown, until: performance.now() + 1400 };
    const cue = CUES[e.type];
    if (cue) store.showCue(cue);
  }

  private continuousCues(c: ControlState, now: number): void {
    const current: GestureName = c.stretch.active
      ? 'STRETCH_REALITY'
      : c.grab.active
        ? 'GRAB_GRAVITY'
        : c.storm.active && c.storm.energy > 0.2
          ? 'CONDUCT_STORM'
          : 'NONE';
    if (current !== this.prevContinuous && current !== 'NONE') {
      const cue = CONTINUOUS_CUES[current];
      if (cue && now - (this.lastCueAt[current] ?? -Infinity) > 5000) {
        this.lastCueAt[current] = now;
        useStore.getState().showCue(cue);
        this.audio.engage(current === 'GRAB_GRAVITY' ? 110 : current === 'STRETCH_REALITY' ? 330 : 220, c.grab.pos.x * 0.5);
      }
    }
    this.prevContinuous = current;
  }

  private updateUi(controls: ControlState, handsPresent: boolean): void {
    const store = useStore.getState();
    const f = this.handFrame;
    const P = this.scene.physics;
    let gesture: GestureName = f && handsPresent ? f.gesture : 'NONE';
    let confidence = f && handsPresent ? f.confidence : 0;
    if (gesture === 'NONE') {
      // Fallback-driven or decaying states still deserve a label.
      if (P.erase > 0.5) gesture = 'ERASE_YOURSELF';
      else if (controls.stretch.active) gesture = 'STRETCH_REALITY';
      else if (controls.grab.active) gesture = 'GRAB_GRAVITY';
      else if (controls.storm.active && controls.storm.energy > 0.12) gesture = 'CONDUCT_STORM';
      confidence = gesture === 'NONE' ? 0 : 1;
    }
    if (this.eventDisplay && performance.now() < this.eventDisplay.until) {
      gesture = this.eventDisplay.gesture;
      confidence = 1;
    }
    store.setHud({
      gesture,
      confidence,
      trackingConfidence: f && handsPresent ? f.trackingConfidence : 0,
      handCount: f?.handCount ?? 0,
    });
    if (store.settings.showPerf)
      store.setPerf({
        fps: this.perf.fps,
        frameMs: this.perf.frameMs,
        detectMs: this.camera ? this.perf.detectMs : 0,
        particles: this.scene.particles.activeCount,
        hands: f?.handCount ?? 0,
        tier: this.scene.tier,
      });
    if (store.settings.debug && f) store.setDebug({ hands: f.debug.hands, candidates: f.debug.candidates });
  }

  /** Frame-time driven degradation (auto quality only). */
  private adaptQuality(): void {
    const s = useStore.getState().settings;
    if (s.quality !== 'auto' || !this.perf.filled) return;
    const avg = this.perf.average();
    if (avg > 22 && this.degradeStep < 4) {
      this.degradeStep++;
    } else if (avg < 12.5 && this.degradeStep > 0) {
      this.degradeStep--;
    } else return;
    const steps = [
      { particles: 1, dpr: 1 },
      { particles: 0.7, dpr: 1 },
      { particles: 0.5, dpr: 0.85 },
      { particles: 0.35, dpr: 0.7 },
    ];
    if (this.degradeStep === 4) {
      const next: QualityTier | null = this.scene.tier === 'high' ? 'medium' : this.scene.tier === 'medium' ? 'low' : null;
      if (next) {
        this.scene.setTier(next);
        this.degradeStep = 0;
      } else this.degradeStep = 3;
    }
    const st = steps[Math.min(this.degradeStep, 3)];
    this.scene.particles.setActiveFraction(st.particles);
    this.scene.setDprScale(st.dpr);
    this.perf.reset();
  }

  private applySettings(s: Settings, prev?: Settings): void {
    const cfg = this.engine.config;
    cfg.mapping.sensitivity = s.sensitivity;
    cfg.mapping.invertY = s.invertY;
    cfg.mapping.mirror = s.mirror;
    this.engine.debugEnabled = s.debug;
    this.scene.cameraCtl.reducedMotion = s.reducedMotion;
    this.scene.reducedFlash = s.reducedFlash;
    const P = this.scene.physics.params;
    P.deformation = s.reducedMotion ? 0.55 : 1;
    P.timeDilation = s.reducedMotion ? 0.35 : 0.7;
    this.audio.setVolume(s.volume);
    this.audio.setMuted(s.muted);
    if (prev && prev.quality !== s.quality) {
      const tier = s.quality === 'auto' ? detectTier() : s.quality;
      this.degradeStep = 0;
      this.scene.setTier(tier);
      this.scene.particles.setActiveFraction(1);
      this.perf.reset();
    }
  }

  private onPhase(phase: string, prev: string): void {
    const P = this.scene.physics;
    if (phase === 'frozen') P.frozen = true;
    else if (prev === 'frozen' && P.frozen) P.frozen = false;
    if (phase === 'landing') {
      // Exit: return the world to a dormant state without a jump.
      this.input.reset();
      P.frozen = false;
      P.eraseTarget = 0;
      // Close the audio context; ENTER creates a fresh one from its click.
      if (prev !== 'landing') void this.audio.dispose();
    }
  }

  private onShortcut(a: ShortcutAction): void {
    const store = useStore.getState();
    const s = store.settings;
    switch (a) {
      case 'mute':
        store.setSettings({ muted: !s.muted });
        break;
      case 'exit':
        if (store.machine.phase !== 'landing') store.dispatch({ type: 'EXIT' });
        break;
      case 'debug':
        store.setSettings({ debug: !s.debug });
        break;
      case 'perf':
        store.setSettings({ showPerf: !s.showPerf });
        break;
      case 'legend':
        store.setSettings({ showLegend: !s.showLegend });
        break;
    }
  }

  private onVisibility = () => {
    if (document.hidden) void this.audio.suspend();
    else {
      void this.audio.resume();
      this.last = performance.now();
    }
  };

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.detachCamera();
    void this.audio.dispose();
    this.scene.dispose();
  }
}

const EMPTY_CONTROLS: ControlState = {
  hands: [],
  grab: { active: false, pos: { x: 0, y: 0 }, strength: 0 },
  stretch: { active: false, a: { x: -0.5, y: 0 }, b: { x: 0.5, y: 0 }, factor: 1 },
  storm: { active: false, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, energy: 0, turbulence: 0, vortex: 0 },
  erase: false,
};
