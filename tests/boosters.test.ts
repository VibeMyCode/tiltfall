// Boosters, jump, mines, shields, daily tasks, levels.
import { describe, expect, it } from "vitest";
import { BOOSTER_MODE, BOOSTER_ORDER, boosterPrice } from "../src/boosters";
import { CONFIG } from "../src/config";
import { buildTier } from "../src/levelgen";
import { BIOME_TIER_SPAN, biomeNameAt, paletteAt } from "../src/biomes";
import { levelCost, nextPerkText, perksAt, rollDaily, skinsAt } from "../src/meta";
import { activateBooster, createSim, driveTilt, jump, step } from "../src/sim";

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

describe("daily rerolls", () => {
  it("leaves an unrerolled day exactly as it was", () => {
    // Players mid-day must not have their tasks shuffled by a deploy.
    expect(rollDaily("2026-09-04", 0)).toEqual(rollDaily("2026-09-04"));
  });

  it("gives a different set each time one is bought", () => {
    const seen = new Set<string>();
    for (let roll = 0; roll < 5; roll++) {
      seen.add(
        rollDaily("2026-09-04", roll)
          .map((t) => t.id)
          .join(","),
      );
    }
    // Paying for the same three tasks back would be the one unacceptable result.
    expect(seen.size).toBeGreaterThan(3);
  });

  it("still hands out three tasks however many rerolls deep", () => {
    for (const roll of [0, 1, 7, 40]) expect(rollDaily("2026-09-04", roll)).toHaveLength(3);
  });
});

describe("steering", () => {
  it("the drive spring is damped enough to arrive instead of orbiting", () => {
    // Closed loop for the lateral axis: acceleration is g0*kTilt at full tilt,
    // the P gain is 1/targetGainDist and the D gain is 1/targetGainVel, so
    //   zeta = sqrt(g0*kTilt*targetGainDist) / (2*targetGainVel).
    // The shipped 420/2600 gave 0.17 — 52% overshoot, still swinging after six
    // seconds. Under ~0.55 the ball visibly circles the finger; over ~1.1 it
    // stops feeling responsive.
    const zeta =
      Math.sqrt(CONFIG.g0 * CONFIG.kTilt * CONFIG.targetGainDist) / (2 * CONFIG.targetGainVel);
    expect(zeta).toBeGreaterThan(0.55);
    expect(zeta).toBeLessThan(1.1);
  });

  it("brakes while closing fast on the target, and pulls toward a still one", () => {
    const still = { x: 0, z: 0, vx: 0, vz: 0 };
    const none = { x: 0, z: 0 };
    expect(driveTilt(still, { x: 200, z: 0 }, none).x).toBeGreaterThan(0);
    // Same target, but already racing at it: the controller must be braking.
    const racing = { x: 0, z: 0, vx: 900, vz: 0 };
    expect(driveTilt(racing, { x: 200, z: 0 }, none).x).toBeLessThan(0);
  });
});

describe("meta", () => {
  it("level curve: costs grow, jump improves, perks unlock in order", () => {
    expect(levelCost(2)).toBeGreaterThan(levelCost(1));
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
    // Every booster becomes reachable, and pricier ones unlock later. Equal
    // prices are allowed: the property is that the order never goes DOWN, and
    // two boosters of the same worth may sit at the same price.
    const order = CONFIG.levelPerks.filter((r) => r.booster);
    for (let i = 1; i < order.length; i++) {
      const prev = CONFIG.boosters[order[i - 1].booster as keyof typeof CONFIG.boosters].price;
      const cur = CONFIG.boosters[order[i].booster as keyof typeof CONFIG.boosters].price;
      expect(cur).toBeGreaterThanOrEqual(prev);
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

  it("spamming the jump slows the fall but never climbs the tower", () => {
    // The exploit this guards: if the jump recharged faster than the ball takes
    // to fall back, a player could hold altitude forever and farm a safe pocket
    // instead of descending. One hop lifts the ball power²/2g ≈ 156 units — what
    // must never happen is that lift accumulating across hops.
    const oneHop = (CONFIG.jumpBasePower * CONFIG.jumpBasePower) / (2 * CONFIG.g0);
    for (const seed of [20260902, 7, 99]) {
      const sim = createSim(seed);
      const startY = sim.ball.y;
      let peak = sim.ball.y; // Y grows downward, so the high point is the minimum
      for (let t = 0; t < 120 * 30 && !sim.finished; t++) {
        jump(sim); // false while recharging — this is the fastest legal rate
        step(sim, 0, 0);
        peak = Math.min(peak, sim.ball.y);
      }
      expect(startY - peak).toBeLessThan(oneHop * 1.5);
      expect(sim.ball.y).toBeGreaterThan(startY + 1000);
    }
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
