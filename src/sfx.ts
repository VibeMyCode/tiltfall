// Sound — 100% synthesized with WebAudio (§9.3): no files, no downloads.
// Every effect is an oscillator/noise burst shaped by a gain envelope, so
// the whole soundtrack costs zero bytes and works offline.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function loadMuted(): boolean {
  try {
    return localStorage.getItem("tf.muted") === "1";
  } catch {
    return false;
  }
}
muted = loadMuted();

// Browsers block audio until a user gesture — call this from the first tap.
export function initAudio(): void {
  if (ctx) {
    void ctx.resume();
    return;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem("tf.muted", muted ? "1" : "0");
  } catch {
    // storage unavailable — session-only preference
  }
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.6, ctx.currentTime, 0.02);
  return muted;
}

// --- primitives ------------------------------------------------------------

function tone(
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; sweepTo?: number; delay?: number } = {},
): void {
  if (!ctx || !master || muted) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.25, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(
  dur: number,
  opts: { gain?: number; filter?: number; sweepTo?: number; q?: number; delay?: number } = {},
): void {
  if (!ctx || !master || muted) return;
  const t0 = ctx.currentTime + (opts.delay ?? 0);
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(opts.filter ?? 1200, t0);
  if (opts.sweepTo) bp.frequency.exponentialRampToValueAtTime(Math.max(60, opts.sweepTo), t0 + dur);
  bp.Q.value = opts.q ?? 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.3, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
}

// --- the game's voice ------------------------------------------------------

export const SFX = {
  glass: (combo: number) => {
    noise(0.16, { gain: 0.22, filter: 5200, sweepTo: 2600, q: 1.6 });
    tone(900 + Math.min(combo, 10) * 120, 0.12, { type: "triangle", gain: 0.1 });
  },
  stone: () => {
    noise(0.26, { gain: 0.3, filter: 420, sweepTo: 140, q: 0.8 });
    tone(120, 0.2, { type: "square", gain: 0.12, sweepTo: 60 });
  },
  bomb: () => {
    noise(0.55, { gain: 0.4, filter: 700, sweepTo: 90, q: 0.7 });
    tone(70, 0.5, { type: "sine", gain: 0.28, sweepTo: 32 });
  },
  bumper: () => {
    tone(660, 0.12, { type: "square", gain: 0.16, sweepTo: 1500 });
  },
  spike: () => {
    tone(180, 0.16, { type: "sawtooth", gain: 0.14, sweepTo: 70 });
  },
  jump: () => {
    tone(340, 0.18, { type: "sine", gain: 0.18, sweepTo: 900 });
  },
  mine: () => {
    // Death: deep boom + long debris hiss.
    noise(0.9, { gain: 0.5, filter: 900, sweepTo: 60, q: 0.6 });
    tone(90, 0.8, { type: "sine", gain: 0.35, sweepTo: 24 });
    tone(200, 0.5, { type: "sawtooth", gain: 0.14, sweepTo: 40, delay: 0.04 });
  },
  mineBlast: () => {
    noise(0.4, { gain: 0.3, filter: 800, sweepTo: 120, q: 0.7 });
    tone(110, 0.35, { type: "sine", gain: 0.2, sweepTo: 40 });
  },
  booster: () => {
    [0, 0.06, 0.12].forEach((d, i) => tone(520 + i * 260, 0.14, { type: "triangle", gain: 0.16, delay: d }));
  },
  shield: () => {
    tone(420, 0.4, { type: "sine", gain: 0.16, sweepTo: 820 });
  },
  levelUp: () => {
    [0, 0.1, 0.2, 0.32].forEach((d, i) => tone(440 * Math.pow(1.26, i), 0.28, { type: "triangle", gain: 0.2, delay: d }));
  },
  claim: () => {
    [0, 0.08].forEach((d, i) => tone(700 + i * 400, 0.16, { type: "sine", gain: 0.16, delay: d }));
  },
  buy: () => {
    tone(300, 0.1, { type: "square", gain: 0.12, sweepTo: 620 });
  },
};
