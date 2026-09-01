import "./style.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

// =====================================================================
// M0 FEEL PROBE (SPEC.md §11 M0) — single file, throwaway by contract.
// One tier of blocks, §3.3 physics, gravity-tilt trick, drag input,
// one support block cascading 3 dependents. Flat colors, no textures.
// =====================================================================

// Logical space (§2): tower-local, X/Z ∈ [0, 1200], Y DOWN from 0 at the top.
const SHAFT_W = 1200;
const SHAFT_D = 1200;
const TIER_SPACING = 700;
const TOWER_T = 5 * TIER_SPACING;
// M0 probe: floor one tier-ish below the block layer, so the smash payoff and
// the landing stay in one camera view (full 5-tier depth returns in M1).
const FLOOR_Y = 2200;
const BALL_RADIUS = 40;

// Physics (§3.3) — fixed timestep, semi-implicit Euler.
const DT = 1 / 120;
const DT_MS = 1000 / 120;
const MAX_FRAME_MS = 100;
const G0 = 3200;
const K_TILT = 0.6;
const DRAG = 0.999;
const MAX_SPEED = 2500;
const WALL_RESTITUTION = 0.6;
const FLOOR_RESTITUTION = 0.35;
const BLOCK_RESTITUTION = 0.5;
const FRICTION = 0.98;

// Breaking (§3.3): J = round(|v_axis| * mass / impulseScale), calibrated so a
// one-tier free fall lands at J ≈ 25 (v ≈ 2400 → scale 96).
const BALL_MASS = 1;
const IMPULSE_SCALE = 96;
const BREAK_THROUGH_LOSS = 0.62; // punchy: smashing through visibly costs speed
const THR_GLASS = 8;
const THR_STONE = 22;
const CASCADE_STEP_TICKS = 12;

// Block tier (M0: one tier). Grid 8×8 of 100-unit cells centered in the shaft.
const GRID_N = 8;
const CELL = 100;
const GRID_X0 = 200; // grid spans 200..1000 on both axes
const TIER_TOP_Y = 1100; // block tops (sim Y, down-positive)
const BLOCK_H = 100;

// Ball spawn: dead-center over the support cell for a guaranteed first-drop
// cascade (the M0 wow moment), then free play via tilt.
const SPAWN = { x: 650, y: 160, z: 650 };

// Tilt input (§3.1/§2) — pointer drag only this milestone.
const TILT_FULL_DRAG_PX = 140;
const TILT_RELEASE_EASE_MS = 250;

// Visual tilt (§2): renderer rotates the tower mesh; the sim NEVER rotates.
// Signs are set by LOOKING at the running game (SPEC §2), not derived.
const VISUAL_TILT_SIGN_X = 1;
const VISUAL_TILT_SIGN_Z = 1;
const MAX_VISUAL_TILT_DEG = 12;

// Camera.
const CAM_HEIGHT = 1500;
const CAM_DIST = 950;
const CAM_FOV = 0.9;

// Auto-reset: ball resting on the floor → fresh tier (fast feel iteration).
const REST_SPEED = 60;
const REST_TICKS = 110;

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
canvas.style.touchAction = "none";

// =====================================================================
// INPUT — pointer drag → tilt in [-1,1] per axis, sampled once per tick.
// =====================================================================

const clampTilt = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

let dragging = false;
let originX = 0;
let originY = 0;
let lastX = 0;
let lastY = 0;
let releaseTiltX = 0;
let releaseTiltZ = 0;
let releaseTime = -1e9;
let forcedTilt: { x: number; z: number } | null = null; // debug/probe hook

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  originX = e.clientX;
  originY = e.clientY;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (dragging) {
    lastX = e.clientX;
    lastY = e.clientY;
  }
});
const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  releaseTiltX = clampTilt((lastX - originX) / TILT_FULL_DRAG_PX);
  releaseTiltZ = clampTilt((lastY - originY) / TILT_FULL_DRAG_PX);
  releaseTime = performance.now();
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

function currentTilt(nowMs: number): { x: number; z: number } {
  if (forcedTilt) return forcedTilt;
  if (dragging) {
    return {
      x: clampTilt((lastX - originX) / TILT_FULL_DRAG_PX),
      z: clampTilt((lastY - originY) / TILT_FULL_DRAG_PX),
    };
  }
  const k = Math.max(0, 1 - (nowMs - releaseTime) / TILT_RELEASE_EASE_MS);
  return { x: releaseTiltX * k, z: releaseTiltZ * k };
}

