import { create } from 'zustand';
import type { GestureCandidate, GestureName, HandDebug } from '../camera/gestureClassifier';
import { initialMachineState, transition, type MachineEvent, type MachineState } from './interactionMachine';

export type QualityTier = 'high' | 'medium' | 'low';
export type QualitySetting = 'auto' | QualityTier;

export interface Settings {
  muted: boolean;
  volume: number;
  reducedMotion: boolean;
  reducedFlash: boolean;
  sensitivity: number;
  quality: QualitySetting;
  invertY: boolean;
  mirror: boolean;
  showLegend: boolean;
  showPip: boolean;
  debug: boolean;
  showPerf: boolean;
  discovery: boolean;
}

export interface HudData {
  gesture: GestureName;
  confidence: number;
  trackingConfidence: number;
  handCount: number;
}

export interface PerfData {
  fps: number;
  frameMs: number;
  detectMs: number;
  particles: number;
  hands: number;
  tier: QualityTier;
}

export interface DebugData {
  hands: HandDebug[];
  candidates: GestureCandidate[];
}

export interface Cue {
  id: number;
  text: string;
}

interface Store {
  machine: MachineState;
  dispatch: (e: MachineEvent) => void;
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;
  hud: HudData;
  setHud: (h: HudData) => void;
  perf: PerfData;
  setPerf: (p: PerfData) => void;
  debug: DebugData;
  setDebug: (d: DebugData) => void;
  cue: Cue | null;
  showCue: (text: string) => void;
  /** Bumped to ask the camera hook to tear down and re-initialise. */
  cameraAttempt: number;
  retryCamera: () => void;
}

const prefersReducedMotion = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const SETTINGS_KEY = 'bad-physics:settings';

function loadSettings(): Settings {
  const defaults: Settings = {
    muted: false,
    volume: 0.7,
    reducedMotion: prefersReducedMotion(),
    reducedFlash: prefersReducedMotion(),
    sensitivity: 1,
    quality: 'auto',
    invertY: false,
    mirror: true,
    showLegend: true,
    showPip: true,
    debug: false,
    showPerf: false,
    discovery: false,
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<Settings>;
    // Transient panels never persist.
    return { ...defaults, ...saved, discovery: false, debug: false };
  } catch {
    return defaults;
  }
}

let cueId = 0;

export const useStore = create<Store>((set, get) => ({
  machine: initialMachineState,
  dispatch: (e) => {
    const next = transition(get().machine, e);
    if (next !== get().machine) set({ machine: next });
  },
  settings: loadSettings(),
  setSettings: (s) => {
    const settings = { ...get().settings, ...s };
    set({ settings });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings live for this session only */
    }
  },
  hud: { gesture: 'NONE', confidence: 0, trackingConfidence: 0, handCount: 0 },
  setHud: (hud) => {
    const h = get().hud;
    if (
      h.gesture !== hud.gesture ||
      h.handCount !== hud.handCount ||
      Math.abs(h.confidence - hud.confidence) > 0.04 ||
      Math.abs(h.trackingConfidence - hud.trackingConfidence) > 0.04
    )
      set({ hud });
  },
  perf: { fps: 0, frameMs: 0, detectMs: 0, particles: 0, hands: 0, tier: 'medium' },
  setPerf: (perf) => set({ perf }),
  debug: { hands: [], candidates: [] },
  setDebug: (debug) => set({ debug }),
  cue: null,
  showCue: (text) => set({ cue: { id: ++cueId, text } }),
  cameraAttempt: 0,
  retryCamera: () => set({ cameraAttempt: get().cameraAttempt + 1 }),
}));
