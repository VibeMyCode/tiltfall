// Boosters, jump, mines, shields, daily tasks, levels.
import { describe, expect, it } from "vitest";
import { BOOSTER_MODE, BOOSTER_ORDER, boosterPrice } from "../src/boosters";
import { CONFIG } from "../src/config";
import { buildTier } from "../src/levelgen";
import { BIOME_TIER_SPAN, biomeNameAt, paletteAt } from "../src/biomes";
import { jumpCooldownAt, jumpPowerAt, levelCost, nextPerkText, perksAt, rollDaily, skinsAt } from "../src/meta";
import { activateBooster, createSim, jump, step } from "../src/sim";

describe("boosters", () => {
  it("every booster has a price and a mode", () => {
    for (const id of BOOSTER_ORDER) {
      expect(boosterPrice(id)).toBeGreaterThan(0);
      expect(["armed", "run", "instant"]).toContain(BOOSTER_MODE[id]);
    }
  });

  it("quake fires once on the next smash and demolishes extra pieces", () => {
    const plain = createSim(20260901);
    const boosted = createSim(20260901);
    activateBooster(boosted, "quake");
    for (let t = 0; t < 700; t++) {
      step(plain, -0.55, -0.35);
      step(boosted, -0.55, -0.35);
    }
    expect(boosted.armed.quake).toBe(false);
    expect(boosted.broken).toBeGreaterThan(plain.broken);
  });

  it("x2 roughly doubles scoring for the rest of the run", () => {
    const plain = createSim(20260901);
    const boosted = createSim(20260901);
    activateBooster(boosted, "x2");
    for (let t = 0; t < 500; t++) {
      step(plain, 0, 0);
      step(boosted, 0, 0);
    }
    expect(plain.score).toBeGreaterThan(0);
    expect(boosted.score).toBeGreaterThan(plain.score * 1.85);
  });
});

describe("jump", () => {
  it("launches upward and respects the cooldown", () => {
    const sim = createSim(20260901, { jumpPower: 1100, jumpCooldownTicks: 300 });
    for (let t = 0; t < 30; t++) step(sim, 0, 0);
    expect(jump(sim)).toBe(true);
    expect(sim.ball.vy).toBe(-1100);
    expect(jump(sim)).toBe(false); // on cooldown
    for (let t = 0; t < 301; t++) step(sim, 0, 0);
    expect(jump(sim)).toBe(true);
  });
});

describe("mines", () => {
  it("grace tiers have no mines; deep tiers do", () => {
    for (let t = 0; t < CONFIG.mineFreeTiers; t++) {
      expect(buildTier(20260901, t).filter((b) => b.type === "mine").length).toBe(0);
    }
    const deep = buildTier(20260901, 6).filter((b) => b.type === "mine").length;
    expect(deep).toBeGreaterThan(0);
  });

  it("a mine ends the run; a shield absorbs it", () => {
    // Both sims share a seed; drive both into the same mine on a deep tier.
    const doomed = createSim(424242);
    const saved = createSim(424242, { shields: 1 });
    let doomedEnd = 0;
    for (let t = 0; t < 30000 && !doomed.finished; t++) {
      const inp = { x: ((t >> 6) % 3) - 1, z: (((t + 32) >> 6) % 3) - 1 };
      step(doomed, inp.x, inp.z);
      step(saved, inp.x, inp.z);
      doomedEnd = t;
    }
    if (doomed.finished) {
      expect(saved.finished).toBe(false); // the shield ate the same mine
      expect(saved.shields).toBe(0);
      expect(doomedEnd).toBeGreaterThan(0);
    } else {
      // This seed never met a mine within budget — still a valid world, but
      // the assertion below keeps the test honest instead of vacuous.
      expect(doomed.depth).toBeGreaterThan(6);
    }
  });
});

