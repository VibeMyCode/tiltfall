// Depth biomes: every few tiers the tower changes its skin — fog, sky,
// walls and block tints all shift, so a deep run visibly travels through
// layers instead of one endless grey shaft. Pure data + math (no Babylon).
export type RGB = [number, number, number];

export interface Biome {
  name: string;
  sky: RGB; // clear color + fog color
  wall: RGB;
  glass: RGB;
  stone: RGB;
  fogNear: number; // multiplier on CONFIG.fogStart/fogEnd
}

export const BIOMES: Biome[] = [
  {
    name: "GLACIER",
    sky: [0.05, 0.07, 0.12],
    wall: [0.26, 0.32, 0.48],
    glass: [0.3, 0.75, 0.95],
    stone: [0.42, 0.33, 0.24],
    fogNear: 1,
  },
  {
    name: "VERDANT",
    sky: [0.04, 0.1, 0.08],
    wall: [0.2, 0.4, 0.3],
    glass: [0.35, 0.95, 0.6],
    stone: [0.35, 0.3, 0.2],
    fogNear: 0.95,
  },
  {
    name: "MAGMA",
    sky: [0.11, 0.04, 0.03],
    wall: [0.42, 0.2, 0.14],
    glass: [1.0, 0.55, 0.2],
    stone: [0.32, 0.18, 0.14],
    fogNear: 0.85,
  },
  {
    name: "NEON",
    sky: [0.07, 0.03, 0.13],
    wall: [0.36, 0.18, 0.5],
    glass: [0.85, 0.35, 1.0],
    stone: [0.3, 0.24, 0.38],
    fogNear: 0.9,
  },
  {
    name: "ABYSS",
    sky: [0.02, 0.02, 0.04],
    wall: [0.16, 0.18, 0.26],
    glass: [0.45, 0.85, 0.95],
    stone: [0.2, 0.2, 0.24],
    fogNear: 0.7, // the deep is claustrophobic
  },
];

export const BIOME_TIER_SPAN = 5; // tiers per biome
const BLEND_TIERS = 1.2; // how long the crossfade lasts

export const biomeIndexAt = (tier: number): number =>
  Math.min(BIOMES.length - 1, Math.floor(Math.max(0, tier) / BIOME_TIER_SPAN)) % BIOMES.length;

export const biomeNameAt = (tier: number): string => BIOMES[biomeIndexAt(tier)].name;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpRGB = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

// The palette for a fractional tier position, crossfading near boundaries.
export function paletteAt(tier: number): Biome {
  const t = Math.max(0, tier);
  const i = Math.floor(t / BIOME_TIER_SPAN);
  const cur = BIOMES[i % BIOMES.length];
  const next = BIOMES[(i + 1) % BIOMES.length];
  const into = t - i * BIOME_TIER_SPAN;
  const k = into > BIOME_TIER_SPAN - BLEND_TIERS ? (into - (BIOME_TIER_SPAN - BLEND_TIERS)) / BLEND_TIERS : 0;
  if (k <= 0) return cur;
  return {
    name: k > 0.5 ? next.name : cur.name,
    sky: lerpRGB(cur.sky, next.sky, k),
    wall: lerpRGB(cur.wall, next.wall, k),
    glass: lerpRGB(cur.glass, next.glass, k),
    stone: lerpRGB(cur.stone, next.stone, k),
    fogNear: lerp(cur.fogNear, next.fogNear, k),
  };
}
