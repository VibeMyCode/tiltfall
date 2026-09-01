// Seeded tower generation — varied block PIECES on an occupancy grid (owner
// direction: rectangles, L/П shapes, mixed sizes and heights, not uniform
// cubes). A piece = one or more axis-aligned SEGMENTS sharing a groupId;
// segments of a piece break together. Pure module: no Babylon, no wall-clock.
import { CONFIG } from "./config";
import { stream } from "./rng";

export type BlockType = "glass" | "stone" | "support" | "dep";

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
  threshold: number;
  deps: number[]; // support pieces: groupIds broken by the cascade
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
const HEIGHTS = [60, 100, 150];

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
        threshold: C.thresholds[type],
        deps,
      });
    };

    // 1. Support cluster first (guaranteed): support + up to 3 single-cell
    // dependents. Tier 0 sits under the spawn for the first-drop cascade.
    const sr = tier === 0 ? 4 : 2 + Math.floor(rng() * 4);
    const sc = tier === 0 ? 4 : 2 + Math.floor(rng() * 4);
    const depOffsets = [
      [0, 1],
      [1, 0],
      [1, 1],
    ];
    const depGroupIds: number[] = [];
    const supportGroup = nextGroup++;
    claim(sr, sc, 1, 1);
    const depDefs: { r: number; c: number; g: number }[] = [];
    for (const [dr, dc] of depOffsets) {
      const r = sr + dr;
      const c = sc + dc;
      if (free(r, c, 1, 1)) {
        const g = nextGroup++;
        depGroupIds.push(g);
        depDefs.push({ r, c, g });
        claim(r, c, 1, 1);
      }
    }
    segment(supportGroup, "support", true, 1, sr, sc, 1, 1, 100, depGroupIds);
    for (const d of depDefs) segment(d.g, "dep", true, 1, d.r, d.c, 1, 1, 100, []);

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

    // 3. Singles sprinkled on remaining free cells — sparse by design: the
    // gaps are the aiming targets.
    const stoneP = 0.15 + tier * 0.05;
    for (let r = 0; r < C.gridN; r++) {
      for (let c = 0; c < C.gridN; c++) {
        if (occupied[r * C.gridN + c] || rng() >= 0.22) continue;
        const type: BlockType = rng() < stoneP ? "stone" : "glass";
        const h = HEIGHTS[Math.floor(rng() * HEIGHTS.length)];
        const g = nextGroup++;
        claim(r, c, 1, 1);
        segment(g, type, true, 1, r, c, 1, 1, h, []);
      }
    }
  }
  return out;
}
