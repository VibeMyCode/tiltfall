// Boosters (owner design): bought from the BANK, activated on demand.
// "armed" boosters fire once on the next matching hit; "run" boosters last
// until the run ends. Pure module — the single place effects become numbers.
import { CONFIG } from "./config";

export type BoosterId = "quake" | "chain" | "x2" | "heavy" | "bounce" | "feather";

export const BOOSTER_ORDER: BoosterId[] = ["quake", "chain", "x2", "heavy", "bounce", "feather"];

export const BOOSTER_MODE: Record<BoosterId, "armed" | "run"> = {
  quake: "armed",
  chain: "armed",
  heavy: "armed",
  bounce: "armed",
  x2: "run",
  feather: "run",
};

// Hand-drawn inline SVG icons in the game's neon style (no emoji, no assets).
const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const BOOSTER_INFO: Record<BoosterId, { name: string; svg: string; desc: string; color: string }> = {
  quake: {
    name: "QUAKE",
    svg: svg(
      '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M12 2.5v4.2M12 17.3v4.2M2.5 12h4.2M17.3 12h4.2M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
    ),
    desc: "Next smash blasts a huge area",
    color: "#ffb347",
  },
  chain: {
    name: "CHAIN BOMB",
    svg: svg(
      '<circle cx="9.5" cy="14.5" r="6" fill="currentColor"/><path d="M13.5 10.5L17 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M17 7l2.2-1.2M17 7l1.2 2.2M17 7l.4-2.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    ),
    desc: "Next smash detonates a mega-chain, slow-mo",
    color: "#ffd23f",
  },
  x2: {
    name: "SCORE ×2",
    svg: svg(
      '<text x="12" y="16.5" text-anchor="middle" font-size="13" font-weight="900" font-family="system-ui" fill="currentColor">×2</text>',
    ),
    desc: "Double points this run",
    color: "#ffe08a",
  },
  heavy: {
    name: "HEAVY",
    svg: svg(
      '<path d="M5.5 16.5l1.8-6.2L11 7l5.5 1.6 2 5.4-2.8 4.5H8z" fill="currentColor"/><path d="M9 11.5l2.5 1.5 3-1" stroke="#0c1020" stroke-width="1.3" fill="none"/>',
    ),
    desc: "Next hit breaks anything",
    color: "#b9c0d4",
  },
  bounce: {
    name: "BOUNCE",
    svg: svg(
      '<circle cx="12" cy="17" r="4" fill="currentColor"/><path d="M12 10V3.5M8.5 6.5L12 3l3.5 3.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    ),
    desc: "Next smash launches you up",
    color: "#b48cff",
  },
  feather: {
    name: "FEATHER",
    svg: svg(
      '<path d="M20 4c-6.5.3-12 4.5-14 12l-1.6 3.6L8 18c7.5-2 11.7-7.5 12-14z" fill="currentColor"/><path d="M6.5 17.5L18 6" stroke="#0c1020" stroke-width="1.4"/>',
    ),
    desc: "Razor steering this run",
    color: "#9fe8ff",
  },
};

export function boosterPrice(id: BoosterId): number {
  return CONFIG.boosters[id].price;
}
