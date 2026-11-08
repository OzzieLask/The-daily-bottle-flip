// Tiny synthesized sound kit (Web Audio). No audio files.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Call from a user gesture. */
export function initAudio(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

function noiseBuffer(sec: number): AudioBuffer {
  const b = ctx!.createBuffer(1, Math.floor(ctx!.sampleRate * sec), ctx!.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(t: number, dur: number, f0: number, f1: number, vol: number, q = 1.5) {
  if (!ctx || !master) return;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(dur);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
}

const now = () => ctx?.currentTime ?? 0;

export const sfx = {
  whoosh() {
    noise(now(), 0.35, 400, 2400, 0.5, 0.8);
  },
  /** Plastic bottle hitting a surface; louder for faster impacts. */
  thunk(speed: number) {
    const v = Math.min(1, speed / 3);
    const t = now();
    tone(160 + v * 60, t, 0.12, 'sine', 0.5 * v + 0.15, 70);
    noise(t, 0.06, 2500, 900, 0.35 * v + 0.05, 2);
    noise(t + 0.02, 0.18, 600, 250, 0.25 * v, 3); // water slosh
  },
  select() {
    const t = now();
    tone(660, t, 0.06, 'square', 0.15);
    tone(990, t + 0.06, 0.08, 'square', 0.15);
  },
  star(i: number) {
    tone(880 * Math.pow(2, i / 12 * 2), now(), 0.09, 'triangle', 0.12);
  },
  nice() {
    const t = now();
    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.07, 0.18, 'square', 0.16));
  },
  cap() {
    const t = now();
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.08, 0.22, 'square', 0.17));
    tone(65, t, 0.6, 'triangle', 0.4);
  },
  wobble() {
    const t = now();
    tone(440, t, 0.12, 'square', 0.14);
    tone(554, t + 0.1, 0.12, 'square', 0.14);
    tone(659, t + 0.2, 0.25, 'square', 0.14);
  },
  oof() {
    const t = now();
    tone(220, t, 0.4, 'square', 0.14, 110);
  },
};
