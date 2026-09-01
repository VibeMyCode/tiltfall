// Seeded tower generation — M1 subset of SPEC §4.3 (probe validation, spikes,
// bumpers and crystals arrive with M2/M3). Pure module: no Babylon, no Date.
import { CONFIG } from "./config";
import { stream } from "./rng";

export type BlockType = "glass" | "stone" | "support" | "dep";

export interface BlockDef {
  id: number; // tier*100 + cell — ascending id = deterministic contact order
  type: BlockType;
  cx: number;
  cy: number;
  cz: number;
  threshold: number;
  deps: number[]; // for supports: block ids broken by the cascade
}

export function buildTower(seed: number): BlockDef[] {
  const { tierCount, firstTierTopY, tierSpacing, gridN, gridX0, cell, blockH } = CONFIG;
  const out: BlockDef[] = [];
  for (let tier = 0; tier < tierCount; tier++) {
    const rng = stream(`tier${tier}`, seed);
    const topY = firstTierTopY + tier * tierSpacing;
    // Support cluster: tier 0 fixed under the spawn (guaranteed first-drop
    // cascade); deeper tiers place it anywhere in the inner 4×4.
    const sr = tier === 0 ? 4 : 2 + Math.floor(rng() * 4);
    const sc = tier === 0 ? 4 : 2 + Math.floor(rng() * 4);
    const supportCell = sr * gridN + sc;
    const depCells = [sr * gridN + sc + 1, (sr + 1) * gridN + sc, (sr + 1) * gridN + sc + 1];
    const stoneP = 0.15 + tier * 0.05; // deeper tiers harden
    for (let r = 0; r < gridN; r++) {
      for (let c = 0; c < gridN; c++) {
        const cellIdx = r * gridN + c;
        let type: BlockType | null = null;
        if (cellIdx === supportCell) type = "support";
        else if (depCells.includes(cellIdx)) type = "dep";
        else if (rng() < 0.42) type = rng() < stoneP ? "stone" : "glass";
        if (!type) continue;
        const id = tier * 100 + cellIdx;
        out.push({
          id,
          type,
          cx: gridX0 + c * cell + cell / 2,
          cy: topY + blockH / 2,
          cz: gridX0 + r * cell + cell / 2,
          threshold: CONFIG.thresholds[type],
          deps: type === "support" ? depCells.map((d) => tier * 100 + d) : [],
        });
      }
    }
  }
  return out;
}
