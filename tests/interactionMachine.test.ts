import { describe, expect, it } from 'vitest';
import {
  initialMachineState,
  isSimulating,
  transition,
  wantsCamera,
  type MachineEvent,
  type MachineState,
} from '../src/app/interactionMachine';

const run = (events: MachineEvent[], from: MachineState = initialMachineState) => events.reduce(transition, from);

describe('interaction state machine', () => {
  it('starts on the landing screen without the camera', () => {
    expect(initialMachineState.phase).toBe('landing');
    expect(wantsCamera(initialMachineState)).toBe(false);
  });

  it('only requests the camera after ENTER', () => {
    const s = run([{ type: 'ENTER' }]);
    expect(s.phase).toBe('activating');
    expect(wantsCamera(s)).toBe(true);
  });

  it('walks the happy path to the active simulation', () => {
    const s = run([{ type: 'ENTER' }, { type: 'CAMERA_READY' }, { type: 'HAND_STABLE' }]);
    expect(s.phase).toBe('active');
    expect(s.input).toBe('camera');
  });

  it('ignores HAND_STABLE before the camera is ready', () => {
    expect(run([{ type: 'ENTER' }, { type: 'HAND_STABLE' }]).phase).toBe('activating');
  });

  it('handles camera errors with retry and fallback', () => {
    const err = run([{ type: 'ENTER' }, { type: 'CAMERA_ERROR', error: 'permission-denied' }]);
    expect(err.phase).toBe('error');
    expect(err.error).toBe('permission-denied');
    expect(wantsCamera(err)).toBe(false);
    const retry = transition(err, { type: 'RETRY' });
    expect(retry.phase).toBe('activating');
    expect(retry.error).toBeNull();
    const fallback = transition(err, { type: 'ENTER_FALLBACK' });
    expect(fallback.phase).toBe('active');
    expect(fallback.input).toBe('fallback');
  });

  it('flags a calibration hint when no hand is seen', () => {
    const s = run([{ type: 'ENTER' }, { type: 'CAMERA_READY' }, { type: 'NO_HAND_TIMEOUT' }]);
    expect(s.noHandHint).toBe(true);
    expect(transition(s, { type: 'HAND_STABLE' }).noHandHint).toBe(false);
  });

  it('enters and leaves a reality breach', () => {
    const active = run([{ type: 'ENTER_FALLBACK' }]);
    const breach = transition(active, { type: 'BREACH', kind: 'reverse' });
    expect(breach.phase).toBe('breach');
    expect(breach.breach).toBe('reverse');
    expect(isSimulating(breach)).toBe(true);
    expect(transition(breach, { type: 'BREACH_END' }).phase).toBe('active');
  });

  it('freezes, keeps the camera live, and resumes', () => {
    const active = run([{ type: 'ENTER' }, { type: 'CAMERA_READY' }, { type: 'HAND_STABLE' }]);
    const frozen = transition(active, { type: 'FREEZE' });
    expect(frozen.phase).toBe('frozen');
    expect(isSimulating(frozen)).toBe(false);
    expect(wantsCamera(frozen)).toBe(true);
    expect(transition(frozen, { type: 'RESUME' }).phase).toBe('active');
  });

  it('a transformation while frozen resumes into a breach', () => {
    const frozen = run([{ type: 'ENTER_FALLBACK' }, { type: 'FREEZE' }]);
    const s = transition(frozen, { type: 'BREACH', kind: 'snap' });
    expect(s.phase).toBe('breach');
    expect(isSimulating(s)).toBe(true);
  });

  it('a breach that ends after a freeze does not unfreeze', () => {
    const s = run([{ type: 'ENTER_FALLBACK' }, { type: 'BREACH', kind: 'tear' }, { type: 'FREEZE' }, { type: 'BREACH_END' }]);
    expect(s.phase).toBe('frozen');
  });

  it('tracks loss of hands only in camera mode', () => {
    const cam = run([{ type: 'ENTER' }, { type: 'CAMERA_READY' }, { type: 'HAND_STABLE' }, { type: 'TRACKING_LOST' }]);
    expect(cam.trackingLost).toBe(true);
    expect(transition(cam, { type: 'TRACKING_FOUND' }).trackingLost).toBe(false);
    const fb = run([{ type: 'ENTER_FALLBACK' }, { type: 'TRACKING_LOST' }]);
    expect(fb.trackingLost).toBe(false);
  });

  it('can disable the camera mid-session and re-enable it', () => {
    const active = run([{ type: 'ENTER' }, { type: 'CAMERA_READY' }, { type: 'HAND_STABLE' }]);
    const off = transition(active, { type: 'CAMERA_DISABLE' });
    expect(off.input).toBe('fallback');
    expect(off.phase).toBe('active');
    expect(wantsCamera(off)).toBe(false);
    expect(transition(off, { type: 'ENTER' }).phase).toBe('activating');
  });

  it('exit returns to landing from anywhere, and the flow can restart', () => {
    for (const events of [
      [{ type: 'ENTER' }],
      [{ type: 'ENTER' }, { type: 'CAMERA_READY' }],
      [{ type: 'ENTER_FALLBACK' }, { type: 'FREEZE' }],
      [{ type: 'ENTER_FALLBACK' }, { type: 'BREACH', kind: 'tear' }],
    ] as MachineEvent[][]) {
      const s = transition(run(events), { type: 'EXIT' });
      expect(s).toEqual(initialMachineState);
      expect(transition(s, { type: 'ENTER' }).phase).toBe('activating');
    }
  });

  it('ignores events that do not apply to the current phase', () => {
    expect(transition(initialMachineState, { type: 'FREEZE' })).toBe(initialMachineState);
    expect(transition(initialMachineState, { type: 'RESUME' })).toBe(initialMachineState);
    expect(transition(initialMachineState, { type: 'BREACH', kind: 'tear' })).toBe(initialMachineState);
  });
});
