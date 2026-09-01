// Draft cards (§3.4): definitions, deterministic gate offers, and the single
// application point cardParams(). Pure module — no Babylon, no wall-clock.
import { CONFIG } from "./config";
import { stream } from "./rng";

export type CardId = "shockwave" | "heavy" | "feather" | "chain" | "pogo" | "bouncy" | "pierce" | "surge";

export const CARD_POOL: CardId[] = ["shockwave", "heavy", "feather", "chain", "pogo", "bouncy", "pierce", "surge"];

export const CARD_INFO: Record<CardId, { name: string; desc: string; color: string }> = {
  shockwave: { name: "SHOCKWAVE", desc: "Breaks also blast nearby pieces — wider as your chain grows", color: "#ffb347" },
  heavy: { name: "HEAVYWEIGHT", desc: "Smash stone in one hit; steering a bit stiffer", color: "#b9c0d4" },
  feather: { name: "FEATHERLIGHT", desc: "Nimble steering; lighter impacts", color: "#9fe8ff" },
  chain: { name: "CHAIN REACTOR", desc: "Bomb blasts reach much further", color: "#ffd23f" },
  pogo: { name: "POGO", desc: "Big hop after every smash — more air time to aim", color: "#b48cff" },
  bouncy: { name: "BOUNCY", desc: "Everything bounces harder", color: "#7dffb3" },
  pierce: { name: "PIERCER", desc: "First 6 pieces break without slowing you at all", color: "#ff7d9c" },
  surge: { name: "COMBO SURGE", desc: "Combo window twice as long", color: "#ffe08a" },
};

// The 3 offers at a gate — drawn from (towerSeed, gateIndex) only, so they
// are identical for every player on the same tower (§3.4).
export function gateOffers(seed: number, gateIndex: number): CardId[] {
  const rng = stream(`gate${gateIndex}`, seed);
  const pool = [...CARD_POOL];
  const out: CardId[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

export interface CardParams {
  massMul: number;
  kTiltMul: number;
  restAdd: number;
  breakBounce: number;
  comboWindowTicks: number;
  blastMul: number;
  pierce: boolean;
  shock: boolean;
}

// The ONLY place card effects turn into numbers (§3.4 effectiveRunConfig).
export function cardParams(card: CardId | null): CardParams {
  const C = CONFIG;
  const p: CardParams = {
    massMul: 1,
    kTiltMul: 1,
    restAdd: 0,
    breakBounce: C.breakBounce,
    comboWindowTicks: C.comboWindowTicks,
    blastMul: 1,
    pierce: false,
    shock: false,
  };
  switch (card) {
    case "heavy":
      p.massMul = C.cards.heavyMassMul;
      p.kTiltMul = C.cards.heavyTiltMul;
      break;
    case "feather":
      p.massMul = C.cards.featherMassMul;
      p.kTiltMul = C.cards.featherTiltMul;
      break;
    case "chain":
      p.blastMul = C.cards.chainBlastMul;
      break;
    case "pogo":
      p.breakBounce = C.cards.pogoBounce;
      break;
    case "bouncy":
      p.restAdd = C.cards.bouncyRestAdd;
      break;
    case "pierce":
      p.pierce = true;
      break;
    case "surge":
      p.comboWindowTicks = C.comboWindowTicks * C.cards.surgeWindowMul;
      break;
    case "shockwave":
      p.shock = true;
      break;
  }
  return p;
}
