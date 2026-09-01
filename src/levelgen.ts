// Seeded tower generation — varied block PIECES on an occupancy grid (owner
// direction: rectangles, L/П shapes, mixed sizes and heights, not uniform
// cubes). A piece = one or more axis-aligned SEGMENTS sharing a groupId;
// segments of a piece break together. Pure module: no Babylon, no wall-clock.
import { CONFIG } from "./config";
import { stream } from "./rng";

export type BlockType = "glass" | "stone" | "bomb" | "bumper" | "spike";

// One axis-aligned segment of a piece. Ascending id = §3.3 contact order.
export interface BlockDef {
  id: number;
  groupId: number;
  type: BlockType;
  primary: boolean; // exactly one per group — scores once for the whole piece
  cells: number; // total cells of the piece (score multiplier), on primary
  cx: number;
  cy: number;
  cz: number;
  hx: number; // half extents
  hy: number;
  hz: number;
  threshold: number; // unbreakables (bumper/spike): Infinity
  deps: number[]; // reserved — bomb blasts are resolved at runtime (§4.2 note)
}

// Piece templates as cell rectangles [r0, c0, rows, cols] — an L is a bar +
// a foot, а П is a bar + two legs. Multi-rect pieces become multi-segment.
const SHAPES: { rects: number[][]; cells: number }[] = [
  { rects: [[0, 0, 1, 1]], cells: 1 }, // single
  { rects: [[0, 0, 1, 2]], cells: 2 }, // bar 1×2
  { rects: [[0, 0, 2, 1]], cells: 2 }, // bar 2×1
  { rects: [[0, 0, 2, 2]], cells: 4 }, // big 2×2
  { rects: [[0, 0, 2, 1], [1, 1, 1, 1]], cells: 3 }, // L
  { rects: [[0, 0, 1, 3], [1, 0, 1, 1], [1, 2, 1, 1]], cells: 5 }, // П
];
const HEIGHTS = [20, 40, 50]; // flat plate / normal / tall (owner sizing)

