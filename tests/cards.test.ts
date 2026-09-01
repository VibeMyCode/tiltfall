// §3.4: gate offers are a pure function of (towerSeed, gateIndex); card
// effects flow only through cardParams.
import { describe, expect, it } from "vitest";
import { CARD_POOL, cardParams, gateOffers } from "../src/cards";
import { CONFIG } from "../src/config";
import { buildTower, validateTower } from "../src/levelgen";
import { applyCard, createSim, step } from "../src/sim";

describe("cards", () => {
  it("offers are deterministic and distinct", () => {
    for (let g = 0; g < 4; g++) {
      const a = gateOffers(20260901, g);
      const b = gateOffers(20260901, g);
      expect(a).toEqual(b);
      expect(new Set(a).size).toBe(3);
      a.forEach((c) => expect(CARD_POOL).toContain(c));
    }
    expect(gateOffers(20260901, 0)).not.toEqual(gateOffers(777, 0));
  });

  it("cardParams maps every card, defaults are neutral", () => {
    const base = cardParams(null);
    expect(base.massMul).toBe(1);
    expect(base.blastMul).toBe(1);
    expect(cardParams("heavy").massMul).toBeGreaterThan(1);
    expect(cardParams("feather").kTiltMul).toBeGreaterThan(1);
    expect(cardParams("chain").blastMul).toBeGreaterThan(1);
    expect(cardParams("pogo").breakBounce).toBeGreaterThan(CONFIG.breakBounce);
    expect(cardParams("surge").comboWindowTicks).toBe(CONFIG.comboWindowTicks * 2);
    expect(cardParams("pierce").pierce).toBe(true);
    expect(cardParams("shockwave").shock).toBe(true);
  });

  it("a straight drop reaches gate 0 and the pick releases the ball", () => {
    const layout = buildTower(20260901);
    const sim = createSim(layout);
    let gateSeen = -1;
    for (let t = 0; t < 6000 && gateSeen < 0; t++) {
      for (const e of step(sim, 0, 0)) {
        if (e.kind === "gate" && e.gateIndex !== undefined) gateSeen = e.gateIndex;
      }
    }
    expect(gateSeen).toBe(0);
    expect(sim.gatePhase).toBe("wait");
    const tickAtGate = sim.tick;
    step(sim, 0, 0);
    expect(sim.tick).toBe(tickAtGate); // frozen while waiting
    applyCard(sim, gateOffers(20260901, 0)[0]);
    expect(sim.gatesPassed).toBe(1);
    step(sim, 0, 0);
    expect(sim.tick).toBe(tickAtGate + 1);
  });

  it("tower validation passes and produces a positive par", () => {
    const layout = buildTower(20260901);
    const v = validateTower(20260901, layout);
    expect(v.ok).toBe(true);
    expect(v.parTicks).toBeGreaterThan(0);
  });
});
