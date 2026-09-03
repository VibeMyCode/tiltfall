// Run proofs. A run is fully determined by its seed, the level perks in force
// and the per-tick tilt, plus the ticks at which jumps and boosters fired —
// that is exactly the determinism §5.4 was written for, and it is what lets a
// server recount a score instead of taking the client's word for it.
//
// Nothing here touches the network or Babylon: the recorder runs in the game
// loop, replayScore runs in the API function, and both are plain data + sim.
import { BOOSTER_ORDER, type BoosterId } from "./boosters";
import { CONFIG, jumpCooldownTicks } from "./config";
import { activateBooster, createSim, jump, step, type SimOpts } from "./sim";

// Ten minutes. The tilt track is attacker-controlled and drives a loop, so its
// length has to be bounded before it is trusted with any work at all.
const MAX_TICKS = 72_000;

export interface RunProof {
  seed: number;
  shields: number; // level perk (L5, L13) — see clampOpts
  charges: number; // level perk (L7)
  tilt: string; // base64 of Int16Array: two millitilt values per tick
  events: [number, string][]; // [tick, "jump" | booster id]
}

// Explicit little-endian: this crosses a machine boundary, so platform
// endianness is not something to inherit by accident.
function encodeTilt(track: number[]): string {
  const view = new DataView(new ArrayBuffer(track.length * 2));
  for (let i = 0; i < track.length; i++) view.setInt16(i * 2, track[i], true);
  const bytes = new Uint8Array(view.buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

function decodeTilt(b64: string): number[] | null {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null; // not base64 — a caller sending junk, not a bug here
  }
  if (bin.length % 4 !== 0) return null; // two int16 per tick
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 2) out.push(view.getInt16(i, true));
  return out;
}

export interface RunRecorder {
  tick: (x: number, z: number) => void;
  event: (kind: BoosterId | "jump") => void;
  proof: () => RunProof;
}

// Records alongside the real run: every value here is one the sim was actually
// stepped with, so the recording IS the run rather than a description of it.
export function createRecorder(seed: number, shields: number, charges: number): RunRecorder {
  const track: number[] = [];
  const events: [number, string][] = [];
  return {
    tick(x, z) {
      if (track.length >= MAX_TICKS * 2) return; // a run this long will not rank
      track.push(Math.round(x * 1000), Math.round(z * 1000));
    },
    // Called before the tick it belongs to is stepped, which is the order
    // replayScore applies them in.
    event(kind) {
      events.push([track.length / 2, kind]);
    },
    proof: () => ({ seed, shields, charges, tilt: encodeTilt(track), events }),
  };
}

// The perk table tops out at 15 and grants at most two shields (L5, L13) and
// one extra jump charge (L7), so clamping here closes the "I am level 99" hole
// without the server having to track anyone's purchases. Jump power and reload
// are the same at every level, so they are simply not taken from the client.
function clampOpts(p: RunProof): SimOpts {
  const int = (v: unknown, max: number) =>
    Math.min(max, Math.max(0, Math.floor(typeof v === "number" && isFinite(v) ? v : 0)));
  return {
    jumpPower: CONFIG.jumpBasePower,
    jumpCooldownTicks: jumpCooldownTicks(),
    jumpMaxCharges: 1 + int(p.charges - 1, 1),
    shields: int(p.shields, 2),
  };
}

export interface ReplayResult {
  score: number;
  depth: number;
  blocks: number;
  ticks: number;
}

// Re-runs the proof and reports what the sim actually produced. Returns null
// only for input that is malformed or over the size bound — a run that simply
// scores badly is a valid replay with a low score, and it is the caller's job
// to compare that against what was claimed.
export function replayScore(p: RunProof): ReplayResult | null {
  if (!p || typeof p.seed !== "number" || !isFinite(p.seed) || typeof p.tilt !== "string") return null;
  const track = decodeTilt(p.tilt);
  if (!track) return null;
  const ticks = track.length / 2;
  if (ticks < 1 || ticks > MAX_TICKS) return null;

  const byTick = new Map<number, string[]>();
  for (const e of Array.isArray(p.events) ? p.events.slice(0, 2000) : []) {
    if (!Array.isArray(e) || typeof e[0] !== "number" || typeof e[1] !== "string") continue;
    const t = Math.floor(e[0]);
    if (t < 0 || t > ticks) continue;
    const at = byTick.get(t);
    if (at) at.push(e[1]);
    else byTick.set(t, [e[1]]);
  }

  const s = createSim(Math.floor(p.seed), clampOpts(p));
  let ran = 0;
  for (let i = 0; i < ticks && !s.finished; i++) {
    for (const kind of byTick.get(i) ?? []) {
      if (kind === "jump") jump(s);
      else if ((BOOSTER_ORDER as string[]).includes(kind)) activateBooster(s, kind as BoosterId);
    }
    const x = track[i * 2] / 1000;
    const z = track[i * 2 + 1] / 1000;
    // Out-of-range tilt would be a client steering harder than the game allows.
    if (x < -1 || x > 1 || z < -1 || z > 1) return null;
    step(s, x, z);
    ran = i + 1;
  }
  return { score: s.score, depth: s.depth, blocks: s.broken, ticks: ran };
}
