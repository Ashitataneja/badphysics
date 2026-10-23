/**
 * Procedural sound palette. Every sound is built from oscillators, noise
 * buffers, filters, envelopes and panners; nothing is downloaded.
 * One-shot graphs disconnect themselves when finished.
 */

export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Slightly pinked noise: less harsh than white.
  let b = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b = 0.97 * b + 0.03 * w;
    d[i] = w * 0.55 + b * 2.2;
  }
  return buf;
}

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

interface Shot {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  pan: number;
}

function panner(ctx: AudioContext, out: AudioNode, pan: number): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  return p;
}

function env(g: AudioParam, t: number, attack: number, peak: number, decay: number): void {
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function cleanup(nodes: AudioNode[], afterSec: number): void {
  window.setTimeout(() => nodes.forEach((n) => n.disconnect()), afterSec * 1000 + 200);
}

/** TEAR REALITY: sharp transient, then a distorted decaying tail. */
export function tear({ ctx, out, noise, pan }: Shot): void {
  const t = ctx.currentTime;
  const p = panner(ctx, out, pan);
  const click = ctx.createBufferSource();
  click.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const cg = ctx.createGain();
  env(cg.gain, t, 0.002, 0.5, 0.06);
  click.connect(hp).connect(cg).connect(p);
  click.start(t, Math.random(), 0.12);

  const tail = ctx.createBufferSource();
  tail.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 3;
  bp.frequency.setValueAtTime(3200, t);
  bp.frequency.exponentialRampToValueAtTime(180, t + 1.4);
  const shaper = ctx.createWaveShaper();
  shaper.curve = distortionCurve(30);
  const tg = ctx.createGain();
  env(tg.gain, t + 0.01, 0.02, 0.22, 1.4);
  tail.connect(bp).connect(shaper).connect(tg).connect(p);
  tail.start(t, Math.random(), 1.6);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.5);
  const og = ctx.createGain();
  env(og.gain, t, 0.004, 0.08, 0.5);
  osc.connect(og).connect(p);
  osc.start(t);
  osc.stop(t + 0.6);
  cleanup([click, hp, cg, tail, bp, shaper, tg, osc, og, p], 1.8);
}

/** REVERSE GRAVITY: deep sub pulse followed by a rising tonal sweep. */
export function reverse({ ctx, out, pan }: Shot): void {
  const t = ctx.currentTime;
  const p = panner(ctx, out, pan * 0.4);
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(62, t);
  sub.frequency.exponentialRampToValueAtTime(34, t + 0.7);
  const sg = ctx.createGain();
  env(sg.gain, t, 0.01, 0.42, 0.8);
  sub.connect(sg).connect(p);
  sub.start(t);
  sub.stop(t + 1);

  const sweep = ctx.createOscillator();
  sweep.type = 'triangle';
  sweep.frequency.setValueAtTime(90, t + 0.25);
  sweep.frequency.exponentialRampToValueAtTime(880, t + 2.6);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(4000, t + 2.6);
  const wg = ctx.createGain();
  wg.gain.setValueAtTime(0.0001, t);
  wg.gain.exponentialRampToValueAtTime(0.09, t + 1.6);
  wg.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
  sweep.connect(lp).connect(wg).connect(p);
  sweep.start(t + 0.2);
  sweep.stop(t + 3.3);
  cleanup([sub, sg, sweep, lp, wg, p], 3.4);
}

