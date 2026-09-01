// Boot + fixed-timestep game loop (§2 override of babylon.md's frame-delta
// guidance): gameplay advances ONLY through sim.step.
import "./style.css";
import { CONFIG } from "./config";
import { buildTower } from "./levelgen";
import { createSim, predictPath, step, type SimState } from "./sim";
import { attachInput } from "./input";
import { createRenderer } from "./render";
import { createUI } from "./ui";

const M1_SEED = 20260901; // fixed seed for M1 (date-seeded Daily arrives in M4)
const DT_MS = 1000 * CONFIG.dt;
const MAX_FRAME_MS = 100;

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const layout = buildTower(M1_SEED);
let sim: SimState = createSim(layout);
const input = attachInput(canvas);
const renderer = createRenderer(canvas, layout);
const ui = createUI(
  () => {
    sim = createSim(layout);
    renderer.resetBlocks();
    ui.hideResults();
  },
  { get: () => input.invertY(), toggle: () => input.toggleInvertY() },
);

let accumulator = 0;
let hitStopMs = 0;
let lastTilt = { x: 0, z: 0 };
let lastLandY = CONFIG.firstTierTopY + CONFIG.blockH;
let driveTarget: { x: number; z: number } | null = null;
let dragAnchor: { x: number; z: number } | null = null;

const clampT = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
const clampShaft = (v: number, max: number) => Math.min(max - CONFIG.ballRadius, Math.max(CONFIG.ballRadius, v));

// Target control (owner design): the pointer drives the landing disc; this
// PD controller synthesizes ordinary tilt input that chases it, so the sim
// contract (tilt in, deterministic ticks) is untouched.
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

  // RELATIVE pointer drag: at touch-start anchor the target on the ball,
  // then move it by the amplified world-space drag delta (picked on the
  // ball's plane, so screen motion maps 1:1 to world directions). The finger
  // never has to sit on top of the action.
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

  if (hitStopMs > 0) {
    hitStopMs -= frameMs; // sim holds its breath; shards keep flying
  } else {
    accumulator += frameMs;
  }
  while (accumulator >= DT_MS) {
    const s = CONFIG.targetControl ? controlTilt(input.sample(nowMs, true)) : input.sample(nowMs);
    lastTilt = s;
    const events = step(sim, s.x, s.z);
    if (events.length) {
      renderer.applyEvents(events);
      hitStopMs = Math.max(hitStopMs, renderer.consumeHitStop());
      if (events.some((e) => e.kind === "finish")) {
        ui.showResults({
          timeS: sim.finishTick * CONFIG.dt,
          score: sim.score,
          broken: sim.broken,
          maxCombo: sim.maxCombo,
        });
      }
    }
    accumulator -= DT_MS;
  }

  renderer.syncBall(sim.ball);
  const path = sim.finished ? null : predictPath(sim, lastTilt.x, lastTilt.z);
  if (path && path.length) lastLandY = path[path.length - 1].y;
  renderer.setAim(path, driveTarget ? { x: driveTarget.x, y: lastLandY, z: driveTarget.z } : null);
  renderer.frame(frameMs, lastTilt);
  ui.setHud(sim.tick * CONFIG.dt, sim.score, sim.combo);
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
  setTilt(x: number, z: number) {
    input.setForced({ x, z });
  },
  clearTilt() {
    input.setForced(null);
  },
  replay() {
    sim = createSim(layout);
    renderer.resetBlocks();
    ui.hideResults();
  },
};

renderer.engine.runRenderLoop(() => renderer.scene.render());
window.addEventListener("resize", () => renderer.engine.resize());
