// A block has to say what it is. MAGMA once tinted its glass to within 0.16 of
// the bomb's amber, so the two were the same block on screen — players went
// looking for the target mark on blocks that were never bombs. Nothing in the
// code was broken; the palette was.
import { describe, expect, it } from "vitest";
import { BIOMES, FIXED_BLOCK_RGB, type RGB } from "../src/biomes.js";

const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// 0.16 was indistinguishable and 0.36 was still a clash in play. 0.5 sits well
// clear of both and inside what the palettes already manage.
const MIN = 0.5;

describe("biome palettes", () => {
  // Scope on purpose: the pairs a player has to separate at a glance are the
  // two BLOCK types they smash against the two that are special. Mines are
  // spheres and spikes wear cones, so shape carries those; walls are backdrop,
  // not something you aim at.
  it("never tint a block into the colour of a bomb or a bumper", () => {
    const clashes: string[] = [];
    for (const b of BIOMES) {
      for (const [part, rgb] of [
        ["glass", b.glass],
        ["stone", b.stone],
      ] as const) {
        for (const [name, fixed] of Object.entries(FIXED_BLOCK_RGB)) {
          if (name !== "bomb" && name !== "bumper") continue;
          const d = dist(rgb, fixed);
          if (d < MIN) clashes.push(`${b.name} ${part} is ${d.toFixed(2)} from ${name}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps the fixed colours apart from each other too", () => {
    // Except the two reds, which are deliberately kin: a spike and a mine are
    // both "do not touch", and their shapes tell them apart.
    const kin = new Set(["spike|mine", "mine|spike"]);
    const clashes: string[] = [];
    const names = Object.keys(FIXED_BLOCK_RGB);
    for (const a of names) {
      for (const b of names) {
        if (a >= b || kin.has(`${a}|${b}`)) continue;
        const d = dist(FIXED_BLOCK_RGB[a], FIXED_BLOCK_RGB[b]);
        if (d < MIN) clashes.push(`${a} is ${d.toFixed(2)} from ${b}`);
      }
    }
    expect(clashes).toEqual([]);
  });
});
