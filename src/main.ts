// Boot + fixed-timestep game loop. ENDLESS random tower each run; the run
// ends on a mine. Bank → levels (jump power/cooldown, skins, mine shields),
// boosters, daily tasks (owner design M3+M4).
import "./style.css";
import { CONFIG, jumpCooldownTicks } from "./config";
import { BOOSTER_ORDER, type BoosterId } from "./boosters";
import {
  freshDaily,
  levelCost,
  nextPerkText,
  perksAt,
  rollDaily,
  trackBoosterUse,
  trackEvents,
  trackRunEnd,
  type DailyProgress,
} from "./meta";
import { activateBooster, createSim, driveTilt, jump, predictPath, step, type SimEvent, type SimState } from "./sim";
import { SFX, initAudio, isMuted, toggleMute } from "./sfx";
import { attachInput, isTouch } from "./input";
import { createRenderer } from "./render";
import { createUI } from "./ui";
import { createRecorder, type RunRecorder } from "./replay";
import { submitRun } from "./board";
import { cloudLoad, cloudSave, haptic, initDataRaw, initTelegram, inTelegram, shareScore } from "./telegram";
import { biomeNameAt } from "./biomes";

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
  const json = JSON.stringify(value);
  try {
    localStorage.setItem(key, json);
  } catch {
    // storage unavailable — session-only progress
  }
  cloudSave(key, json); // Telegram: same progress on every device
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
    jumpPower: CONFIG.jumpBasePower,
    jumpCooldownTicks: jumpCooldownTicks(),
    jumpMaxCharges: p.jumpCharges,
    shields: p.shields, // free shields are a LEVEL perk (L5, L13)
  };
};

initTelegram(); // expands/locks the Telegram viewport; no-op in a browser

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
// Every run is a NEW random tower (owner: generative all the way). The seed
// itself is drawn outside the sim — the sim stays deterministic per seed.
let sim: SimState = createSim(Math.floor(Math.random() * 2 ** 31), simOpts());
// Recorded alongside every run so a ranking score can be proven rather than
// asserted. Costs one array push per tick and nothing at all if never sent.
let recorder: RunRecorder = createRecorder(sim.seed, simOpts().shields, simOpts().jumpMaxCharges);
const input = attachInput(canvas, () => tryJump());
const renderer = createRenderer(canvas, sim.blocks);
renderer.setSkin(skin);

// Telegram CloudStorage restore: if this device has no local progress but the
// account does, adopt it (fire and forget — boot never waits on the network).
if (inTelegram() && bank === 0 && level === 1) {
  void (async () => {
    const [cBank, cLevel, cInv, cBest, cSkin] = await Promise.all([
      cloudLoad("tf.bank"),
      cloudLoad("tf.level"),
      cloudLoad("tf.inv"),
      cloudLoad("tf.best"),
      cloudLoad("tf.skin"),
    ]);
    if (cBank === null && cLevel === null) return;
    try {
      if (cBank) bank = JSON.parse(cBank) as number;
      if (cLevel) level = JSON.parse(cLevel) as number;
      if (cBest) best = JSON.parse(cBest) as { score: number; depth: number };
      if (cSkin) {
        skin = JSON.parse(cSkin) as string;
        renderer.setSkin(skin);
      }
      if (cInv) Object.assign(inventory, JSON.parse(cInv) as Record<BoosterId, number>);
      save("tf.bank", bank);
      save("tf.level", level);
    } catch {
      // corrupt cloud payload — keep the local state
    }
  })();
}

const newRun = () => {
  clearTimeout(resultsTimer);
  sim = createSim(Math.floor(Math.random() * 2 ** 31), simOpts());
  const o = simOpts();
  recorder = createRecorder(sim.seed, o.shields, o.jumpMaxCharges);
  banked = false;
  lastBiome = biomeNameAt(0);
  renderer.setLayout(sim.blocks);
  ui.hideResults();
};

function tryActivate(id: BoosterId): void {
  if (sim.finished) return;
  if (sim.armed[id] || sim.runOn[id]) return;
  if ((inventory[id] ?? 0) <= 0) return;
  inventory[id]--;
  save("tf.inv", inventory);
  recorder.event(id);
  activateBooster(sim, id);
  SFX.booster();
  trackBoosterUse(daily);
  save("tf.daily", daily);
}

function tryJump(): void {
  recorder.event("jump"); // recorded even if refused — the replay refuses it too
  if (jump(sim)) {
    renderer.jumpFx(sim.ball);
    SFX.jump();
  }
}

// One voice per event kind, rate-limited so a big cascade stays musical
// rather than turning into white noise.
let sfxBudget = 0;
let sfxTick = -1;
function playSfx(events: SimEvent[]): void {
  if (sim.tick !== sfxTick) {
    sfxTick = sim.tick;
    sfxBudget = 3;
  }
  for (const e of events) {
    if (e.kind === "mine") {
      SFX.mine();
      haptic.death();
    }
    else if (e.kind === "mineblast") {
      SFX.mineBlast();
      haptic.boom();
    }
    else if (e.kind === "shield") SFX.shield();
    else if (e.kind === "bumper") SFX.bumper();
    else if (e.kind === "spike") SFX.spike();
    else if (e.kind === "break" && sfxBudget > 0) {
      sfxBudget--;
      if (e.btype === "bomb") {
        SFX.bomb();
        haptic.boom();
      }
      else if (e.btype === "stone") SFX.stone();
      else {
        SFX.glass(sim.combo);
        if (sim.combo >= 5) haptic.hit();
      }
    }
  }
}

