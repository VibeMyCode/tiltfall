// Boot + fixed-timestep game loop. ENDLESS random tower each run; the run
// ends on a mine. Bank → levels (jump power/cooldown, skins, mine shields),
// boosters, daily tasks (owner design M3+M4).
import "./style.css";
import { CONFIG } from "./config";
import { BOOSTER_ORDER, type BoosterId } from "./boosters";
import {
  freshDaily,
  jumpCooldownAt,
  jumpPowerAt,
  levelCost,
  nextPerkText,
  perksAt,
  rollDaily,
  trackBoosterUse,
  trackEvents,
  trackRunEnd,
  type DailyProgress,
} from "./meta";
import { activateBooster, createSim, jump, predictPath, step, type SimState } from "./sim";
import { attachInput } from "./input";
import { createRenderer } from "./render";
import { createUI } from "./ui";

const DT_MS = 1000 * CONFIG.dt;
const MAX_FRAME_MS = 100;

// --- Persistence -----------------------------------------------------------
function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — session-only progress
  }
}
let bank = load<number>("tf.bank", 0);
const rawInv = load<Record<string, number>>("tf.inv", {});
// Migration: bounce→shield, feather→agility (booster redesign 2026-09-02).
const inventory: Record<BoosterId, number> = {
  quake: rawInv.quake ?? 0,
  chain: rawInv.chain ?? 0,
  x2: rawInv.x2 ?? 0,
  heavy: rawInv.heavy ?? 0,
  shield: (rawInv.shield ?? 0) + (rawInv.bounce ?? 0),
  agility: (rawInv.agility ?? 0) + (rawInv.feather ?? 0),
};
let best = load<{ score: number; depth: number }>("tf.best", { score: 0, depth: 0 });
let level = load<number>("tf.level", 1);
let skin = load<string>("tf.skin", "core");
const todayStr = new Date().toISOString().slice(0, 10); // UTC date, outside the sim
let daily = load<DailyProgress>("tf.daily", freshDaily(todayStr));
if (daily.date !== todayStr) daily = freshDaily(todayStr);
const dailyTasks = rollDaily(todayStr);
let banked = false;

const simOpts = () => {
  const p = perksAt(level);
  return {
    jumpPower: jumpPowerAt(level),
    jumpCooldownTicks: jumpCooldownAt(level),
    jumpMaxCharges: p.jumpCharges,
    shields: p.shields, // free shields are a LEVEL perk (L5, L13)
  };
};

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
// Every run is a NEW random tower (owner: generative all the way). The seed
// itself is drawn outside the sim — the sim stays deterministic per seed.
let sim: SimState = createSim(Math.floor(Math.random() * 2 ** 31), simOpts());
const input = attachInput(canvas);
const renderer = createRenderer(canvas, sim.blocks);
renderer.setSkin(skin);

const newRun = () => {
  clearTimeout(resultsTimer);
  sim = createSim(Math.floor(Math.random() * 2 ** 31), simOpts());
  banked = false;
  renderer.setLayout(sim.blocks);
  ui.hideResults();
};

function tryActivate(id: BoosterId): void {
  if (sim.finished) return;
  if (sim.armed[id] || sim.runOn[id]) return;
  if ((inventory[id] ?? 0) <= 0) return;
  inventory[id]--;
  save("tf.inv", inventory);
  activateBooster(sim, id);
  trackBoosterUse(daily);
  save("tf.daily", daily);
}

function tryJump(): void {
  if (jump(sim)) renderer.jumpFx(sim.ball);
}

const ui = createUI({
  onReplay: newRun,
  invert: { get: () => input.invertY(), toggle: () => input.toggleInvertY() },
  onActivate: tryActivate,
  onJump: tryJump,
});

let resultsTimer = 0;
let lastNewBest = false;

function onFinish(): void {
  if (banked) return;
  banked = true;
  bank += sim.score;
  trackRunEnd(daily, sim.score, sim.maxCombo);
  save("tf.daily", daily);
  lastNewBest = sim.score > best.score || sim.depth > best.depth;
  best = { score: Math.max(best.score, sim.score), depth: Math.max(best.depth, sim.depth) };
  save("tf.bank", bank);
  save("tf.best", best);
  // The death scene plays first (ball shatters, slow beat) — the overlay
  // fades in after it, never over it (owner design).
  resultsTimer = window.setTimeout(showResultsNow, 1500);
}

