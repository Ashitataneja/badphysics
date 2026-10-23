import type { ControlState, GestureEvent } from '../camera/gestureClassifier';
import { clamp, clamp01 } from '../utils/math';
import { KinematicSmoother } from '../utils/smoothing';

export type ShortcutAction = 'mute' | 'exit' | 'debug' | 'perf' | 'legend';

/**
 * Mouse and keyboard fallback. Produces the same ControlState and
 * GestureEvent stream as the hand-gesture engine, so every effect behaves
 * identically whichever input drives it.
 *
 *   mouse move       wind (storm) + camera parallax
 *   hold mouse       gravity well at the cursor
 *   G                toggle gravity well
 *   X                toggle stretch (cursor distance from centre sets the factor)
 *   T  tear  ·  R  reverse gravity  ·  S  snap  ·  F  freeze / resume  ·  E  erase
 *   M  mute  ·  Esc exit  ·  `  debug  ·  P  performance  ·  H  legend
 */
export class FallbackInput {
  private readonly kin = new KinematicSmoother(0.05, 0.08, 8, 1.5);
  private pointer = { x: 0, y: 0 };
  private pointerSeen = false;
  private mouseDown = false;
  private grabToggle = false;
  private grabSince = 0;
  private stretchToggle = false;
  private erase = false;
  private pending: GestureEvent[] = [];
  private lastTime = -1;
  private energy = 0;
  enabled = true;

  constructor(
    private readonly target: HTMLElement,
    private readonly isFrozen: () => boolean,
    private readonly onShortcut: (a: ShortcutAction) => void,
  ) {
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('blur', this.onUp);
    window.addEventListener('keydown', this.onKey);
  }

  get pointerPosition(): { x: number; y: number } {
    return this.pointer;
  }

  private onMove = (e: PointerEvent) => {
    const r = this.target.getBoundingClientRect();
    // Normalised device coords, divided by the same 0.85 the world mapping uses.
    this.pointer.x = clamp((((e.clientX - r.left) / r.width) * 2 - 1) / 0.85, -1.3, 1.3);
    this.pointer.y = clamp((-(((e.clientY - r.top) / r.height) * 2 - 1)) / 0.85, -1.3, 1.3);
    this.pointerSeen = true;
  };

  private onDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, select, a, [role="dialog"]')) return;
    this.onMove(e);
    this.mouseDown = true;
    this.grabSince = performance.now();
  };

  private onUp = () => {
    this.mouseDown = false;
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') return this.onShortcut('exit');
    if (k === 'm') return this.onShortcut('mute');
    if (k === '`') return this.onShortcut('debug');
    if (k === 'p') return this.onShortcut('perf');
    if (k === 'h') return this.onShortcut('legend');
    if (!this.enabled) return;
    const origin = { ...this.pointer };
    switch (k) {
      case 'g':
        this.grabToggle = !this.grabToggle;
        this.grabSince = performance.now();
        break;
      case 'x':
        this.stretchToggle = !this.stretchToggle;
        break;
      case 'e':
        this.erase = !this.erase;
        this.pending.push(this.erase ? { type: 'eraseStart', source: 'keyboard' } : { type: 'eraseEnd', source: 'keyboard' });
        break;
      case 't': {
        let dx = this.kin.vel.x;
        let dy = this.kin.vel.y;
        let l = Math.hypot(dx, dy);
        if (l < 0.3) {
          // Not moving: tear outward from the cursor through the centre line.
          dx = origin.x >= 0 ? 1 : -1;
          dy = (Math.random() - 0.5) * 0.6;
          l = Math.hypot(dx, dy);
        }
        const start = { x: origin.x - (dx / l) * 0.4, y: origin.y - (dy / l) * 0.4 };
        this.pending.push({ type: 'tear', origin: start, direction: { x: dx / l, y: dy / l }, speed: 5, source: 'keyboard' });
        break;
      }
      case 'r':
        this.pending.push({ type: 'reverse', origin, source: 'keyboard' });
        break;
      case 's':
        this.pending.push({ type: 'snap', origin, source: 'keyboard' });
        break;
      case 'f':
        this.pending.push(this.isFrozen() ? { type: 'resume', source: 'keyboard' } : { type: 'freeze', source: 'keyboard' });
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  /** Clears toggled states (used on exit). */
  reset(): void {
    this.grabToggle = this.stretchToggle = this.erase = this.mouseDown = false;
    this.pending.length = 0;
    this.energy = 0;
  }

  /** Samples the current fallback controls and drains pending events. */
  sample(now: number): { controls: ControlState; events: GestureEvent[] } {
    const dt = this.lastTime < 0 ? 1 / 60 : clamp((now - this.lastTime) / 1000, 1e-3, 0.1);
    this.lastTime = now;
    if (this.pointerSeen) this.kin.update(this.pointer.x, this.pointer.y, dt);
    const speed = this.kin.speed;
    // Mouse wind is gentler than a hand; it decays with a short memory.
    const target = this.enabled ? clamp01((speed - 0.3) / 6) * 0.7 : 0;
    this.energy += (target - this.energy) * (1 - Math.exp(-dt / (target > this.energy ? 0.08 : 0.4)));
    const grabbing = this.enabled && (this.mouseDown || this.grabToggle);
    const held = (now - this.grabSince) / 600;
    const stretchFactor = clamp(0.4 + Math.abs(this.pointer.x) * 1.8, 0.4, 2.6);
    const controls: ControlState = {
      hands: [],
      grab: {
        active: grabbing,
        pos: { ...this.kin.pos },
        strength: grabbing ? 0.35 + 0.65 * clamp01(held) : 0,
      },
      stretch: {
        active: this.enabled && this.stretchToggle,
        a: { x: -0.6, y: -0.15 },
        b: { x: 0.6, y: 0.15 },
        factor: stretchFactor,
      },
      storm: {
        active: this.energy > 0.04,
        pos: { ...this.kin.pos },
        vel: { x: this.kin.vel.x * 0.6, y: this.kin.vel.y * 0.6 },
        energy: this.energy,
        turbulence: clamp01(Math.hypot(this.kin.acc.x, this.kin.acc.y) / 60),
        vortex: 0,
      },
      erase: this.enabled && this.erase,
    };
    const events = this.pending;
    this.pending = [];
    return { controls, events: this.enabled ? events : [] };
  }

  dispose(): void {
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('blur', this.onUp);
    window.removeEventListener('keydown', this.onKey);
  }
}