let started = false; // the sim waits behind the title screen
let lastBiome = "";

// Wipe all saved progress (bank, boosters, level, skins, best, daily) and
// start clean. CloudStorage mirrors these keys, so it is blanked too —
// otherwise the next device sync would restore what was just erased.
function wipeProgress(): void {
  for (const k of ["tf.bank", "tf.inv", "tf.best", "tf.level", "tf.skin", "tf.daily"]) {
    try {
      localStorage.removeItem(k);
    } catch {
      // storage unavailable — nothing to wipe
    }
    cloudSave(k, "");
  }
  location.reload();
}

const ui = createUI({
  onReplay: newRun,
  onReset: wipeProgress,
  invert: { get: () => input.invertY(), toggle: () => input.toggleInvertY() },
  onActivate: tryActivate,
  onJump: tryJump,
  best: () => best,
  mute: { get: () => isMuted(), toggle: () => toggleMute() },
  onStart: () => {
    initAudio(); // browsers only allow audio after a gesture
    started = true;
    newRun();
  },
});

let resultsTimer = 0;
let lastNewBest = false;

// Fire-and-forget: the leaderboard must never be able to delay the death
// scene or the results card. Outside Telegram there is no signed identity, so
// there is nothing to submit and the board stays read-only.
function reportRun(): void {
  const initData = initDataRaw();
  if (!initData || sim.score <= 0) return;
  const snapshot = recorder; // newRun may replace it while the request is out
  void submitRun(
    { initData, score: sim.score, depth: sim.depth, level, skin },
    () => snapshot.proof(),
  ).then((r) => ui.setRank(r));
}

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
  reportRun();
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
    share: inTelegram() ? () => shareScore(sim.score, sim.depth, CONFIG.botUrl) : null,
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
        SFX.buy();
        inventory[id] = (inventory[id] ?? 0) + 1;
        save("tf.bank", bank);
        save("tf.inv", inventory);
      },
    },
    level: {
      current: () => level,
      cost: () => levelCost(level),
      jumpCdS: () => jumpCooldownTicks() * CONFIG.dt,
      shields: () => perksAt(level).shields,
      jumpCharges: () => perksAt(level).jumpCharges,
      nextText: () => nextPerkText(level),
      buy: () => {
        const cost = levelCost(level);
        if (bank < cost) return false;
        bank -= cost;
        level++;
        SFX.levelUp();
        haptic.win();
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
      tasks: () =>
        dailyTasks.map((t) => ({
          ...t,
          progress: daily.progress[t.id] ?? 0,
          claimed: daily.claimed[t.id] ?? false,
        })),
      claim: (id) => {
        const task = dailyTasks.find((t) => t.id === id);
        if (!task || daily.claimed[id]) return;
        if ((daily.progress[id] ?? 0) < task.goal) return;
        daily.claimed[id] = true;
        SFX.claim();
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

const clampShaft = (v: number, max: number) => Math.min(max - CONFIG.ballRadius, Math.max(CONFIG.ballRadius, v));

function controlTilt(kb: { x: number; z: number }): { x: number; z: number } {
  return driveTarget ? driveTilt(sim.ball, driveTarget, kb) : kb;
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
      const amp = isTouch() ? CONFIG.pointerDragAmplifyTouch : CONFIG.pointerDragAmplify;
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
  if (!started) {
    accumulator = 0; // frozen behind the title screen
  } else if (hitStopMs > 0) {
    hitStopMs = Math.max(0, hitStopMs - frameMs);
  } else {
    accumulator += frameMs * (slowMo ? CONFIG.slowMoScale : 1);
  }
  while (accumulator >= DT_MS) {
    const s = CONFIG.targetControl ? controlTilt(input.sample(nowMs, true)) : input.sample(nowMs);
    lastTilt = s;
    recorder.tick(s.x, s.z);
    const events = step(sim, s.x, s.z);
    if (events.length) {
      renderer.applyEvents(events);
      playSfx(events);
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
  // Announce a new biome the first time its depth is reached.
  const biomeNow = biomeNameAt(sim.depth);
  if (started && biomeNow !== lastBiome) {
    lastBiome = biomeNow;
    if (sim.depth > 0) ui.showBiome(biomeNow);
  }
  ui.setHud(sim.tick * CONFIG.dt, sim.score, sim.combo, sim.depth, sim.shields);
  ui.setJump(
    sim.jumpCharges > 0 ? 1 : 1 - sim.jumpCd / sim.jumpCooldownTicks,
    sim.jumpCharges,
    sim.jumpMaxCharges,
    sim.jumpCd * CONFIG.dt,
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
  // Testing helper: run `__tf.reset()` in the console. Players get the same
  // thing from the RESET PROGRESS button on the results card.
  reset: wipeProgress,
};

renderer.engine.runRenderLoop(() => renderer.scene.render());
window.addEventListener("resize", () => renderer.engine.resize());