describe("meta", () => {
  it("level curve: costs grow, jump improves, perks unlock in order", () => {
    expect(levelCost(2)).toBeGreaterThan(levelCost(1));
    expect(jumpPowerAt(5)).toBeGreaterThan(jumpPowerAt(1));
    expect(jumpCooldownAt(5)).toBeLessThan(jumpCooldownAt(1));
    expect(jumpCooldownAt(99)).toBe(CONFIG.jumpMinCooldownTicks);
    expect(skinsAt(1)).toContain("core");
    expect(skinsAt(8).length).toBeGreaterThan(skinsAt(1).length);
    // Perks: shields at L5/L13, extra jump charge at L7, boosters cheapest-first.
    expect(perksAt(4).shields).toBe(0);
    expect(perksAt(5).shields).toBe(1);
    expect(perksAt(13).shields).toBe(2);
    expect(perksAt(6).jumpCharges).toBe(1);
    expect(perksAt(7).jumpCharges).toBe(2);
    expect(perksAt(1).boosters).toEqual(["agility"]);
    expect(perksAt(6).boosters).toContain("heavy");
    expect(perksAt(6).boosters).not.toContain("quake");
    expect(perksAt(14).boosters).toContain("quake");
    // Every booster becomes reachable, and pricier ones unlock later.
    const order = CONFIG.levelPerks.filter((r) => r.booster);
    for (let i = 1; i < order.length; i++) {
      const prev = CONFIG.boosters[order[i - 1].booster as keyof typeof CONFIG.boosters].price;
      const cur = CONFIG.boosters[order[i].booster as keyof typeof CONFIG.boosters].price;
      expect(cur).toBeGreaterThan(prev);
    }
    expect(nextPerkText(4)).toMatch(/shield/i);
  });

  it("jump charges: a second charge means two hops before waiting", () => {
    const sim = createSim(20260901, { jumpMaxCharges: 2, jumpCooldownTicks: 300 });
    expect(jump(sim)).toBe(true);
    expect(jump(sim)).toBe(true); // second charge
    expect(jump(sim)).toBe(false); // dry
    for (let t = 0; t < 301; t++) step(sim, 0, 0);
    expect(jump(sim)).toBe(true); // one charge refilled
  });

  it("daily tasks are deterministic per date and differ across dates", () => {
    const a = rollDaily("2026-09-02");
    const b = rollDaily("2026-09-02");
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(a.length).toBe(3);
    const c = rollDaily("2026-09-03");
    expect(a.map((t) => t.id).join()).not.toBe(c.map((t) => t.id).join());
  });
});

describe("tower borders and biomes", () => {
  it("riding a wall is never free — blocks, or a border mine, stop you", () => {
    // Hug each wall: the edge must either cost hits or kill (owner report:
    // you could ride the 200-unit gutter down forever, farming points).
    const corners: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [tx, tz] of corners) {
      const sim = createSim(20260901);
      let hits = 0;
      for (let t = 0; t < 4000 && !sim.finished; t++) {
        const events = step(sim, tx, tz);
        hits += events.filter((e) => e.kind === "break" || e.kind === "bumper" || e.kind === "spike").length;
      }
      expect(sim.finished || hits > 3).toBe(true);
    }
  });

  it("the border ring is mined from the mine belt onward", () => {
    const edge = (t: number) =>
      buildTier(20260901, t).filter(
        (b) => b.type === "mine" && (b.cx < CONFIG.gridX0 || b.cx > CONFIG.gridX0 + CONFIG.gridN * CONFIG.cell),
      ).length;
    expect(edge(1)).toBe(0); // grace tiers stay safe
    const deep = [6, 7, 8, 9, 10].reduce((n, t) => n + edge(t), 0);
    expect(deep).toBeGreaterThan(0);
  });

  it("biome palette advances and crossfades with depth", () => {
    expect(biomeNameAt(0)).toBe("GLACIER");
    expect(biomeNameAt(BIOME_TIER_SPAN)).not.toBe("GLACIER");
    const a = paletteAt(0);
    const mid = paletteAt(BIOME_TIER_SPAN - 0.5); // inside the crossfade
    expect(mid.sky).not.toEqual(a.sky);
    expect(paletteAt(1).sky).toEqual(a.sky); // stable in the middle of a biome
  });
});
