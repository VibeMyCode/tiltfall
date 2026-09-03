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
  ambient: number; // light multiplier — deep biomes must stay READABLE (owner)
}

export const BIOMES: Biome[] = [
  {
    name: "GLACIER",
    sky: [0.07, 0.09, 0.16],
    wall: [0.34, 0.42, 0.62],
    glass: [0.35, 0.8, 1.0],
    stone: [0.55, 0.44, 0.32],
    fogNear: 1.05,
    ambient: 0.95,
  },
  {
    name: "VERDANT",
    sky: [0.06, 0.13, 0.1],
    wall: [0.28, 0.52, 0.4],
    glass: [0.4, 1.0, 0.65],
    stone: [0.52, 0.44, 0.3],
    fogNear: 1.0,
    ambient: 0.95,
  },
  {
    name: "MAGMA",
    sky: [0.2, 0.08, 0.06],
    wall: [0.62, 0.32, 0.22],
    glass: [1.0, 0.62, 0.28],
    stone: [0.55, 0.34, 0.24],
    fogNear: 1.0,
    ambient: 1.0, // was a cave; readability now comes from the sun, not from more light
  },
  {
    name: "NEON",
    sky: [0.11, 0.05, 0.2],
    wall: [0.42, 0.22, 0.6],
    glass: [0.86, 0.4, 1.0],
    stone: [0.44, 0.34, 0.54],
    fogNear: 1.0,
    ambient: 0.9,
  },
  {
    name: "ABYSS",
    sky: [0.05, 0.055, 0.09],
    wall: [0.28, 0.32, 0.46],
    glass: [0.5, 0.9, 1.0],
    stone: [0.38, 0.38, 0.46],
    fogNear: 0.85,
    ambient: 1.0,
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
    ambient: lerp(cur.ambient, next.ambient, k),
  };
}
