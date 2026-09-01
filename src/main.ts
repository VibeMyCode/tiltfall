// Boot + fixed-timestep game loop (§2 override of babylon.md's frame-delta
// guidance): gameplay advances ONLY through sim.step. No mid-run stops —
// boosters are bought in the post-run shop and activated on demand (owner).
import "./style.css";
import { CONFIG } from "./config";
import { BOOSTER_ORDER, type BoosterId } from "./boosters";
import { buildTower } from "./levelgen";
import { activateBooster, createSim, predictPath, step, type SimState } from "./sim";
import { attachInput } from "./input";
import { createRenderer } from "./render";
import { createUI } from "./ui";

const M1_SEED = 20260901;
const DT_MS = 1000 * CONFIG.dt;
const MAX_FRAME_MS = 100;

// --- Persistence (bank, booster inventory, best) ---------------------------
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
let inventory = load<Record<BoosterId, number>>("tf.inv", { quake: 0, chain: 0, x2: 0, heavy: 0, bounce: 0, feather: 0 });
let best = load<{ score: number; combo: number }>("tf.best", { score: 0, combo: 1 });
let banked = false; // guards double-banking a finished run

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const layout = buildTower(M1_SEED);
let sim: SimState = createSim(layout);
const input = attachInput(canvas);
const renderer = createRenderer(canvas, layout);

const newRun = () => {
  sim = createSim(layout);
  banked = false;
  renderer.resetBlocks();
  ui.hideResults();
};

function tryActivate(id: BoosterId): void {
  if (sim.finished) return;
  if ((sim.boosterTimers[id] ?? 0) > 0) return; // already running
  if ((inventory[id] ?? 0) <= 0) return;
  inventory[id]--;
  save("tf.inv", inventory);
  activateBooster(sim, id);
}

const ui = createUI(newRun, { get: () => input.invertY(), toggle: () => input.toggleInvertY() }, tryActivate);

function onFinish(): void {
  if (banked) return;
  banked = true;
  bank += sim.score;
  const newBest = sim.score > best.score || sim.maxCombo > best.combo;
  best = { score: Math.max(best.score, sim.score), combo: Math.max(best.combo, sim.maxCombo) };
  save("tf.bank", bank);
  save("tf.best", best);
  ui.showResults({
    timeS: sim.finishTick * CONFIG.dt,
    score: sim.score,
    broken: sim.broken,
    maxCombo: sim.maxCombo,
    bestScore: best.score,
    bestCombo: best.combo,
    newBest,
    shop: {
      get bank() {
        return bank;
      },
      inventory,
      buy(id) {
        const price = CONFIG.boosters[id].price;
        if (bank < price) return;
        bank -= price;
        inventory[id] = (inventory[id] ?? 0) + 1;
        save("tf.bank", bank);
        save("tf.inv", inventory);
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

// Target control: the pointer drives the landing disc; a PD controller
// synthesizes ordinary tilt input that chases it (sim contract untouched).
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

  // RELATIVE pointer drag (owner): anchor the target on the ball at
  // touch-start, then move it by the amplified world-space drag delta.
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

  // Chain-bomb showcase (owner): cascades play out in slow motion.
  const slowMo = (sim.boosterTimers.chain ?? 0) > 0 && sim.queue.length > 0;
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
      hitStopMs = Math.max(hitStopMs, renderer.consumeHitStop());
      if (events.some((e) => e.kind === "finish")) onFinish();
    }
    accumulator -= DT_MS;
  }

  renderer.syncBall(sim.ball);
  const path = sim.finished ? null : predictPath(sim, lastTilt.x, lastTilt.z);
  if (path && path.points.length && !path.wallHit) lastLandY = path.points[path.points.length - 1].y;
  renderer.setAim(
    path ? path.points : null,
    driveTarget ? { x: driveTarget.x, y: lastLandY, z: driveTarget.z } : null,
    path ? path.wallHit : false,
  );
  renderer.frame(frameMs, lastTilt);
  ui.setHud(sim.tick * CONFIG.dt, sim.score, sim.combo);
  ui.setBoosterBar(inventory, sim.boosterTimers);
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
  get inventory() {
    return { ...inventory };
  },
  get timers() {
    return { ...sim.boosterTimers };
  },
  grant(id: BoosterId, n = 1) {
    inventory[id] = (inventory[id] ?? 0) + n;
  },
  activate(i: number) {
    tryActivate(BOOSTER_ORDER[i]);
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
};

renderer.engine.runRenderLoop(() => renderer.scene.render());
window.addEventListener("resize", () => renderer.engine.resize());
