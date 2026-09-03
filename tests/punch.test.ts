// Owner rule for breaking a block from above:
//
//              bare ball              HEAVY
//   glass      through, brakes        through, barely slowed
//   bomb       through, brakes more   through, brakes like glass
//   stone      thrown back up         through, brakes like glass
//
// Tested on a hand-placed single block so the outcome is the rule and not the
// tower's luck.
import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { activateBooster, createSim, step, type SimState } from "../src/sim";

// One block directly under the ball, nothing else in the shaft.
function dropOnto(type: "glass" | "stone" | "bomb", heavy = false): SimState {
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

  it("a bomb costs more speed than a pane of glass", () => {
    // Both let the ball through; the blast is what makes it the slower way.
    expect(vyAfterBreak(dropOnto("bomb"))).toBeLessThan(vyAfterBreak(dropOnto("glass")));
    expect(vyAfterBreak(dropOnto("bomb"))).toBeGreaterThan(0); // through, not back
  });

  it("HEAVY promotes a bomb to the glass rung", () => {
    expect(vyAfterBreak(dropOnto("bomb", true))).toBeGreaterThan(vyAfterBreak(dropOnto("bomb")));
  });

  it("HEAVY barely slows on glass, a bare ball pays for the hitch", () => {
    // Same fall, same block: the lead ball keeps more of its speed, and that
    // difference is what the player feels as the hitch on a normal punch.
    expect(vyAfterBreak(dropOnto("glass", true))).toBeGreaterThan(vyAfterBreak(dropOnto("glass")));
  });
});
