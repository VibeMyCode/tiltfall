// Booster economy + tower playability.
import { describe, expect, it } from "vitest";
import { BOOSTER_ORDER, boosterParams, boosterPrice } from "../src/boosters";
import { CONFIG } from "../src/config";
import { buildTower, validateTower } from "../src/levelgen";
import { activateBooster, createSim, step } from "../src/sim";

describe("boosters", () => {
  it("every booster has a price and distinct params", () => {
    for (const id of BOOSTER_ORDER) expect(boosterPrice(id)).toBeGreaterThan(0);
    const base = boosterParams({});
    expect(base.massMul).toBe(1);
    expect(base.scoreMul).toBe(1);
    expect(base.quakeCells).toBe(0);
    expect(boosterParams({ heavy: 10 }).massMul).toBeGreaterThan(1);
    expect(boosterParams({ feather: 10 }).kTiltMul).toBeGreaterThan(1);
    expect(boosterParams({ x2: 10 }).scoreMul).toBe(2);
    expect(boosterParams({ chain: 10 }).blastMul).toBeGreaterThan(1);
    expect(boosterParams({ quake: 10 }).quakeCells).toBeGreaterThan(0);
    expect(boosterParams({ bounce: 10 }).breakBounce).toBeGreaterThan(CONFIG.breakBounce);
  });

  it("activation runs for boosterTicks and expires", () => {
    const sim = createSim(buildTower(20260901));
    activateBooster(sim, "x2");
    expect(sim.boosterTimers.x2).toBe(CONFIG.boosterTicks);
    for (let t = 0; t < CONFIG.boosterTicks + 2; t++) step(sim, 0, 0);
    expect(sim.boosterTimers.x2).toBe(0);
  });

  it("quake blasts a wide radius around a direct break", () => {
    // Steer away from the tier-0 bomb so the first break is plain glass.
    const layout = buildTower(20260901);
    const plain = createSim(layout);
    const boosted = createSim(layout);
    activateBooster(boosted, "quake");
    for (let t = 0; t < 700; t++) {
      step(plain, -0.55, -0.35);
      step(boosted, -0.55, -0.35);
    }
    expect(boosted.broken).toBeGreaterThan(plain.broken);
  });

  it("tower stays finishable by probes (no gates, no nudge)", () => {
    const v = validateTower(buildTower(20260901));
    expect(v.ok).toBe(true);
    expect(v.medianTicks).toBeGreaterThan(0);
  });
});
