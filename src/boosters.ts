// Boosters (owner design v2): bought from the BANK, activated on demand.
// "armed" fire once on the next smash; "run" last until game over;
// "instant" apply immediately (shield). Pure module.
import { CONFIG } from "./config.js";

export type BoosterId = "quake" | "chain" | "x2" | "heavy" | "shield" | "agility";

export const BOOSTER_ORDER: BoosterId[] = ["quake", "chain", "x2", "heavy", "shield", "agility"];

export const BOOSTER_MODE: Record<BoosterId, "armed" | "run" | "instant"> = {
  quake: "armed",
  chain: "armed",
  x2: "run",
  heavy: "run",
  shield: "instant",
  agility: "run",
};

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const BOOSTER_INFO: Record<BoosterId, { name: string; svg: string; desc: string; color: string }> = {
  quake: {
    name: "QUAKE",
    svg: svg(
      '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M12 2.5v4.2M12 17.3v4.2M2.5 12h4.2M17.3 12h4.2M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
    ),
    desc: "Next smash blasts a huge area — slow motion",
    color: "#ffb347",
  },
  chain: {
    name: "CHAIN BOMB",
    svg: svg(
      '<circle cx="9.5" cy="14.5" r="6" fill="currentColor"/><path d="M13.5 10.5L17 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 7l2.2-1.2M17 7l1.2 2.2M17 7l.4-2.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    ),
    desc: "Next smash detonates a mega-chain — slow motion",
    color: "#ffd23f",
  },
  x2: {
    name: "SCORE ×2",
    svg: svg(
      '<text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="900" font-family="system-ui" fill="currentColor">×2</text>',
    ),
    desc: "Double points until game over",
    color: "#ffe08a",
  },
  heavy: {
    name: "HEAVY",
    svg: svg(
      '<path d="M5.5 16.5l1.8-6.2L11 7l5.5 1.6 2 5.4-2.8 4.5H8z" fill="currentColor"/><path d="M9 11.5l2.5 1.5 3-1" stroke="#0c1020" stroke-width="1.3" fill="none"/>',
    ),
    desc: "Lead ball until game over: stone breaks like glass",
    color: "#b9c0d4",
  },
  shield: {
    name: "SHIELD",
    svg: svg('<path d="M12 2.5l7 3v6c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10v-6z" fill="currentColor"/>'),
    desc: "Survive one mine this run",
    color: "#7dffb3",
  },
  agility: {
    name: "AGILITY",
    svg: svg('<path d="M13 2L5.5 13H10l-2 9 9.5-12.5H12.5L13 2z" fill="currentColor"/>'),
    desc: "Razor steering until game over",
    color: "#9fe8ff",
  },
};

export function boosterPrice(id: BoosterId): number {
  return CONFIG.boosters[id].price;
}
