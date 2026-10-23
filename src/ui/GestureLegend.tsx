import { useStore } from '../app/state';
import { GESTURE_INFO, type GestureName } from '../camera/gestureClassifier';
import { GestureGlyph } from './GestureGlyph';

export const GESTURES: GestureName[] = [
  'GRAB_GRAVITY',
  'STRETCH_REALITY',
  'TEAR_REALITY',
  'REVERSE_GRAVITY',
  'CONDUCT_STORM',
  'SNAP_UNIVERSE',
  'FREEZE_TIME',
  'ERASE_YOURSELF',
];

export function GestureLegend({ cameraMode }: { cameraMode: boolean }) {
  const active = useStore((s) => s.hud.gesture);
  const setSettings = useStore((s) => s.setSettings);
  const discovery = useStore((s) => s.settings.discovery);
  return (
    <aside className="legend" aria-label="Gesture legend">
      <div className="legend-head">
        <span className="eyebrow">{cameraMode ? 'GESTURES' : 'CONTROLS'}</span>
        <button className="btn-mini" onClick={() => setSettings({ discovery: !discovery })} aria-pressed={discovery}>
          {discovery ? 'close demos' : 'discover'}
        </button>
        <button className="btn-mini" onClick={() => setSettings({ showLegend: false })} aria-label="Hide legend">
          hide
        </button>
      </div>
      <ul>
        {GESTURES.map((g) => {
          const info = GESTURE_INFO[g];
          return (
            <li key={g} className={active === g ? 'is-active' : ''} aria-current={active === g}>
              <GestureGlyph gesture={g} size={16} />
              <span className="legend-name">{info.label}</span>
              <kbd>{info.key}</kbd>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/** Short, looping demonstrations. Runs alongside the simulation; nothing pauses. */
export function DiscoveryPanel() {
  const setSettings = useStore((s) => s.setSettings);
  return (
    <section className="discovery" aria-label="Gesture discovery">
      <div className="discovery-head">
        <span className="eyebrow">DISCOVERY · the simulation keeps running</span>
        <button className="btn-mini" onClick={() => setSettings({ discovery: false })}>
          close
        </button>
      </div>
      <div className="discovery-cards">
        {GESTURES.map((g) => (
          <article key={g} className="demo-card">
            <div className={`demo demo-${g.toLowerCase()}`} aria-hidden="true">
              <i className="d1" />
              <i className="d2" />
              <i className="d3" />
            </div>
            <h3>{GESTURE_INFO[g].label}</h3>
            <p className="demo-how">{GESTURE_INFO[g].how}</p>
            <p className="demo-effect">{GESTURE_INFO[g].effect}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
