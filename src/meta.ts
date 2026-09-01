// Player progression + daily tasks — pure functions over plain data.
// Dates come in as strings (injected by main); no Date here.
import { CONFIG } from "./config";
import { stream, dateSeed } from "./rng";
import type { SimEvent, SimState } from "./sim";

// --- Levels ----------------------------------------------------------------
export const levelCost = (level: number): number =>
  Math.round(CONFIG.levelBaseCost * Math.pow(CONFIG.levelCostGrowth, level - 1));

export const jumpPowerAt = (level: number): number => CONFIG.jumpBasePower + (level - 1) * CONFIG.jumpPowerPerLevel;

export const jumpCooldownAt = (level: number): number =>
  Math.max(CONFIG.jumpMinCooldownTicks, CONFIG.jumpBaseCooldownTicks - (level - 1) * CONFIG.jumpCooldownPerLevel);

export const shieldsAt = (level: number): number => CONFIG.shieldLevels.filter((l) => level >= l).length;

export const skinsAt = (level: number): string[] =>
  Object.entries(CONFIG.skinUnlocks)
    .filter(([lvl]) => level >= Number(lvl))
    .map(([, skin]) => skin);

// --- Daily tasks -----------------------------------------------------------
export interface DailyTask {
  id: string;
  text: string;
  goal: number;
}

const TASK_POOL: DailyTask[] = [
  { id: "glass30", text: "Smash 30 glass panes", goal: 30 },
  { id: "stone8", text: "Crush 8 stone blocks", goal: 8 },
  { id: "bombs3", text: "Detonate 3 bombs", goal: 3 },
  { id: "combo8", text: "Reach a ×8 combo", goal: 1 },
  { id: "depth8", text: "Reach depth 8", goal: 1 },
  { id: "bumper6", text: "Hit 6 bumpers", goal: 6 },
  { id: "booster1", text: "Activate a booster", goal: 1 },
  { id: "score5k", text: "Score 5000 in one run", goal: 1 },
];

// Same three tasks for everyone on a given UTC date.
export function rollDaily(dateStr: string): DailyTask[] {
  const rng = stream("daily", dateSeed(dateStr));
  const pool = [...TASK_POOL];
  const out: DailyTask[] = [];
  for (let i = 0; i < 3; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

export interface DailyProgress {
  date: string;
  progress: Record<string, number>;
  claimed: Record<string, boolean>;
  allClaimed: boolean;
}

export function freshDaily(dateStr: string): DailyProgress {
  return { date: dateStr, progress: {}, claimed: {}, allClaimed: false };
}

// Feed sim events + run summaries into task progress.
export function trackEvents(d: DailyProgress, events: SimEvent[], sim: SimState): void {
  for (const e of events) {
    if (e.kind === "break") {
      if (e.btype === "glass") d.progress.glass30 = (d.progress.glass30 ?? 0) + 1;
      if (e.btype === "stone") d.progress.stone8 = (d.progress.stone8 ?? 0) + 1;
      if (e.btype === "bomb") d.progress.bombs3 = (d.progress.bombs3 ?? 0) + 1;
    }
    if (e.kind === "bumper") d.progress.bumper6 = (d.progress.bumper6 ?? 0) + 1;
  }
  if (sim.maxCombo >= 8) d.progress.combo8 = 1;
  if (sim.depth >= 8) d.progress.depth8 = 1;
}

export function trackRunEnd(d: DailyProgress, score: number): void {
  if (score >= 5000) d.progress.score5k = 1;
}

export function trackBoosterUse(d: DailyProgress): void {
  d.progress.booster1 = 1;
}