/** SNAP THE UNIVERSE: compressed impact, then a granular shimmer. */
export function snapImpact({ ctx, out, noise, pan }: Shot, delay = 0): void {
  const t = ctx.currentTime + delay;
  const p = panner(ctx, out, pan * 0.5);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -30;
  comp.ratio.value = 12;
  comp.attack.value = 0.001;
  comp.release.value = 0.1;
  comp.connect(p);
  const boom = ctx.createOscillator();
  boom.frequency.setValueAtTime(140, t);
  boom.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  const bg = ctx.createGain();
  env(bg.gain, t, 0.003, 0.6, 0.35);
  boom.connect(bg).connect(comp);
  boom.start(t);
  boom.stop(t + 0.45);
  const crack = ctx.createBufferSource();
  crack.buffer = noise;
  const cg = ctx.createGain();
  env(cg.gain, t, 0.001, 0.5, 0.1);
  crack.connect(cg).connect(comp);
  crack.start(t, Math.random(), 0.2);

  // Granular shimmer: many tiny sine grains on a bright, rising cluster.
  const nodes: AudioNode[] = [comp, boom, bg, crack, cg, p];
  const grains = 34;
  for (let i = 0; i < grains; i++) {
    const gt = t + 0.08 + Math.random() * 1.3;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const base = [880, 1320, 1760, 2640, 3520][Math.floor(Math.random() * 5)];
    o.frequency.value = base * (1 + (Math.random() - 0.5) * 0.02);
    const g = ctx.createGain();
    env(g.gain, gt, 0.004, 0.025 * (1 - (gt - t) / 1.6), 0.08 + Math.random() * 0.12);
    const gp = ctx.createStereoPanner();
    gp.pan.value = Math.max(-1, Math.min(1, pan * 0.5 + (Math.random() - 0.5) * 1.2));
    o.connect(g).connect(gp).connect(out);
    o.start(gt);
    o.stop(gt + 0.3);
    nodes.push(o, g, gp);
  }
  cleanup(nodes, delay + 1.8);
}

/** Collapse inhale leading into the snap impact. */
export function snap(shot: Shot, collapseSec: number): void {
  const { ctx, out, noise } = shot;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(5000, t + collapseSec);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + collapseSec * 0.95);
  g.gain.exponentialRampToValueAtTime(0.0001, t + collapseSec + 0.02);
  src.connect(bp).connect(g).connect(out);
  src.start(t, Math.random(), collapseSec + 0.1);
  cleanup([src, bp, g], collapseSec + 0.2);
  snapImpact(shot, collapseSec);
}

/** FREEZE TIME: short transient followed by a fading sustained tone. */
export function freeze({ ctx, out }: Shot): void {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = 1567;
  const g = ctx.createGain();
  env(g.gain, t, 0.002, 0.18, 0.12);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.2);
  const pad = ctx.createOscillator();
  pad.type = 'triangle';
  pad.frequency.value = 196;
  const pad2 = ctx.createOscillator();
  pad2.type = 'sine';
  pad2.frequency.value = 293.7;
  const pg = ctx.createGain();
  pg.gain.setValueAtTime(0.0001, t);
  pg.gain.exponentialRampToValueAtTime(0.06, t + 0.08);
  pg.gain.exponentialRampToValueAtTime(0.0001, t + 3);
  pad.connect(pg);
  pad2.connect(pg);
  pg.connect(out);
  pad.start(t);
  pad2.start(t);
  pad.stop(t + 3.1);
  pad2.stop(t + 3.1);
  cleanup([o, g, pad, pad2, pg], 3.2);
}

/** Time resumes: a reversed, rising blip. */
export function resume({ ctx, out }: Shot): void {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(400, t);
  o.frequency.exponentialRampToValueAtTime(1600, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.1, t + 0.22);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.35);
  cleanup([o, g], 0.4);
}

/** ERASE YOURSELF: a filtered noise sweep that fades as colour drains. */
export function erase({ ctx, out, noise }: Shot, entering: boolean): void {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 8;
  f.frequency.setValueAtTime(entering ? 6000 : 200, t);
  f.frequency.exponentialRampToValueAtTime(entering ? 150 : 6000, t + 1.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + 1.9);
  cleanup([src, f, g], 2);
}

/** Small acknowledgement when a continuous gesture engages. */
export function engage({ ctx, out, pan }: Shot, freq: number): void {
  const t = ctx.currentTime;
  const p = panner(ctx, out, pan);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = ctx.createGain();
  env(g.gain, t, 0.01, 0.05, 0.4);
  o.connect(g).connect(p);
  o.start(t);
  o.stop(t + 0.5);
  cleanup([o, g, p], 0.6);
}