function showResultsNow(): void {
  ui.showResults({
    score: sim.score,
    depth: sim.depth,
    broken: sim.broken,
    maxCombo: sim.maxCombo,
    bestScore: best.score,
    bestDepth: best.depth,
    newBest: lastNewBest,
    shop: {
      get bank() {
        return bank;
      },
      inventory,
      // Boosters unlock with levels, cheapest first (owner).
      unlockLevel: (id) => CONFIG.levelPerks.find((r) => r.booster === id)?.level ?? 1,
      unlocked: (id) => perksAt(level).boosters.includes(id),
      buy(id) {
        const price = CONFIG.boosters[id].price;
        if (bank < price || !perksAt(level).boosters.includes(id)) return;
        bank -= price;
        inventory[id] = (inventory[id] ?? 0) + 1;
        save("tf.bank", bank);
        save("tf.inv", inventory);
      },
    },
    level: {
      current: () => level,
      cost: () => levelCost(level),
      jumpPower: () => jumpPowerAt(level),
      jumpCdS: () => jumpCooldownAt(level) * CONFIG.dt,
      shields: () => perksAt(level).shields,
      jumpCharges: () => perksAt(level).jumpCharges,
      nextText: () => nextPerkText(level),
      buy: () => {
        const cost = levelCost(level);
        if (bank < cost) return false;
        bank -= cost;
        level++;
        save("tf.bank", bank);
        save("tf.level", level);
        return true;
      },
    },
    skins: {
      unlocked: () => perksAt(level).skins,
      current: () => skin,
      select: (id) => {
        if (!perksAt(level).skins.includes(id)) return;
        skin = id;
        save("tf.skin", skin);
        renderer.setSkin(skin);
      },
    },
    daily: {
      tasks: dailyTasks.map((t) => ({
        ...t,
        progress: daily.progress[t.id] ?? 0,
        claimed: daily.claimed[t.id] ?? false,
      })),
      claim: (id) => {
        const task = dailyTasks.find((t) => t.id === id);
        if (!task || daily.claimed[id]) return;
        if ((daily.progress[id] ?? 0) < task.goal) return;
        daily.claimed[id] = true;
        bank += CONFIG.dailyRewardEach;
        if (dailyTasks.every((t) => daily.claimed[t.id]) && !daily.allClaimed) {
          daily.allClaimed = true;
          bank += CONFIG.dailyRewardAll;
        }
        save("tf.daily", daily);
        save("tf.bank", bank);
      },
    },
  });
}

let accumulator = 0;
let hitStopMs = 0;
let lastTilt = { x: 0, z: 0 };
let lastLandY = CONFIG.firstTierTopY + CONFIG.blockH;
let driveTarget: { x: number; z: number } | null = null;
let dragAnchor: { x: number; z: number } | null = null;

const clampT = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
const clampShaft = (v: number, max: number) => Math.min(max - CONFIG.ballRadius, Math.max(CONFIG.ballRadius, v));

function controlTilt(kb: { x: number; z: number }): { x: number; z: number } {
  if (!driveTarget) return kb;
  const b = sim.ball;
  const cx = (driveTarget.x - b.x) / CONFIG.targetGainDist - b.vx / CONFIG.targetGainVel;
  const cz = (driveTarget.z - b.z) / CONFIG.targetGainDist - b.vz / CONFIG.targetGainVel;
  return {
    x: Math.round(clampT(kb.x + cx) * 1000) / 1000,
    z: Math.round(clampT(kb.z + cz) * 1000) / 1000,
  };
}

