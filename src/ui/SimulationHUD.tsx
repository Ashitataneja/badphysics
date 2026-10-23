import { useEffect, useState } from 'react';
import type { Experience } from '../app/Experience';
import { useStore } from '../app/state';
import { GESTURE_INFO } from '../camera/gestureClassifier';
import { DiscoveryPanel, GestureLegend } from './GestureLegend';
import { GestureGlyph } from './GestureGlyph';
import { SettingsPanel } from './SettingsPanel';
import { VideoMount } from './VideoMount';

interface Props {
  experience: Experience | null;
  video: HTMLVideoElement | null;
  delegate: 'GPU' | 'CPU' | null;
}

export function SimulationHUD({ experience, video, delegate }: Props) {
  const machine = useStore((s) => s.machine);
  const hud = useStore((s) => s.hud);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const dispatch = useStore((s) => s.dispatch);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const cameraMode = machine.input === 'camera';
  const info = GESTURE_INFO[hud.gesture];
  const conf = Math.round((cameraMode ? hud.trackingConfidence : hud.confidence) * 100);

  return (
    <div className="hud">
      <header className="hud-top-left" aria-live="polite">
        <span className="wordmark">BAD PHYSICS</span>
        <div className={`gesture-readout ${hud.gesture !== 'NONE' ? 'is-live' : ''}`}>
          <GestureGlyph gesture={hud.gesture} size={26} />
          <div>
            <strong>{hud.gesture === 'NONE' ? 'NO GESTURE' : info.label}</strong>
            <span>{info.effect}</span>
          </div>
        </div>
        <div className="tracking">
          {cameraMode ? (
            <>
              <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={conf} aria-label="Tracking confidence">
                <span style={{ width: `${conf}%` }} />
              </span>
              <span>
                {hud.handCount === 0 ? 'NO HANDS' : hud.handCount === 1 ? '1 HAND' : '2 HANDS'} · {conf}%
                {delegate ? ` · ${delegate}` : ''}
              </span>
            </>
          ) : (
            <span>MOUSE &amp; KEYBOARD</span>
          )}
        </div>
        {machine.trackingLost && (
          <p className="tracking-lost" role="status">
            Hand lost. Reality is coasting.
          </p>
        )}
      </header>

      <nav className="hud-controls" aria-label="Simulation controls">
        <button
          className="btn-chip"
          onClick={() => dispatch(cameraMode ? { type: 'CAMERA_DISABLE' } : { type: 'ENTER' })}
          aria-pressed={cameraMode}
        >
          {cameraMode ? 'CAMERA ON' : 'CAMERA OFF'}
        </button>
        <button className="btn-chip" onClick={() => setSettings({ muted: !settings.muted })} aria-pressed={!settings.muted}>
          {settings.muted ? 'SOUND OFF' : 'SOUND ON'}
        </button>
        {!settings.showLegend && (
          <button className="btn-chip" onClick={() => setSettings({ showLegend: true })}>
            LEGEND
          </button>
        )}
        <button className="btn-chip" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}>
          SETTINGS
        </button>
        <button className="btn-chip btn-exit" onClick={() => dispatch({ type: 'EXIT' })} aria-label="Exit the simulation (Escape)">
          EXIT ✕
        </button>
      </nav>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {machine.phase === 'frozen' && (
        <div className="frozen-label" role="status">
          <strong>FROZEN</strong>
          <span>{cameraMode ? 'swipe outward to resume' : 'press F to resume'}</span>
        </div>
      )}

      {settings.showLegend && <GestureLegend cameraMode={cameraMode} />}
      {settings.discovery && <DiscoveryPanel />}

      {cameraMode && video && settings.showPip && (
        <div className="pip">
          <VideoMount video={video} experience={experience} mode="pip" mirror={settings.mirror} />
          <button className="btn-mini pip-hide" onClick={() => setSettings({ showPip: false })} aria-label="Hide camera preview">
            hide
          </button>
        </div>
      )}

      {settings.debug && <DebugPanel />}
      {settings.showPerf && <PerfOverlay />}
    </div>
  );
}

function DebugPanel() {
  const debug = useStore((s) => s.debug);
  return (
    <section className="debug-panel" aria-label="Gesture debugger">
      <p className="eyebrow">GESTURE DEBUG</p>
      {debug.hands.length === 0 && <p>no hands tracked</p>}
      {debug.hands.map((h) => (
        <dl key={h.id}>
          <dt>
            hand {h.id} · {h.handedness}
          </dt>
          <dd>
            pose {h.pose}
            {h.pinching ? ' + pinch' : ''} · open {h.openness.toFixed(2)} · curl {h.curl.toFixed(2)}
          </dd>
          <dd>
            pinch {h.pinchDistance.toFixed(2)} · facing {h.facing.toFixed(2)} · area {h.bboxArea.toFixed(2)}
          </dd>
          <dd>
            speed {h.speed.toFixed(2)} · v ({h.vel.x.toFixed(2)}, {h.vel.y.toFixed(2)})
          </dd>
        </dl>
      ))}
      <ul>
        {debug.candidates.map((c, i) => (
          <li key={i} className={`cand cand-${c.status}`}>
            <b>{c.status.toUpperCase()}</b> {c.gesture} #{c.hand} · {(c.confidence * 100).toFixed(0)}%
            {c.reason && <em> — {c.reason}</em>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PerfOverlay() {
  const p = useStore((s) => s.perf);
  return (
    <section className="perf" aria-label="Performance">
      <span>{p.fps.toFixed(0)} fps</span>
      <span>{p.frameMs.toFixed(1)} ms frame</span>
      <span>{p.detectMs.toFixed(1)} ms detect</span>
      <span>{p.particles.toLocaleString()} particles</span>
      <span>{p.hands} hands</span>
      <span>tier {p.tier}</span>
    </section>
  );
}

export function CueToast() {
  const cue = useStore((s) => s.cue);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!cue) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 1700);
    return () => window.clearTimeout(t);
  }, [cue]);
  return (
    <div className="cue" aria-live="assertive" aria-atomic="true">
      {cue && (
        <span key={cue.id} className={visible ? 'cue-in' : 'cue-out'}>
          {cue.text}
        </span>
      )}
    </div>
  );
}
