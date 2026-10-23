/**
 * Explicit application state machine.
 *
 *   landing ──ENTER──▶ activating ──CAMERA_READY──▶ calibrating ──HAND_STABLE──▶ active
 *      ▲                  │  ▲                         │                          │ ▲
 *      │           CAMERA_ERROR│RETRY            SKIP_CALIBRATION                 │ │
 *      │                  ▼  │                         ▼                   BREACH │ │ BREACH_END
 *      │                 error ──ENTER_FALLBACK──▶ active (input: fallback)       ▼ │
 *      │                                                                         breach
 *      └──────────────────────────── EXIT (from any state) ◀── frozen ◀─FREEZE── active/breach
 *
 * `input` records whether hands or mouse/keyboard drive the simulation.
 * `breach` is a transient major event; `frozen` halts the simulation while
 * tracking keeps running.
 */

export type Phase = 'landing' | 'activating' | 'error' | 'calibrating' | 'active' | 'breach' | 'frozen';
export type InputMode = 'none' | 'camera' | 'fallback';
export type CameraErrorKind =
  | 'permission-denied'
  | 'unavailable'
  | 'insecure-context'
  | 'model-failed'
  | 'unknown';
export type BreachKind = 'tear' | 'reverse' | 'snap';

export interface MachineState {
  phase: Phase;
  input: InputMode;
  error: CameraErrorKind | null;
  breach: BreachKind | null;
  /** Hands were being tracked and have been lost for a while. */
  trackingLost: boolean;
  /** Calibration has seen no hand for a while. */
  noHandHint: boolean;
}

export type MachineEvent =
  | { type: 'ENTER' }
  | { type: 'ENTER_FALLBACK' }
  | { type: 'CAMERA_READY' }
  | { type: 'CAMERA_ERROR'; error: CameraErrorKind }
  | { type: 'RETRY' }
  | { type: 'NO_HAND_TIMEOUT' }
  | { type: 'HAND_STABLE' }
  | { type: 'SKIP_CALIBRATION' }
  | { type: 'TRACKING_LOST' }
  | { type: 'TRACKING_FOUND' }
  | { type: 'BREACH'; kind: BreachKind }
  | { type: 'BREACH_END' }
  | { type: 'FREEZE' }
  | { type: 'RESUME' }
  | { type: 'CAMERA_DISABLE' }
  | { type: 'EXIT' };

export const initialMachineState: MachineState = {
  phase: 'landing',
  input: 'none',
  error: null,
  breach: null,
  trackingLost: false,
  noHandHint: false,
};

const inSimulation = (p: Phase) => p === 'active' || p === 'breach' || p === 'frozen';

export function transition(state: MachineState, event: MachineEvent): MachineState {
  const s = state;
  switch (event.type) {
    case 'ENTER':
      // Entering (or re-enabling the camera from fallback mode).
      if (s.phase === 'landing' || (inSimulation(s.phase) && s.input === 'fallback'))
        return { ...initialMachineState, phase: 'activating', input: 'camera' };
      return s;
    case 'ENTER_FALLBACK':
      if (s.phase === 'landing' || s.phase === 'error' || s.phase === 'activating' || s.phase === 'calibrating')
        return { ...initialMachineState, phase: 'active', input: 'fallback' };
      return s;
    case 'CAMERA_READY':
      return s.phase === 'activating' ? { ...s, phase: 'calibrating', error: null, noHandHint: false } : s;
    case 'CAMERA_ERROR':
      return s.phase === 'activating' || s.phase === 'calibrating'
        ? { ...s, phase: 'error', error: event.error, input: 'none' }
        : s;
    case 'RETRY':
      return s.phase === 'error' ? { ...s, phase: 'activating', error: null, input: 'camera' } : s;
    case 'NO_HAND_TIMEOUT':
      return s.phase === 'calibrating' ? { ...s, noHandHint: true } : s;
    case 'HAND_STABLE':
    case 'SKIP_CALIBRATION':
      return s.phase === 'calibrating' ? { ...s, phase: 'active', noHandHint: false } : s;
    case 'TRACKING_LOST':
      return inSimulation(s.phase) && s.input === 'camera' && !s.trackingLost ? { ...s, trackingLost: true } : s;
    case 'TRACKING_FOUND':
      return s.trackingLost ? { ...s, trackingLost: false } : s;
    case 'BREACH':
      // A transformation from a frozen world resumes time.
      return inSimulation(s.phase) ? { ...s, phase: 'breach', breach: event.kind } : s;
    case 'BREACH_END':
      return s.phase === 'breach' ? { ...s, phase: 'active', breach: null } : s;
    case 'FREEZE':
      return s.phase === 'active' || s.phase === 'breach' ? { ...s, phase: 'frozen', breach: null } : s;
    case 'RESUME':
      return s.phase === 'frozen' ? { ...s, phase: 'active' } : s;
    case 'CAMERA_DISABLE':
      if (inSimulation(s.phase) || s.phase === 'calibrating' || s.phase === 'activating')
        return { ...s, phase: inSimulation(s.phase) ? s.phase : 'active', input: 'fallback', trackingLost: false };
      return s;
    case 'EXIT':
      return initialMachineState;
  }
}

/** Whether the simulation integrates time in this phase. */
export const isSimulating = (s: MachineState) => s.phase !== 'frozen';
/** Whether the camera stream should be live. */
export const wantsCamera = (s: MachineState) =>
  s.input === 'camera' && (s.phase === 'activating' || s.phase === 'calibrating' || inSimulation(s.phase));
export const isInSimulation = (s: MachineState) => inSimulation(s.phase);
