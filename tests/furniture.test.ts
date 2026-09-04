// Owner rule: every tier carries the same three bumpers and three spikes. What
// escalates with depth is the mines, not the furniture — spikes used to ramp
// from zero, so the tier that taught the game was not the game.
import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import { buildTier } from "../src/levelgen.js";

const count = (seed: number, tier: number, type: string) =>
  buildTier(seed, tier).filter((b) => b.primary && b.type === type).length;

describe("tier furniture", () => {
  it("places the configured bumpers and spikes on every tier, from the first", () => {
    const wrong: string[] = [];
    for (const seed of [1, 7, 4242, 20260904]) {
      for (let tier = 0; tier < 14; tier++) {
        for (const [type, want] of [
          ["bumper", CONFIG.bumpersPerTier],
          ["spike", CONFIG.spikesPerTier],
          ["bomb", 1], // exactly one target per tier, the thing you aim at
        ] as const) {
          const got = count(seed, tier, type);
          if (got !== want) wrong.push(`seed ${seed} tier ${tier}: ${got} ${type}, wanted ${want}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
