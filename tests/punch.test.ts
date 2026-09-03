// Owner rule for breaking a block from above:
//
//              bare ball          HEAVY
//   glass      punch through      punch through, barely slowed
//   stone      bounce back up     punch through
//
// Tested on a hand-placed single block so the outcome is the rule and not the
// tower's luck.
import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { activateBooster, createSim, step, type SimState } from "../src/sim";

// One block directly under the ball, nothing else in the shaft.
function dropOnto(type: "glass" | "stone", heavy = false): SimState {
  const s = createSim(20260903);
  if (heavy) activateBooster(s, "heavy");
  const { x, z } = s.ball;
  const cy = s.ball.y + 400;
  s.blocks = [
    {
      id: 1,
      groupId: 1,
      type,
      primary: true,
      cells: 1,
      cx: x,
      cy,
      cz: z,
      hx: 150,
      hy: 60,
      hz: 150,
      threshold: CONFIG.thresholds[type],
      broken: false,
      tier: 0,
    } as SimState["blocks"][number],
  ];
  return s;
}

// Steps until the block breaks, then reports the ball's vertical velocity on
// the very next tick. Positive is falling (Y grows downward).
function vyAfterBreak(s: SimState): number {
  for (let i = 0; i < 600; i++) {
    step(s, 0, 0);
    if (s.blocks[0].broken) return s.ball.vy;
  }
  throw new Error("the block never broke");
}

describe("punching through", () => {
  it("glass lets the ball through instead of throwing it back", () => {
    expect(vyAfterBreak(dropOnto("glass"))).toBeGreaterThan(0);
  });

  it("stone throws the ball back up", () => {
    expect(vyAfterBreak(dropOnto("stone"))).toBeLessThan(0);
  });

  it("HEAVY punches stone too", () => {
    expect(vyAfterBreak(dropOnto("stone", true))).toBeGreaterThan(0);
  });

  it("HEAVY barely slows on glass, a bare ball pays for the hitch", () => {
    // Same fall, same block: the lead ball keeps more of its speed, and that
    // difference is what the player feels as the hitch on a normal punch.
    expect(vyAfterBreak(dropOnto("glass", true))).toBeGreaterThan(vyAfterBreak(dropOnto("glass")));
  });
});
