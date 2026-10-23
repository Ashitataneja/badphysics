import { useStore, type QualitySetting } from '../app/state';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useStore((st) => st.settings);
  const set = useStore((st) => st.setSettings);
  const toggle = (key: keyof typeof s, label: string, hint?: string) => (
    <label className="setting-toggle">
      <input type="checkbox" checked={s[key] as boolean} onChange={(e) => set({ [key]: e.target.checked })} />
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </label>
  );
  return (
    <div className="settings" role="dialog" aria-modal="false" aria-labelledby="settings-title">
      <div className="settings-head">
        <h2 id="settings-title" className="eyebrow">
          SETTINGS
        </h2>
        <button className="btn-mini" onClick={onClose} autoFocus>
          close
        </button>
      </div>
      <label className="setting-range">
        <span>Volume</span>
        <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => set({ volume: +e.target.value })} />
      </label>
      {toggle('muted', 'Mute', 'M')}
      <label className="setting-range">
        <span>Sensitivity · {s.sensitivity.toFixed(2)}×</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={s.sensitivity}
          onChange={(e) => set({ sensitivity: +e.target.value })}
        />
      </label>
      <label className="setting-select">
        <span>Quality</span>
        <select value={s.quality} onChange={(e) => set({ quality: e.target.value as QualitySetting })}>
          <option value="auto">Auto (adapts to frame time)</option>
          <option value="high">High · ~30k particles</option>
          <option value="medium">Medium · ~10k particles</option>
          <option value="low">Low · ~3k particles</option>
        </select>
      </label>
      {toggle('reducedMotion', 'Reduced motion', 'less camera movement and distortion')}
      {toggle('reducedFlash', 'Reduced flash', 'no flashes, softer inversion')}
      {toggle('mirror', 'Mirror camera', 'match your movements like a mirror')}
      {toggle('invertY', 'Invert vertical')}
      {toggle('showPip', 'Camera preview')}
      {toggle('debug', 'Gesture debugger', '`')}
      {toggle('showPerf', 'Performance overlay', 'P')}
    </div>
  );
}
