// The leaderboard is only worth having if a replay reproduces a run exactly,
// so that is the first thing tested here; the rest is what a tampered proof
// must not be able to do.
import { describe, expect, it } from "vitest";
import { createRecorder, replayScore, type RunProof } from "../src/replay";
import { createSim, jump, step } from "../src/sim";

// Plays a run the way main.ts does: tilt quantized to 1/1000 (which is what
// input.sample and driveTilt both emit), recorded and stepped with the same
// value, and a jump every so often.
function playAndRecord(seed: number, shields = 0, charges = 1) {
  const sim = createSim(seed, { shields, jumpMaxCharges: charges });
  const rec = createRecorder(seed, shields, charges);
  for (let i = 0; i < 20000 && !sim.finished; i++) {
    const x = Math.round(Math.sin(i / 97) * 1000) / 1000;
    const z = Math.round(Math.cos(i / 131) * 1000) / 1000;
    if (i % 400 === 399) {
      // Twice in one tick on purpose: one charge refuses the second, two do not.
      for (let k = 0; k < 2; k++) {
        rec.event("jump");
        jump(sim);
      }
    }
    rec.tick(x, z);
    step(sim, x, z);
  }
  return { sim, proof: rec.proof() };
}

describe("run proofs", () => {
  it("a recorded run replays to exactly the same score", () => {
    for (const seed of [20260903, 7, 424242]) {
      const { sim, proof } = playAndRecord(seed);
      const r = replayScore(proof);
      expect(r).not.toBeNull();
      expect(r!.score).toBe(sim.score);
      expect(r!.depth).toBe(sim.depth);
      expect(r!.blocks).toBe(sim.broken);
    }
  });

  it("carries the perks, which change the run", () => {
    // Same seed, same tilt, same jump ticks — only the charge count differs. If
    // the replay ignored perks these would agree and the test would prove
    // nothing.
    const plain = replayScore(playAndRecord(20260903, 0, 1).proof)!;
    const perked = replayScore(playAndRecord(20260903, 2, 2).proof)!;
    expect(perked).not.toEqual(plain);
  });

  it("refuses tilt beyond what the game can produce", () => {
    // One tick of 1.900 tilt — steering nearly twice as hard as a full drag.
    const v = new DataView(new ArrayBuffer(4));
    v.setInt16(0, 1900, true);
    v.setInt16(2, 0, true);
    const tilt = btoa(String.fromCharCode(...new Uint8Array(v.buffer)));
    expect(replayScore({ ...playAndRecord(7).proof, tilt })).toBeNull();
  });

  it("rejects malformed proofs instead of trusting them", () => {
    const { proof } = playAndRecord(7);
    expect(replayScore({ ...proof, tilt: "not base64 @@@" })).toBeNull();
    expect(replayScore({ ...proof, tilt: "AAA" })).toBeNull(); // not a whole tick
    expect(replayScore({ ...proof, tilt: "" })).toBeNull();
    expect(replayScore({ ...proof, seed: NaN })).toBeNull();
    expect(replayScore(null as unknown as RunProof)).toBeNull();
  });

  it("clamps perks so a claimed level 99 buys nothing", () => {
    const honest = replayScore(playAndRecord(20260903, 2, 2).proof)!;
    const greedy = replayScore({ ...playAndRecord(20260903, 2, 2).proof, shields: 99, charges: 99 })!;
    // Clamped back to the perk table's ceiling, so the run is the same one.
    expect(greedy.score).toBe(honest.score);
    expect(greedy.ticks).toBe(honest.ticks);
  });
});