function sampleInput(nowMs: number): { x: number; z: number } {
  const t = currentTilt(nowMs);
  return { x: Math.round(t.x * 1000) / 1000, z: Math.round(t.z * 1000) / 1000 };
}

// =====================================================================
// SIM — pure math, axis-aligned, deterministic layout (§2, §3.3, §4).
// =====================================================================

type BlockType = "glass" | "stone" | "support" | "dep";

interface Block {
  id: number;
  type: BlockType;
  cx: number; // AABB center, sim coords
  cy: number;
  cz: number;
  threshold: number;
  damage: number;
  broken: boolean;
}

interface SimEvent {
  kind: "break" | "reset";
  id?: number;
  cascade?: boolean;
}

const ball = { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, vx: 0, vy: 0, vz: 0 };
let blocks: Block[] = [];
let breakQueue: { tick: number; id: number }[] = [];
let tick = 0;
let restTicks = 0;
let brokenCount = 0;
let resets = 0;
const simEvents: SimEvent[] = []; // consumed by the renderer each frame

// mulberry32 — deterministic tier layout from a fixed seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Support cluster: support at cell (4,4), dependents at (4,5),(5,4),(5,5).
const SUPPORT_CELL = 4 * GRID_N + 4;
const DEP_CELLS = [4 * GRID_N + 5, 5 * GRID_N + 4, 5 * GRID_N + 5];

function buildTier(): Block[] {
  const rng = mulberry32(20260901);
  const out: Block[] = [];
  for (let r = 0; r < GRID_N; r++) {
    for (let c = 0; c < GRID_N; c++) {
      const cell = r * GRID_N + c;
      let type: BlockType | null = null;
      if (cell === SUPPORT_CELL) type = "support";
      else if (DEP_CELLS.includes(cell)) type = "dep";
      else if (rng() < 0.42) type = rng() < 0.18 ? "stone" : "glass";
      if (!type) continue;
      out.push({
        id: cell,
        type,
        cx: GRID_X0 + c * CELL + CELL / 2,
        cy: TIER_TOP_Y + BLOCK_H / 2,
        cz: GRID_X0 + r * CELL + CELL / 2,
        threshold: type === "stone" ? THR_STONE : THR_GLASS,
        damage: 0,
        broken: false,
      });
    }
  }
  return out;
}

function breakBlock(b: Block, cascade: boolean): void {
  if (b.broken) return;
  b.broken = true;
  brokenCount++;
  simEvents.push({ kind: "break", id: b.id, cascade });
  if (b.type === "support") {
    // Dependents fall in a staggered chain — the M0 avalanche.
    DEP_CELLS.forEach((cell, i) => {
      breakQueue.push({ tick: tick + CASCADE_STEP_TICKS * (i + 1), id: cell });
    });
  }
}

function processBreakQueue(): void {
  // Deterministic total order: by (tick, id) — §4.2.
  breakQueue.sort((a, b) => a.tick - b.tick || a.id - b.id);
  while (breakQueue.length && breakQueue[0].tick <= tick) {
    const e = breakQueue.shift()!;
    const b = blocks.find((x) => x.id === e.id);
    if (b) breakBlock(b, true);
  }
}

function resetRun(): void {
  ball.x = SPAWN.x;
  ball.y = SPAWN.y;
  ball.z = SPAWN.z;
  ball.vx = ball.vy = ball.vz = 0;
  blocks = buildTier();
  breakQueue = [];
  restTicks = 0;
  resets++;
  simEvents.push({ kind: "reset" });
}