export function buildTower(seed: number): BlockDef[] {
  const C = CONFIG;
  const out: BlockDef[] = [];
  for (let tier = 0; tier < C.tierCount; tier++) {
    const rng = stream(`tier${tier}`, seed);
    const restY = C.firstTierTopY + tier * C.tierSpacing + C.blockH; // piece bases rest here
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
      deps: number[],
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
        deps,
      });
    };
    const placeSingle = (type: BlockType, h: number): boolean => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const r = Math.floor(rng() * C.gridN);
        const c = Math.floor(rng() * C.gridN);
        if (!free(r, c, 1, 1)) continue;
        claim(r, c, 1, 1);
        segment(nextGroup++, type, true, 1, r, c, 1, 1, h, []);
        return true;
      }
      return false;
    };

    // 1. The BOMB (guaranteed, one per tier): tier 0 sits under the spawn so
    // the first drop always detonates. Its blast targets are computed after
    // the whole tier is placed (step 4). Three glass singles are forced
    // around tier-0's bomb so the opening blast always has fuel.
    const sr = tier === 0 ? 4 : 2 + Math.floor(rng() * 4);
    const sc = tier === 0 ? 4 : 2 + Math.floor(rng() * 4);
    const bombGroup = nextGroup++;
    claim(sr, sc, 1, 1);
    segment(bombGroup, "bomb", true, 1, sr, sc, 1, 1, 50, []);
    if (tier === 0) {
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
        [1, 1],
      ]) {
        if (free(sr + dr, sc + dc, 1, 1)) {
          const g = nextGroup++;
          claim(sr + dr, sc + dc, 1, 1);
          segment(g, "glass", true, 1, sr + dr, sc + dc, 1, 1, 40, []);
        }
      }
    }

    // 2. Big pieces: one 2×2 or П, two bars, one L — placed by rejection
    // sampling (bounded attempts, deterministic draws).
    const pieceOrder = [rng() < 0.5 ? 3 : 5, 1, 2, 4];
    for (const shapeIdx of pieceOrder) {
      const shape = SHAPES[shapeIdx];
      for (let attempt = 0; attempt < 14; attempt++) {
        const r0 = Math.floor(rng() * C.gridN);
        const c0 = Math.floor(rng() * C.gridN);
        const fits = shape.rects.every(([rr, cc, rows, cols]) => free(r0 + rr, c0 + cc, rows, cols));
        if (!fits) continue;
        const type: BlockType = rng() < 0.45 ? "stone" : "glass";
        const h = HEIGHTS[Math.floor(rng() * HEIGHTS.length)];
        const g = nextGroup++;
        shape.rects.forEach(([rr, cc, rows, cols], i) => {
          claim(r0 + rr, c0 + cc, rows, cols);
          segment(g, type, i === 0, shape.cells, r0 + rr, c0 + cc, rows, cols, h, []);
        });
        break;
      }
    }

    // 3. Singles on remaining free cells — denser now (owner: the edges were
    // too empty and blast-radius differences could not be read), with an
    // extra bias on border cells.
    const stoneP = 0.15 + tier * 0.04;
    for (let r = 0; r < C.gridN; r++) {
      for (let c = 0; c < C.gridN; c++) {
        const border = r === 0 || c === 0 || r === C.gridN - 1 || c === C.gridN - 1;
        const p = border ? 0.42 : 0.3;
        if (occupied[r * C.gridN + c] || rng() >= p) continue;
        const type: BlockType = rng() < stoneP ? "stone" : "glass";
        const h = HEIGHTS[Math.floor(rng() * HEIGHTS.length)];
        const g = nextGroup++;
        claim(r, c, 1, 1);
        segment(g, type, true, 1, r, c, 1, 1, h, []);
      }
    }

    // 4. Unbreakables (§4.1): bumpers launch, spikes stop dead. Spikes from
    // tier 1; two bumpers per tier so they are actually encountered.
    placeSingle("bumper", 50);
    placeSingle("bumper", 50);
    if (tier > 0) {
      placeSingle("spike", 40);
      if (tier >= 2 && rng() < 0.6) placeSingle("spike", 40);
    }
  }
  return out;
}

// Deterministic probe input (§4.3): 16 scripted tilt patterns, no trig.
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
    // zig-zag: compass direction flipping every 2 s
    const base = COMPASS[(pattern - 8) * 2];
    const flip = (tick >> 8) & 1 ? -1 : 1;
    return { x: base[0] * flip, z: base[1] * flip };
  }
  if (pattern < 14) {
    // square "spiral": cycle the 4 cardinal directions every second
    const dir = COMPASS[((tick >> 7) + (pattern - 12) * 2) % 4];
    return { x: dir[0], z: dir[1] };
  }
  if (pattern === 14) return { x: 0, z: 0 };
  return { x: 0.7, z: 0.7 };
}


// Probe validation (§4.3, tests only — no par UI): 16 scripted descents
// through the REAL sim with pity disabled. A tower passes when >= 80% of
// probes finish within the total tick budget.
import { createSim, step } from "./sim";

export interface TowerValidation {
  ok: boolean;
  passed: number;
  medianTicks: number;
}

export function validateTower(layout: BlockDef[]): TowerValidation {
  const C = CONFIG;
  const maxTicks = C.probeTierTickLimit * C.tierCount;
  const finishTicks: number[] = [];
  let passed = 0;
  for (let p = 0; p < 16; p++) {
    const sim = createSim(layout, { pityDisabled: true });
    while (sim.tick < maxTicks && !sim.finished) {
      const t = probeTilt(p, sim.tick);
      step(sim, t.x, t.z);
    }
    if (sim.finished) {
      passed++;
      finishTicks.push(sim.finishTick);
    }
  }
  finishTicks.sort((a, b) => a - b);
  const median = finishTicks.length ? finishTicks[Math.floor(finishTicks.length / 2)] : 0;
  return { ok: passed >= 13, passed, medianTicks: median };
}
