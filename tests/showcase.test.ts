// CHAIN and QUAKE are the two "clear the tier" boosters. What is worth testing
// is the promise, not the radius: after the cascade settles, the tier the ball
// smashed in should be gone — and CHAIN should have drawn the lightning that
// makes the propagation readable.
import { describe, expect, it } from "vitest";
import { activateBooster, createSim, step, type SimEvent, type SimState } from "../src/sim.js";

// Plays until a booster fires and its queue drains, collecting every event.
function runShowcase(booster: "chain" | "quake"): { events: SimEvent[]; sim: SimState } {
  const sim = createSim(20260903);
  activateBooster(sim, booster);
  const events: SimEvent[] = [];
  for (let i = 0; i < 4000; i++) {
    events.push(...step(sim, Math.sin(i / 97), Math.cos(i / 131)));
    // Stop once the booster has fired and everything it queued has resolved.
    if (sim.chainBlastTick > 0 && sim.queue.length === 0 && sim.tick > sim.chainBlastTick + 4) break;
  }
  return { events, sim };
}

const tierOf = (cy: number) => Math.round(cy / 2400);

describe("tier-clearing boosters", () => {
  for (const booster of ["chain", "quake"] as const) {
    it(`${booster} leaves nothing breakable standing on the tier it fires in`, () => {
      const { sim } = runShowcase(booster);
      expect(sim.chainBlastTick).toBeGreaterThan(0); // it actually fired

      // The tier that took the hit: the one holding the most broken blocks.
      const tally = new Map<number, number>();
      for (const b of sim.blocks) {
        if (b.broken) tally.set(tierOf(b.cy), (tally.get(tierOf(b.cy)) ?? 0) + 1);
      }
      const hit = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];

      const left = sim.blocks.filter(
        (b) => !b.broken && tierOf(b.cy) === hit && b.threshold !== Infinity,
      );
      expect(left).toEqual([]);
    });
  }

  it("chain draws lightning from each blast to the next, quake does not", () => {
    expect(runShowcase("chain").events.filter((e) => e.kind === "arc").length).toBeGreaterThan(3);
    expect(runShowcase("quake").events.filter((e) => e.kind === "arc")).toEqual([]);
  });

  it("quake asks for the shake, chain does not", () => {
    expect(runShowcase("quake").events.some((e) => e.kind === "shake")).toBe(true);
    expect(runShowcase("chain").events.some((e) => e.kind === "shake")).toBe(false);
  });
});