function resolveBlocks(): void {
  // Ascending id order (§4.2/§3.3 contact order; floor and walls first).
  const r = BALL_RADIUS;
  for (const b of blocks) {
    if (b.broken) continue;
    const hx = CELL / 2 + r;
    const hy = BLOCK_H / 2 + r;
    const dx = ball.x - b.cx;
    const dy = ball.y - b.cy;
    const dz = ball.z - b.cz;
    if (Math.abs(dx) >= hx || Math.abs(dy) >= hy || Math.abs(dz) >= hx) continue;
    // Minimum-penetration axis (corner ≈ face — spec-sanctioned §3.3).
    const px = hx - Math.abs(dx);
    const py = hy - Math.abs(dy);
    const pz = hx - Math.abs(dz);
    let axis: "x" | "y" | "z" = px <= py && px <= pz ? "x" : py <= pz ? "y" : "z";
    const vAxis = axis === "x" ? ball.vx : axis === "y" ? ball.vy : ball.vz;
    const j = Math.round((Math.abs(vAxis) * BALL_MASS) / IMPULSE_SCALE);
    if (b.damage + j >= b.threshold) {
      // Break-through (§3.3): no bounce, small normal-speed loss.
      breakBlock(b, false);
      if (axis === "x") ball.vx *= BREAK_THROUGH_LOSS;
      else if (axis === "y") ball.vy *= BREAK_THROUGH_LOSS;
      else ball.vz *= BREAK_THROUGH_LOSS;
      continue;
    }
    b.damage += j;
    // Push out along the axis, reflect that component, friction on the rest.
    if (axis === "x") {
      ball.x = b.cx + Math.sign(dx) * hx;
      ball.vx = -ball.vx * BLOCK_RESTITUTION;
      ball.vy *= FRICTION;
      ball.vz *= FRICTION;
    } else if (axis === "y") {
      ball.y = b.cy + Math.sign(dy) * hy;
      ball.vy = -ball.vy * BLOCK_RESTITUTION;
      ball.vx *= FRICTION;
      ball.vz *= FRICTION;
    } else {
      ball.z = b.cz + Math.sign(dz) * hx;
      ball.vz = -ball.vz * BLOCK_RESTITUTION;
      ball.vx *= FRICTION;
      ball.vy *= FRICTION;
    }
  }
}

function resolveFloor(): void {
  if (ball.y + BALL_RADIUS > FLOOR_Y) {
    ball.y = FLOOR_Y - BALL_RADIUS;
    if (ball.vy > 0) ball.vy = -ball.vy * FLOOR_RESTITUTION;
    ball.vx *= FRICTION;
    ball.vz *= FRICTION;
  }
}

function resolveWalls(): void {
  if (ball.x < BALL_RADIUS) {
    ball.x = BALL_RADIUS;
    if (ball.vx < 0) ball.vx = -ball.vx * WALL_RESTITUTION;
  }
  if (ball.x > SHAFT_W - BALL_RADIUS) {
    ball.x = SHAFT_W - BALL_RADIUS;
    if (ball.vx > 0) ball.vx = -ball.vx * WALL_RESTITUTION;
  }
  if (ball.z < BALL_RADIUS) {
    ball.z = BALL_RADIUS;
    if (ball.vz < 0) ball.vz = -ball.vz * WALL_RESTITUTION;
  }
  if (ball.z > SHAFT_D - BALL_RADIUS) {
    ball.z = SHAFT_D - BALL_RADIUS;
    if (ball.vz > 0) ball.vz = -ball.vz * WALL_RESTITUTION;
  }
}

function simStep(tiltX: number, tiltZ: number): void {
  tick++;
  ball.vx += G0 * K_TILT * tiltX * DT;
  ball.vy += G0 * DT;
  ball.vz += G0 * K_TILT * tiltZ * DT;
  ball.vx *= DRAG;
  ball.vy *= DRAG;
  ball.vz *= DRAG;
  const s2 = ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz;
  if (s2 > MAX_SPEED * MAX_SPEED) {
    const s = MAX_SPEED / Math.sqrt(s2);
    ball.vx *= s;
    ball.vy *= s;
    ball.vz *= s;
  }
  ball.x += ball.vx * DT;
  ball.y += ball.vy * DT;
  ball.z += ball.vz * DT;
  // Fixed contact order (§5.4): floor/slabs → walls W0..W3 → blocks by id.
  resolveFloor();
  resolveWalls();
  resolveBlocks();
  processBreakQueue();
  // Auto-reset once the ball rests on the floor.
  const speed = Math.sqrt(s2);
  const onFloor = ball.y + BALL_RADIUS >= FLOOR_Y - 1;
  restTicks = onFloor && speed < REST_SPEED ? restTicks + 1 : 0;
  if (restTicks > REST_TICKS) resetRun();
}

blocks = buildTier();

// =====================================================================
// RENDER — Babylon mirrors sim state. Sim (y down) → tower-local (x-600,
// -y, z-600); everything sim-rendered is parented to the tilting tower.
// =====================================================================

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.05, 0.06, 0.1, 1);

const light = new HemisphericLight("light", new Vector3(0.2, 1, 0.1));
light.intensity = 1.2;
light.groundColor = new Color3(0.15, 0.15, 0.2);

