// Seeded ENDLESS tower generation: buildTier(seed, tier) makes one tier on
// demand — every run streams a fresh tower from a random seed (owner:
// generative all the way). Difficulty ramps with depth; mines appear after
// the grace tiers. Pure module: no Babylon, no wall-clock.
import { CONFIG } from "./config";
import { stream } from "./rng";

export type BlockType = "glass" | "stone" | "bomb" | "bumper" | "spike" | "mine";

// One axis-aligned segment of a piece. Ascending id = §3.3 contact order.
export interface BlockDef {
  id: number;
  groupId: number;
  type: BlockType;
  primary: boolean;
  cells: number;
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  threshold: number; // unbreakables (bumper/spike/mine): Infinity
  deps: number[];
}

const SHAPES: { rects: number[][]; cells: number }[] = [
  { rects: [[0, 0, 1, 1]], cells: 1 },
  { rects: [[0, 0, 1, 2]], cells: 2 },
  { rects: [[0, 0, 2, 1]], cells: 2 },
  { rects: [[0, 0, 2, 2]], cells: 4 },
  { rects: [[0, 0, 2, 1], [1, 1, 1, 1]], cells: 3 }, // L
  { rects: [[0, 0, 1, 3], [1, 0, 1, 1], [1, 2, 1, 1]], cells: 5 }, // П
];

// Height is part of the material language: glass = thin panes, stone = chunky.
const typeHeight = (t: BlockType): number => (t === "glass" ? 20 : t === "stone" ? 60 : 50);

