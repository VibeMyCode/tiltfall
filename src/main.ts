// Boot + fixed-timestep game loop (§2 override of babylon.md's frame-delta
// guidance): gameplay advances ONLY through sim.step.
import "./style.css";
import { CONFIG } from "./config";
import { buildTower } from "./levelgen";
import { createSim, step, type SimState } from "./sim";
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
const ui = createUI(() => {
  sim = createSim(layout);
  renderer.resetBlocks();
  ui.hideResults();
});

let accumulator = 0;
let hitStopMs = 0;

renderer.scene.onBeforeRenderObservable.add(() => {
  const nowMs = performance.now();
  const frameMs = Math.min(renderer.engine.getDeltaTime(), MAX_FRAME_MS);
  if (hitStopMs > 0) {
    hitStopMs -= frameMs; // sim holds its breath; shards keep flying
  } else {
    accumulator += frameMs;
  }
  while (accumulator >= DT_MS) {
    const s = input.sample(nowMs);
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
  renderer.frame(frameMs, input.current(nowMs));
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