const camera = new TargetCamera("camera", new Vector3(0, 0, 0), scene);
camera.fov = CAM_FOV;
scene.activeCamera = camera;
const CAM_SMOOTH = 0.09; // per-frame lerp factor (render-only feel, not sim)
const camPos = new Vector3(SPAWN.x, -SPAWN.y + CAM_HEIGHT, SPAWN.z + CAM_DIST);
const camAim = new Vector3(SPAWN.x, -SPAWN.y, SPAWN.z);
const camGoal = new Vector3(0, 0, 0);

function makeMaterial(name: string, rgb: [number, number, number], emissive: number, alpha = 1): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(rgb[0], rgb[1], rgb[2]);
  m.specularColor = new Color3(0, 0, 0);
  m.emissiveColor = new Color3(rgb[0] * emissive, rgb[1] * emissive, rgb[2] * emissive);
  if (alpha < 1) m.alpha = alpha;
  return m;
}

const tower = new TransformNode("tower", scene);
tower.position = new Vector3(SHAFT_W / 2, 0, SHAFT_D / 2);
const toLocal = (sx: number, sy: number, sz: number) =>
  new Vector3(sx - SHAFT_W / 2, -sy, sz - SHAFT_D / 2);

const floorMesh = MeshBuilder.CreateBox("floor", { width: SHAFT_W, height: 80, depth: SHAFT_D }, scene);
floorMesh.position = toLocal(SHAFT_W / 2, FLOOR_Y + 40, SHAFT_D / 2);
floorMesh.material = makeMaterial("mFloor", [0.18, 0.22, 0.32], 0.4);
floorMesh.parent = tower;

const WALL_H = TOWER_T + 200;
const WALL_T = 60;
const wallMat = makeMaterial("mWall", [0.26, 0.3, 0.46], 0.25);
function makeWall(name: string, w: number, d: number, px: number, pz: number, visible: boolean): void {
  const wall = MeshBuilder.CreateBox(name, { width: w, height: WALL_H, depth: d }, scene);
  wall.position = new Vector3(px, -WALL_H / 2, pz);
  wall.material = wallMat;
  wall.parent = tower;
  if (!visible) wall.setEnabled(false); // sim plane still exists
}
makeWall("w0", WALL_T, SHAFT_D + WALL_T, -(SHAFT_W / 2 + WALL_T / 2), 0, true);
makeWall("w1", WALL_T, SHAFT_D + WALL_T, SHAFT_W / 2 + WALL_T / 2, 0, true);
makeWall("w2", SHAFT_W + WALL_T, WALL_T, 0, -(SHAFT_D / 2 + WALL_T / 2), true);
makeWall("w3", SHAFT_W + WALL_T, WALL_T, 0, SHAFT_D / 2 + WALL_T / 2, false); // camera side

const MATS: Record<BlockType, StandardMaterial> = {
  glass: makeMaterial("mGlass", [0.3, 0.75, 0.95], 0.25, 0.55),
  stone: makeMaterial("mStone", [0.45, 0.47, 0.55], 0.1),
  support: makeMaterial("mSupport", [1.0, 0.65, 0.15], 0.5),
  dep: makeMaterial("mDep", [0.75, 0.55, 0.95], 0.3),
};

const blockMeshes = new Map<number, Mesh>();
for (const b of blocks) {
  const mesh = MeshBuilder.CreateBox(`b${b.id}`, { size: CELL - 6 }, scene);
  mesh.position = toLocal(b.cx, b.cy, b.cz);
  mesh.material = MATS[b.type];
  mesh.parent = tower;
  blockMeshes.set(b.id, mesh);
}

const ballMesh = MeshBuilder.CreateSphere("ball", { diameter: BALL_RADIUS * 2 }, scene);
ballMesh.material = makeMaterial("mBall", [0.35, 0.9, 1.0], 0.9);
ballMesh.parent = tower;

// --- Shards: render-only canned break animation (§4.2 — the sim never
// knows shards exist; Math.random here is fine, it is visual only).
interface Shard {
  mesh: Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  rz: number;
  life: number;
}
const shards: Shard[] = [];
let shakeAmp = 0;

