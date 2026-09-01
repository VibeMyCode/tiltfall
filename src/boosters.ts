// Boosters (owner design): bought AFTER a run with banked score, activated
// mid-run on demand, each lasting boosterTicks. Pure module — the single
// place booster effects turn into numbers.
import { CONFIG } from "./config";

export type BoosterId = "quake" | "chain" | "x2" | "heavy" | "bounce" | "feather";

export const BOOSTER_ORDER: BoosterId[] = ["quake", "chain", "x2", "heavy", "bounce", "feather"];

export const BOOSTER_INFO: Record<BoosterId, { name: string; icon: string; desc: string; color: string }> = {
  quake: { name: "QUAKE", icon: "💥", desc: "Every smash blasts a wide area", color: "#ffb347" },
  chain: { name: "CHAIN BOMB", icon: "🧨", desc: "Bombs chain far — in slow motion", color: "#ffd23f" },
  x2: { name: "SCORE ×2", icon: "×2", desc: "Double points", color: "#ffe08a" },
  heavy: { name: "HEAVY", icon: "🪨", desc: "Smash stone in one hit", color: "#b9c0d4" },
  bounce: { name: "BOUNCE", icon: "🏀", desc: "Big hop after every smash", color: "#b48cff" },
  feather: { name: "FEATHER", icon: "🪶", desc: "Razor-sharp steering", color: "#9fe8ff" },
};

export function boosterPrice(id: BoosterId): number {
  return CONFIG.boosters[id].price;
}

export interface BoosterParams {
  massMul: number;
  kTiltMul: number;
  breakBounce: number;
  scoreMul: number;
  blastMul: number;
  quakeCells: number; // 0 = off
}

// Aggregate all currently-active boosters (timers = remaining ticks).
export function boosterParams(timers: Partial<Record<BoosterId, number>>): BoosterParams {
  const B = CONFIG.boosters;
  const on = (id: BoosterId) => (timers[id] ?? 0) > 0;
  return {
    massMul: on("heavy") ? B.heavy.massMul : 1,
    kTiltMul: (on("heavy") ? B.heavy.tiltMul : 1) * (on("feather") ? B.feather.tiltMul : 1),
    breakBounce: on("bounce") ? B.bounce.breakBounce : CONFIG.breakBounce,
    scoreMul: on("x2") ? B.x2.scoreMul : 1,
    blastMul: on("chain") ? B.chain.blastMul : 1,
    quakeCells: on("quake") ? B.quake.blastCells : 0,
  };
}
