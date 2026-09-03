// Player progression + daily tasks — pure functions over plain data.
// Dates come in as strings (injected by main); no Date here.
import { CONFIG } from "./config.js";
import { stream, dateSeed } from "./rng.js";
import type { SimEvent, SimState } from "./sim.js";

// --- Levels ----------------------------------------------------------------
export const levelCost = (level: number): number =>
  Math.round(CONFIG.levelBaseCost * Math.pow(CONFIG.levelCostGrowth, level - 1));

export interface Perks {
  skins: string[];
  boosters: string[];
  shields: number; // free mine shields granted at the start of every run
  jumpCharges: number;
}

// Everything unlocked at or below `level`.
export function perksAt(level: number): Perks {
  const p: Perks = { skins: [], boosters: [], shields: 0, jumpCharges: 1 };
  for (const row of CONFIG.levelPerks) {
    if (row.level > level) continue;
    if (row.skin) p.skins.push(row.skin);
    if (row.booster) p.boosters.push(row.booster);
    if (row.shield) p.shields += row.shield;
    if (row.jumpCharge) p.jumpCharges += row.jumpCharge;
  }
  return p;
}

export const skinsAt = (level: number): string[] => perksAt(level).skins;

// Human-readable line for "what the NEXT level gives" (UI).
export function nextPerkText(level: number): string {
  const row = CONFIG.levelPerks.find((r) => r.level === level + 1);
  const bits: string[] = [];
  if (row?.skin) bits.push(`new skin: ${row.skin.toUpperCase()}`);
  if (row?.booster) bits.push(`unlock booster: ${row.booster.toUpperCase()}`);
  if (row?.shield) bits.push(`+${row.shield} free shield per run`);
  if (row?.jumpCharge) bits.push(`+${row.jumpCharge} jump charge`);
  // Jump power and reload are the same at every level, so they are not news.
  return bits.join(" · ") || "no new perks";
}

// --- Daily tasks -----------------------------------------------------------
export interface DailyTask {
  id: string;
  text: string;
  goal: number;
}

// Multi-run goals (owner: the old ones died in 1-3 runs).
const TASK_POOL: DailyTask[] = [
  { id: "glass30", text: "Smash 150 glass panes", goal: 150 },
  { id: "stone8", text: "Crush 45 stone blocks", goal: 45 },
  { id: "bombs3", text: "Detonate 15 bombs", goal: 15 },
  { id: "combo8", text: "Reach a ×10 combo 5 times", goal: 5 },
  { id: "depth8", text: "Reach depth 14", goal: 1 },
  { id: "bumper6", text: "Bounce off 30 green launchers", goal: 30 },
  { id: "booster1", text: "Activate 6 boosters", goal: 6 },
  { id: "score5k", text: "Score 900 in one run", goal: 1 },
  { id: "runs6", text: "Finish 6 runs", goal: 6 },
  { id: "blocks200", text: "Smash 200 blocks total", goal: 200 },
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
      d.progress.blocks200 = (d.progress.blocks200 ?? 0) + 1;
      if (e.btype === "glass") d.progress.glass30 = (d.progress.glass30 ?? 0) + 1;
      if (e.btype === "stone") d.progress.stone8 = (d.progress.stone8 ?? 0) + 1;
      if (e.btype === "bomb") d.progress.bombs3 = (d.progress.bombs3 ?? 0) + 1;
    }
    if (e.kind === "bumper") d.progress.bumper6 = (d.progress.bumper6 ?? 0) + 1;
  }
  if (sim.depth >= 14) d.progress.depth8 = 1;
}

export function trackRunEnd(d: DailyProgress, score: number, maxCombo: number): void {
  d.progress.runs6 = (d.progress.runs6 ?? 0) + 1;
  if (score >= 900) d.progress.score5k = 1;
  if (maxCombo >= CONFIG.comboMax) d.progress.combo8 = (d.progress.combo8 ?? 0) + 1;
}

export function trackBoosterUse(d: DailyProgress): void {
  d.progress.booster1 = (d.progress.booster1 ?? 0) + 1;
}