function spawnShards(b: Block): void {
  const base = toLocal(b.cx, b.cy, b.cz);
  const mat = MATS[b.type];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const size = 20 + Math.random() * 16;
    const m = MeshBuilder.CreateBox(`sh`, { size }, scene);
    m.material = mat;
    m.parent = tower;
    m.position = base.add(
      new Vector3((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70),
    );
    shards.push({
      mesh: m,
      vx: (Math.random() - 0.5) * 700,
      vy: 150 + Math.random() * 450,
      vz: (Math.random() - 0.5) * 700,
      rx: (Math.random() - 0.5) * 8,
      rz: (Math.random() - 0.5) * 8,
      life: 1.15,
    });
  }
}

function updateShards(dtS: number): void {
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.life -= dtS;
    if (s.life <= 0) {
      s.mesh.dispose();
      shards.splice(i, 1);
      continue;
    }
    s.vy -= 2600 * dtS;
    s.mesh.position.x += s.vx * dtS;
    s.mesh.position.y += s.vy * dtS;
    s.mesh.position.z += s.vz * dtS;
    s.mesh.rotation.x += s.rx * dtS;
    s.mesh.rotation.z += s.rz * dtS;
    const k = Math.min(1, s.life / 1.15);
    s.mesh.scaling.setAll(k);
  }
}

// --- Fixed-timestep accumulator (SPEC §2 override of babylon.md's
// frame-delta guidance): gameplay advances ONLY through simStep.
let accumulator = 0;
scene.onBeforeRenderObservable.add(() => {
  const nowMs = performance.now();
  const frameMs = Math.min(engine.getDeltaTime(), MAX_FRAME_MS);
  accumulator += frameMs;
  while (accumulator >= DT_MS) {
    const input = sampleInput(nowMs);
    simStep(input.x, input.z);
    accumulator -= DT_MS;
  }

  // Consume sim events.
  for (const e of simEvents) {
    if (e.kind === "break" && e.id !== undefined) {
      const mesh = blockMeshes.get(e.id);
      const b = blocks.find((x) => x.id === e.id);
      if (mesh) mesh.setEnabled(false);
      if (b) spawnShards(b);
      shakeAmp = Math.min(30, shakeAmp + (e.cascade ? 10 : 6));
    } else if (e.kind === "reset") {
      for (const [, mesh] of blockMeshes) mesh.setEnabled(true);
    }
  }
  simEvents.length = 0;

  updateShards(frameMs / 1000);

  // Mirror ball, tilt the tower (visual only — §2).
  ballMesh.position = toLocal(ball.x, ball.y, ball.z);
  const t = currentTilt(nowMs);
  const maxRad = (MAX_VISUAL_TILT_DEG * Math.PI) / 180;
  tower.rotation.z = VISUAL_TILT_SIGN_X * t.x * maxRad;
  tower.rotation.x = VISUAL_TILT_SIGN_Z * t.z * maxRad;

  // Camera follows the ball's world position (after tilt) with smoothing —
  // the lag keeps a fresh cascade in view for a beat as the ball drops away.
  ballMesh.computeWorldMatrix(true);
  const p = ballMesh.getAbsolutePosition();
  camGoal.set(p.x, p.y + CAM_HEIGHT, p.z + CAM_DIST);
  camPos.x += (camGoal.x - camPos.x) * CAM_SMOOTH;
  camPos.y += (camGoal.y - camPos.y) * CAM_SMOOTH;
  camPos.z += (camGoal.z - camPos.z) * CAM_SMOOTH;
  camAim.x += (p.x - camAim.x) * CAM_SMOOTH;
  camAim.y += (p.y - camAim.y) * CAM_SMOOTH;
  camAim.z += (p.z - camAim.z) * CAM_SMOOTH;
  const jx = shakeAmp > 0.5 ? (Math.random() - 0.5) * shakeAmp : 0;
  const jy = shakeAmp > 0.5 ? (Math.random() - 0.5) * shakeAmp : 0;
  shakeAmp *= 0.88;
  camera.position.set(camPos.x + jx, camPos.y + jy, camPos.z);
  camera.setTarget(camAim);

  (window as unknown as { __DSH_READY: boolean }).__DSH_READY = true;
});

// Debug/probe hook — used by the headless verification script only.
(window as unknown as { __tf: unknown }).__tf = {
  get broken() {
    return brokenCount;
  },
  get resets() {
    return resets;
  },
  get ball() {
    return { x: ball.x, y: ball.y, z: ball.z };
  },
  setTilt(x: number, z: number) {
    forcedTilt = { x: clampTilt(x), z: clampTilt(z) };
  },
  clearTilt() {
    forcedTilt = null;
  },
};

engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
