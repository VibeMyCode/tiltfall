// §5.4: same layout + same input log ⇒ identical simulation, checked via
// state checksums every 120 ticks across 2400 ticks (includes breaks,
// cascades, wall bounces and the finish).
import { describe, expect, it } from "vitest";
import { gateOffers } from "../src/cards";
import { buildTower } from "../src/levelgen";
import { applyCard, createSim, step } from "../src/sim";

// Scripted input log: pure function of tick — swings the tilt around enough
// to hit walls, blocks and open gaps.
function scriptedInput(tick: number): { x: number; z: number } {
  if (tick < 160) return { x: 0, z: 0 }; // straight drop → guaranteed tier-0 cascade
  const phase = tick >> 7; // changes every ~1.07 s
  const x = ((phase % 4) - 1.5) * 0.6; // -0.9, -0.3, 0.3, 0.9
  const z = (((phase >> 1) % 3) - 1) * 0.5;
  return { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 };
}

function runAndChecksum(seed: number, ticks: number): { sums: number[]; score: number; broken: number } {
  const sim = createSim(buildTower(seed));
  const sums: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const inp = scriptedInput(t);
    const events = step(sim, inp.x, inp.z);
    // Replay protocol: gates are answered with the second offer, instantly.
    for (const e of events) {
      if (e.kind === "gate" && e.gateIndex !== undefined) applyCard(sim, gateOffers(seed, e.gateIndex)[1]);
    }
    if (t % 120 === 0) {
      sums.push(sim.ball.x * 31 + sim.ball.y * 7 + sim.ball.z * 13 + sim.score * 97 + sim.broken * 991);
    }
  }
  return { sums, score: sim.score, broken: sim.broken };
}

describe("determinism", () => {
  it("two identical runs produce bit-identical checksums", () => {
    const a = runAndChecksum(20260901, 2400);
    const b = runAndChecksum(20260901, 2400);
    expect(a.sums).toEqual(b.sums);
    expect(a.score).toBe(b.score);
    expect(a.broken).toBe(b.broken);
  });

  it("the run actually exercises gameplay (blocks break, score accrues)", () => {
    const a = runAndChecksum(20260901, 2400);
    expect(a.broken).toBeGreaterThan(3); // spawn sits over the tier-0 support
    expect(a.score).toBeGreaterThan(0);
  });

  it("different seeds diverge", () => {
    const a = runAndChecksum(20260901, 1200);
    const b = runAndChecksum(777, 1200);
    expect(a.sums).not.toEqual(b.sums);
  });
});
