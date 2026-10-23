import * as sfx from './soundDesign';

export interface AudioFrame {
  /** 0..1 gravity well strength and how close objects are to it. */
  grab: number;
  proximity: number;
  /** -1..1 horizontal position of the well. */
  grabPan: number;
  stretchAmount: number;
  stretchFactor: number;
  stormEnergy: number;
  stormPan: number;
  turbulence: number;
  reverse: number;
  frozen: boolean;
  erase: number;
  /** Ambient bed level: quieter on the landing screen. */
  ambience: number;
}

interface Texture {
  gain: GainNode;
  stop: () => void;
}

const SMOOTH = 0.08;

/**
 * Central Web Audio controller. The context is created only after a user
 * gesture. All levels move through setTargetAtTime to avoid clicks, and a
 * high-pass plus limiter on the master bus prevents clipping and sustained
 * high-energy sub frequencies.
 */
export class AudioController {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private noise!: AudioBuffer;
  private ambient!: Texture;
  private drone!: Texture & { filter: BiquadFilterNode; osc: OscillatorNode[]; pan: StereoPannerNode };
  private tension!: Texture & { osc: OscillatorNode; mod: OscillatorNode; modGain: GainNode; filter: BiquadFilterNode };
  private wind!: Texture & { filter: BiquadFilterNode; pan: StereoPannerNode; lfo: GainNode };
  private muted = false;
  private volume = 0.7;

  get ready(): boolean {
    return !!this.ctx;
  }

  /** Must be called from a user gesture (autoplay policy). */
  async init(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.noise = sfx.createNoiseBuffer(ctx);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 30;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 6;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.8;
    this.bus.connect(hp).connect(limiter).connect(this.master).connect(ctx.destination);
    this.applyMaster(0.8);

    this.buildTextures(ctx);
    if (ctx.state === 'suspended') await ctx.resume();
  }

  private buildTextures(ctx: AudioContext): void {
    const out = this.bus;
    // Ambient bed: a quiet, slowly beating fifth.
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600;
      const oscs = [98, 146.8, 147.6].map((f) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.connect(lp);
        o.start();
        return o;
      });
      lp.connect(gain).connect(out);
      this.ambient = { gain, stop: () => oscs.forEach((o) => o.stop()) };
    }
    // GRAB GRAVITY: low resonant drone.
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 9;
      filter.frequency.value = 180;
      const pan = ctx.createStereoPanner();
      const osc = [55, 82.4, 110.3].map((f, i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'sawtooth';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.6 : 0.18;
        o.connect(g).connect(filter);
        o.start();
        return o;
      });
      filter.connect(gain).connect(pan).connect(out);
      this.drone = { gain, filter, osc, pan, stop: () => osc.forEach((o) => o.stop()) };
    }
    // STRETCH REALITY: metallic FM tension.
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 220;
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = 220 * 1.41;
      const modGain = ctx.createGain();
      modGain.gain.value = 120;
      mod.connect(modGain).connect(osc.frequency);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 4;
      filter.frequency.value = 900;
      osc.connect(filter).connect(gain).connect(out);
      osc.start();
      mod.start();
      this.tension = { gain, osc, mod, modGain, filter, stop: () => (osc.stop(), mod.stop()) };
    }
    // CONDUCT A STORM: filtered, modulated wind.
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.value = 400;
      const lfoOsc = ctx.createOscillator();
      lfoOsc.frequency.value = 0.4;
      const lfo = ctx.createGain();
      lfo.gain.value = 150;
      lfoOsc.connect(lfo).connect(filter.frequency);
      const pan = ctx.createStereoPanner();
      src.connect(filter).connect(gain).connect(pan).connect(out);
      src.start();
      lfoOsc.start();
      this.wind = { gain, filter, pan, lfo, stop: () => (src.stop(), lfoOsc.stop()) };
    }
  }

  private applyMaster(timeConstant = SMOOTH): void {
    if (!this.ctx) return;
    const v = this.muted ? 0 : this.volume * 0.9;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, timeConstant);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyMaster();
  }

  /** Continuous textures follow actual interaction parameters. */
  update(f: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const hush = f.frozen ? 0.15 : 1;
    const erase = 1 - f.erase * 0.6;

    this.ambient.gain.gain.setTargetAtTime(0.035 * f.ambience * (f.frozen ? 0.6 : 1), t, 0.5);

    const g = f.grab * (0.35 + 0.65 * f.proximity);
    this.drone.gain.gain.setTargetAtTime(0.16 * g * hush * erase, t, SMOOTH * 2);
    this.drone.filter.frequency.setTargetAtTime(140 + f.proximity * 700 + f.grab * 200, t, SMOOTH);
    this.drone.pan.pan.setTargetAtTime(f.grabPan * 0.6, t, SMOOTH);

    const tensionFreq = 160 * Math.pow(2, (f.stretchFactor - 1) * 1.2);
    this.tension.osc.frequency.setTargetAtTime(tensionFreq, t, SMOOTH);
    this.tension.mod.frequency.setTargetAtTime(tensionFreq * 1.41, t, SMOOTH);
    this.tension.modGain.gain.setTargetAtTime(60 + Math.abs(f.stretchFactor - 1) * 300, t, SMOOTH);
    this.tension.filter.frequency.setTargetAtTime(500 + f.stretchFactor * 900, t, SMOOTH);
    this.tension.gain.gain.setTargetAtTime(
      0.05 * f.stretchAmount * (0.4 + Math.min(1, Math.abs(f.stretchFactor - 1))) * hush * erase,
      t,
      SMOOTH * 2,
    );

    const e = f.stormEnergy;
    this.wind.gain.gain.setTargetAtTime(0.22 * e * hush * erase, t, SMOOTH);
    this.wind.filter.frequency.setTargetAtTime(250 + e * 2600, t, SMOOTH);
    this.wind.filter.Q.setTargetAtTime(1 + f.turbulence * 6, t, SMOOTH);
    this.wind.lfo.gain.setTargetAtTime(100 + f.turbulence * 900, t, SMOOTH);
    this.wind.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, f.stormPan)), t, SMOOTH);
  }

  play(kind: 'tear' | 'reverse' | 'snap' | 'freeze' | 'resume' | 'eraseStart' | 'eraseEnd', pan = 0, collapseSec = 0.55): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const shot = { ctx, out: this.bus, noise: this.noise, pan };
    switch (kind) {
      case 'tear':
        return sfx.tear(shot);
      case 'reverse':
        return sfx.reverse(shot);
      case 'snap':
        return sfx.snap(shot, collapseSec);
      case 'freeze':
        return sfx.freeze(shot);
      case 'resume':
        return sfx.resume(shot);
      case 'eraseStart':
        return sfx.erase(shot, true);
      case 'eraseEnd':
        return sfx.erase(shot, false);
    }
  }

  engage(freq: number, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    sfx.engage({ ctx, out: this.bus, noise: this.noise, pan }, freq);
  }

  async suspend(): Promise<void> {
    if (this.ctx?.state === 'running') await this.ctx.suspend();
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
  }

  /** Fades out, then closes the context. */
  async dispose(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ctx = null;
    try {
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      await new Promise((r) => setTimeout(r, 200));
      [this.ambient, this.drone, this.tension, this.wind].forEach((tex) => tex?.stop());
      await ctx.close();
    } catch {
      /* already closed */
    }
  }
}
