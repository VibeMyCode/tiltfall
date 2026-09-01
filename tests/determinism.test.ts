// §5.4: same seed + same input log + same activations ⇒ identical endless
// run, checked via state checksums every 120 ticks (includes bomb cascades,
// jumps, boosters and streamed tier generation).
import { describe, expect, it } from "vitest";
import { activateBooster, createSim, jump, step } from "../src/sim";

function scriptedInput(tick: number): { x: number; z: number } {
  if (tick < 160) return { x: 0, z: 0 }; // straight drop → guaranteed tier-0 bomb
  const phase = tick >> 7;
  const x = ((phase % 4) - 1.5) * 0.6;
  const z = (((phase >> 1) % 3) - 1) * 0.5;
  return { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 };
}

function runAndChecksum(seed: number, ticks: number): { sums: number[]; score: number; broken: number; depth: number } {
  const sim = createSim(seed, { jumpPower: 1100, jumpCooldownTicks: 400 });
  const sums: number[] = [];
  for (let t = 0; t < ticks; t++) {
    if (t === 240) activateBooster(sim, "quake");
    if (t === 700) activateBooster(sim, "x2");
    if (t === 500 || t === 1200) jump(sim);
    const inp = scriptedInput(t);
    step(sim, inp.x, inp.z);
    if (t % 120 === 0) {
      sums.push(sim.ball.x * 31 + sim.ball.y * 7 + sim.ball.z * 13 + sim.score * 97 + sim.broken * 991);
    }
  }
  return { sums, score: sim.score, broken: sim.broken, depth: sim.depth };
}

describe("determinism", () => {
  it("two identical runs produce bit-identical checksums", () => {
    const a = runAndChecksum(20260901, 2400);
    const b = runAndChecksum(20260901, 2400);
    expect(a.sums).toEqual(b.sums);
    expect(a.score).toBe(b.score);
    expect(a.broken).toBe(b.broken);
    expect(a.depth).toBe(b.depth);
  });

  it("the run exercises gameplay (blocks break, depth grows)", () => {
    const a = runAndChecksum(20260901, 2400);
    expect(a.broken).toBeGreaterThan(3);
    expect(a.score).toBeGreaterThan(0);
    expect(a.depth).toBeGreaterThan(0);
  });

  it("different seeds diverge (generative towers)", () => {
    const a = runAndChecksum(20260901, 1200);
    const b = runAndChecksum(777, 1200);
    expect(a.sums).not.toEqual(b.sums);
  });
});