export function buildTier(seed: number, tier: number): BlockDef[] {
  const C = CONFIG;
  const out: BlockDef[] = [];
  const rng = stream(`tier${tier}`, seed);
  const restY = C.firstTierTopY + tier * C.tierSpacing + C.blockH;
  const occupied: boolean[] = new Array(C.gridN * C.gridN).fill(false);
  let nextId = tier * 1000;
  let nextGroup = tier * 1000;

  const free = (r0: number, c0: number, rows: number, cols: number): boolean => {
    if (r0 < 0 || c0 < 0 || r0 + rows > C.gridN || c0 + cols > C.gridN) return false;
    for (let r = r0; r < r0 + rows; r++)
      for (let c = c0; c < c0 + cols; c++) if (occupied[r * C.gridN + c]) return false;
    return true;
  };
  const claim = (r0: number, c0: number, rows: number, cols: number): void => {
    for (let r = r0; r < r0 + rows; r++) for (let c = c0; c < c0 + cols; c++) occupied[r * C.gridN + c] = true;
  };
  const segment = (
    groupId: number,
    type: BlockType,
    primary: boolean,
    cells: number,
    r0: number,
    c0: number,
    rows: number,
    cols: number,
    h: number,
  ): void => {
    out.push({
      id: nextId++,
      groupId,
      type,
      primary,
      cells,
      cx: C.gridX0 + c0 * C.cell + (cols * C.cell) / 2,
      cy: restY - h / 2,
      cz: C.gridX0 + r0 * C.cell + (rows * C.cell) / 2,
      hx: (cols * C.cell) / 2,
      hy: h / 2,
      hz: (rows * C.cell) / 2,
      threshold: C.thresholds[type] ?? Infinity,
      deps: [],
    });
  };
  const placeSingle = (type: BlockType, h: number): boolean => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const r = Math.floor(rng() * C.gridN);
      const c = Math.floor(rng() * C.gridN);
      if (!free(r, c, 1, 1)) continue;
      claim(r, c, 1, 1);
      segment(nextGroup++, type, true, 1, r, c, 1, 1, h);
      return true;
    }
    return false;
  };

  // 1. The BOMB (one per tier). Tier 0's sits under the spawn with glass
  // fuel around it — the opening detonation is guaranteed.
  const sr = tier === 0 ? 4 : 2 + Math.floor(rng() * 4);
  const sc = tier === 0 ? 4 : 2 + Math.floor(rng() * 4);
  claim(sr, sc, 1, 1);
  segment(nextGroup++, "bomb", true, 1, sr, sc, 1, 1, 50);
  if (tier === 0) {
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      if (free(sr + dr, sc + dc, 1, 1)) {
        claim(sr + dr, sc + dc, 1, 1);
        segment(nextGroup++, "glass", true, 1, sr + dr, sc + dc, 1, 1, 20);
      }
    }
  }

  // 2. Big pieces: one 2×2 or П, two bars, one L.
  const stoneP = Math.min(C.stonePMax, 0.15 + tier * 0.03);
  const pieceOrder = [rng() < 0.5 ? 3 : 5, 1, 2, 4];
  for (const shapeIdx of pieceOrder) {
    const shape = SHAPES[shapeIdx];
    for (let attempt = 0; attempt < 14; attempt++) {
      const r0 = Math.floor(rng() * C.gridN);
      const c0 = Math.floor(rng() * C.gridN);
      if (!shape.rects.every(([rr, cc, rows, cols]) => free(r0 + rr, c0 + cc, rows, cols))) continue;
      const type: BlockType = rng() < 0.45 ? "stone" : "glass";
      const g = nextGroup++;
      shape.rects.forEach(([rr, cc, rows, cols], i) => {
        claim(r0 + rr, c0 + cc, rows, cols);
        segment(g, type, i === 0, shape.cells, r0 + rr, c0 + cc, rows, cols, typeHeight(type));
      });
      break;
    }
  }

  // 3. Singles, denser on the border.
  for (let r = 0; r < C.gridN; r++) {
    for (let c = 0; c < C.gridN; c++) {
      const border = r === 0 || c === 0 || r === C.gridN - 1 || c === C.gridN - 1;
      if (occupied[r * C.gridN + c] || rng() >= (border ? 0.42 : 0.3)) continue;
      const type: BlockType = rng() < stoneP ? "stone" : "glass";
      claim(r, c, 1, 1);
      segment(nextGroup++, type, true, 1, r, c, 1, 1, typeHeight(type));
    }
  }

  // 4. Unbreakables: two bumpers everywhere; spikes ramp with depth; MINES
  // after the grace tiers — touching one ends the run (owner design).
  placeSingle("bumper", 50);
  placeSingle("bumper", 50);
  const spikes = Math.min(CONFIG.spikeMaxPerTier, tier < 1 ? 0 : 1 + Math.floor(tier / 4));
  for (let i = 0; i < spikes; i++) placeSingle("spike", 40);
  if (tier >= C.mineFreeTiers) {
    const mines = C.mineCount(tier);
    for (let i = 0; i < mines; i++) placeSingle("mine", 50);
  }
  return out;
}

// Fixed-count tower for tests and probes.
export function buildTower(seed: number, tiers = 8): BlockDef[] {
  const out: BlockDef[] = [];
  for (let t = 0; t < tiers; t++) out.push(...buildTier(seed, t));
  return out;
}

// Deterministic probe input (tests): 16 scripted tilt patterns, no trig.
export function probeTilt(pattern: number, tick: number): { x: number; z: number } {
  const COMPASS = [
    [0.6, 0],
    [-0.6, 0],
    [0, 0.6],
    [0, -0.6],
    [0.42, 0.42],
    [0.42, -0.42],
    [-0.42, 0.42],
    [-0.42, -0.42],
  ];
  if (pattern < 8) return { x: COMPASS[pattern][0], z: COMPASS[pattern][1] };
  if (pattern < 12) {
    const base = COMPASS[(pattern - 8) * 2];
    const flip = (tick >> 8) & 1 ? -1 : 1;
    return { x: base[0] * flip, z: base[1] * flip };
  }
  if (pattern < 14) {
    const dir = COMPASS[((tick >> 7) + (pattern - 12) * 2) % 4];
    return { x: dir[0], z: dir[1] };
  }
  if (pattern === 14) return { x: 0, z: 0 };
  return { x: 0.7, z: 0.7 };
}