renderer.scene.onBeforeRenderObservable.add(() => {
  const nowMs = performance.now();
  const frameMs = Math.min(renderer.engine.getDeltaTime(), MAX_FRAME_MS);

  const pt = input.pointer();
  if (CONFIG.targetControl && pt.active && !input.forced()) {
    if (!dragAnchor) dragAnchor = { x: sim.ball.x, z: sim.ball.z };
    const m0 = renderer.screenToShaft(pt.ox, pt.oy, sim.ball.y);
    const m1 = renderer.screenToShaft(pt.cx, pt.cy, sim.ball.y);
    if (m0 && m1) {
      const amp = CONFIG.pointerDragAmplify;
      driveTarget = {
        x: clampShaft(dragAnchor.x + (m1.x - m0.x) * amp, CONFIG.shaftW),
        z: clampShaft(dragAnchor.z + (m1.z - m0.z) * amp, CONFIG.shaftD),
      };
    }
  } else {
    dragAnchor = null;
    driveTarget = null;
  }

  // Smooth slow-mo showcase for BOTH quake and chain cascades (no hit-stop —
  // the ball glides while explosions bloom around it).
  const slowMo = sim.queue.length > 0 && sim.tick - sim.chainBlastTick < 720;
  if (hitStopMs > 0) {
    hitStopMs = Math.max(0, hitStopMs - frameMs);
  } else {
    accumulator += frameMs * (slowMo ? CONFIG.slowMoScale : 1);
  }
  while (accumulator >= DT_MS) {
    const s = CONFIG.targetControl ? controlTilt(input.sample(nowMs, true)) : input.sample(nowMs);
    lastTilt = s;
    const events = step(sim, s.x, s.z);
    if (events.length) {
      renderer.applyEvents(events);
      trackEvents(daily, events, sim);
      hitStopMs = Math.max(hitStopMs, renderer.consumeHitStop());
      if (events.some((e) => e.kind === "finish")) {
        save("tf.daily", daily);
        onFinish();
      }
    }
    accumulator -= DT_MS;
  }

  renderer.syncLayout(sim.blocks);
  renderer.syncBall(sim.ball);
  const path = sim.finished ? null : predictPath(sim, lastTilt.x, lastTilt.z);
  if (path && path.points.length && path.landed) lastLandY = path.points[path.points.length - 1].y;
  renderer.setAim(
    path && (path.landed || driveTarget) ? path.points : null,
    driveTarget ? { x: driveTarget.x, y: lastLandY, z: driveTarget.z } : null,
    path ? path.wallHit : false,
  );
  renderer.setBallMode(sim.runOn.heavy ? "lead" : "skin");
  renderer.setTrail(Boolean(sim.runOn.agility) && !sim.finished);
  renderer.setShield(sim.shields > 0);
  renderer.frame(frameMs, lastTilt);
  ui.setHud(sim.tick * CONFIG.dt, sim.score, sim.combo, sim.depth, sim.shields);
  ui.setJump(
    sim.jumpCharges > 0 ? 1 : 1 - sim.jumpCd / sim.jumpCooldownTicks,
    sim.jumpCharges,
    sim.jumpMaxCharges,
  );
  ui.setBoosterBar(inventory, sim.armed, sim.runOn);
  (window as unknown as { __DSH_READY: boolean }).__DSH_READY = true;
});

// Debug/probe hook — used by the headless verification script only.
(window as unknown as { __tf: unknown }).__tf = {
  get broken() {
    return sim.broken;
  },
  get score() {
    return sim.score;
  },
  get depth() {
    return sim.depth;
  },
  get finished() {
    return sim.finished;
  },
  get ball() {
    return { x: sim.ball.x, y: sim.ball.y, z: sim.ball.z };
  },
  get fps() {
    return renderer.engine.getFps();
  },
  get target() {
    return driveTarget;
  },
  get tilt() {
    return lastTilt;
  },
  get tick() {
    return sim.tick;
  },
  get steerable() {
    return !sim.finished;
  },
  get bank() {
    return bank;
  },
  get level() {
    return level;
  },
  get inventory() {
    return { ...inventory };
  },
  get armed() {
    return { ...sim.armed };
  },
  get jumpCd() {
    return sim.jumpCd;
  },
  grant(id: BoosterId, n = 1) {
    inventory[id] = (inventory[id] ?? 0) + n;
  },
  activate(i: number) {
    tryActivate(BOOSTER_ORDER[i]);
  },
  jump() {
    tryJump();
  },
  addBank(n: number) {
    bank += n;
  },
  setTilt(x: number, z: number) {
    input.setForced({ x, z });
  },
  clearTilt() {
    input.setForced(null);
  },
  replay() {
    newRun();
  },
  // Wipe all saved progress (bank, boosters, level, skins, best, daily) and
  // start clean — testing helper: run `__tf.reset()` in the console.
  reset() {
    for (const k of ["tf.bank", "tf.inv", "tf.best", "tf.level", "tf.skin", "tf.daily"]) {
      try {
        localStorage.removeItem(k);
      } catch {
        // storage unavailable — nothing to wipe
      }
    }
    location.reload();
  },
};

renderer.engine.runRenderLoop(() => renderer.scene.render());
window.addEventListener("resize", () => renderer.engine.resize());
