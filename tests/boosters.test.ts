// Booster economy: one-shot arming, run-long effects, tower playability.
import { describe, expect, it } from "vitest";
import { BOOSTER_MODE, BOOSTER_ORDER, boosterPrice } from "../src/boosters";
import { buildTower, validateTower } from "../src/levelgen";
import { activateBooster, createSim, step } from "../src/sim";

const layout = buildTower(20260901);

describe("boosters", () => {
  it("every booster has a price and a mode", () => {
    for (const id of BOOSTER_ORDER) {
      expect(boosterPrice(id)).toBeGreaterThan(0);
      expect(["armed", "run"]).toContain(BOOSTER_MODE[id]);
    }
  });

  it("quake fires once on the next smash and demolishes extra pieces", () => {
    const plain = createSim(layout);
    const boosted = createSim(layout);
    activateBooster(boosted, "quake");
    expect(boosted.armed.quake).toBe(true);
    for (let t = 0; t < 700; t++) {
      step(plain, -0.55, -0.35);
      step(boosted, -0.55, -0.35);
    }
    expect(boosted.armed.quake).toBe(false); // consumed
    expect(boosted.broken).toBeGreaterThan(plain.broken);
  });

  it("bounce launches the ball up like a bumper on the next smash", () => {
    const sim = createSim(layout);
    activateBooster(sim, "bounce");
    let launched = false;
    for (let t = 0; t < 700 && !launched; t++) {
      const events = step(sim, 0, 0);
      if (events.some((e) => e.kind === "break") && !sim.armed.bounce) {
        launched = sim.ball.vy < -900; // flying UP hard
        break;
      }
    }
    expect(launched).toBe(true);
  });

  it("x2 doubles scoring for the rest of the run", () => {
    const plain = createSim(layout);
    const boosted = createSim(layout);
    activateBooster(boosted, "x2");
    for (let t = 0; t < 500; t++) {
      step(plain, 0, 0);
      step(boosted, 0, 0);
    }
    expect(plain.score).toBeGreaterThan(0);
    // Flat bumper points are never multiplied (§3.5), so "close to 2×".
    expect(boosted.score).toBeGreaterThan(plain.score * 1.85);
    expect(boosted.score).toBeLessThanOrEqual(plain.score * 2);
    expect(boosted.runOn.x2).toBe(true); // never expires mid-run
  });

  it("feather steers visibly harder", () => {
    const plain = createSim(layout);
    const boosted = createSim(layout);
    activateBooster(boosted, "feather");
    for (let t = 0; t < 60; t++) {
      step(plain, 1, 0);
      step(boosted, 1, 0);
    }
    // Short window so neither run reaches a wall.
    expect(boosted.ball.x - 650).toBeGreaterThan((plain.ball.x - 650) * 1.4);
  });

  it("tower stays finishable by probes", () => {
    const v = validateTower(layout);
    expect(v.ok).toBe(true);
    expect(v.medianTicks).toBeGreaterThan(0);
  });
});
