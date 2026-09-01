// Pure simulation (§3.3, §4.2, §5.4): zero Babylon imports, no Math.random,
// no Date, no transcendentals. Same layout + same input log ⇒ same run.
import { CONFIG } from "./config";
import type { BlockDef } from "./levelgen";

export interface SimBlock extends BlockDef {
  damage: number;
  broken: boolean;
}

export interface SimEvent {
  kind: "break" | "finish";
  id?: number;
  cascade?: boolean;
  // ball velocity at break time — the renderer's shards inherit the impact
  bvx?: number;
  bvy?: number;
  bvz?: number;
}

export interface SimState {
  tick: number;
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  blocks: SimBlock[];
  groupDamage: Record<number, number>;
  queue: { tick: number; groupId: number }[];
  combo: number;
  maxCombo: number;
  lastBreakTick: number;
  score: number;
  broken: number; // broken GROUPS (pieces), not segments
  restTicks: number;
  finished: boolean;
  finishTick: number;
}

export function createSim(layout: BlockDef[]): SimState {
  return {
    tick: 0,
    ball: { x: CONFIG.spawn.x, y: CONFIG.spawn.y, z: CONFIG.spawn.z, vx: 0, vy: 0, vz: 0 },
    blocks: layout.map((b) => ({ ...b, damage: 0, broken: false })),
    groupDamage: {},
    queue: [],
    combo: 1,
    maxCombo: 1,
    lastBreakTick: -1e9,
    score: 0,
    broken: 0,
    restTicks: 0,
    finished: false,
    finishTick: 0,
  };
}

// Break a whole piece: all its segments shatter together; score once.
function breakGroup(s: SimState, groupId: number, cascade: boolean, events: SimEvent[]): void {
  let any = false;
  let deps: number[] = [];
  for (const b of s.blocks) {
    if (b.groupId !== groupId || b.broken) continue;
    b.broken = true;
    any = true;
    if (b.deps.length) deps = deps.concat(b.deps);
    events.push({ kind: "break", id: b.id, cascade, bvx: s.ball.vx, bvy: s.ball.vy, bvz: s.ball.vz });
    if (b.primary) {
      // Combo (§3.5): one step per PIECE; points scale with piece size.
      s.combo = s.tick - s.lastBreakTick <= CONFIG.comboWindowTicks ? Math.min(CONFIG.comboMax, s.combo + 1) : 1;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.lastBreakTick = s.tick;
      s.score += CONFIG.points[b.type] * b.cells * s.combo;
    }
  }
  if (!any) return;
  s.broken++;
  // Support cascade (§4.2): dependent pieces fall in a staggered chain.
  deps.forEach((depGroup, i) => {
    s.queue.push({ tick: s.tick + CONFIG.cascadeStepTicks * (i + 1), groupId: depGroup });
  });
}

function processQueue(s: SimState, events: SimEvent[]): void {
  // Deterministic total order: by (tick, groupId) — §4.2.
  s.queue.sort((a, b) => a.tick - b.tick || a.groupId - b.groupId);
  while (s.queue.length && s.queue[0].tick <= s.tick) {
    const e = s.queue.shift()!;
    breakGroup(s, e.groupId, true, events);
  }
}

function resolveBlocks(s: SimState, events: SimEvent[]): void {
  const { ball } = s;
  const r = CONFIG.ballRadius;
  // Ascending segment id order (§3.3 contact order; floor/walls first).
  for (const b of s.blocks) {
    if (b.broken) continue;
    const hx = b.hx + r;
    const hy = b.hy + r;
    const hz = b.hz + r;
    const dx = ball.x - b.cx;
    const dy = ball.y - b.cy;
    const dz = ball.z - b.cz;
    if (Math.abs(dx) >= hx || Math.abs(dy) >= hy || Math.abs(dz) >= hz) continue;
    // Minimum-penetration axis (corner ≈ face — §3.3).
    const px = hx - Math.abs(dx);
    const py = hy - Math.abs(dy);
    const pz = hz - Math.abs(dz);
    const axis: "x" | "y" | "z" = px <= py && px <= pz ? "x" : py <= pz ? "y" : "z";
    const vAxis = axis === "x" ? ball.vx : axis === "y" ? ball.vy : ball.vz;
    const j = Math.round((Math.abs(vAxis) * CONFIG.ballMass) / CONFIG.impulseScale);
    const dmg = (s.groupDamage[b.groupId] ?? 0) + j;
    if (dmg >= b.threshold) {
      // Break-through (§3.3): no bounce, punchy speed loss on the hit axis.
      breakGroup(s, b.groupId, false, events);
      if (axis === "x") ball.vx *= CONFIG.breakThroughLoss;
      else if (axis === "y") ball.vy *= CONFIG.breakThroughLoss;
      else ball.vz *= CONFIG.breakThroughLoss;
      continue;
    }
    s.groupDamage[b.groupId] = dmg;
    if (axis === "x") {
      ball.x = b.cx + Math.sign(dx) * hx;
      ball.vx = -ball.vx * CONFIG.blockRestitution;
      ball.vy *= CONFIG.friction;
      ball.vz *= CONFIG.friction;
    } else if (axis === "y") {
      ball.y = b.cy + Math.sign(dy) * hy;
      ball.vy = -ball.vy * CONFIG.blockRestitution;
      ball.vx *= CONFIG.friction;
      ball.vz *= CONFIG.friction;
    } else {
      ball.z = b.cz + Math.sign(dz) * hz;
      ball.vz = -ball.vz * CONFIG.blockRestitution;
      ball.vx *= CONFIG.friction;
      ball.vy *= CONFIG.friction;
    }
  }
}

// One fixed 1/120 s step. Input is the per-tick sampled tilt (§3.1).
export function step(s: SimState, tiltX: number, tiltZ: number): SimEvent[] {
  const events: SimEvent[] = [];
  if (s.finished) return events;
  s.tick++;
  const { ball } = s;
  const C = CONFIG;
  ball.vx += C.g0 * C.kTilt * tiltX * C.dt;
  ball.vy += C.g0 * C.dt;
  ball.vz += C.g0 * C.kTilt * tiltZ * C.dt;
  ball.vx *= C.drag;
  ball.vy *= C.drag;
  ball.vz *= C.drag;
  const s2 = ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz;
  if (s2 > C.maxSpeed * C.maxSpeed) {
    const k = C.maxSpeed / Math.sqrt(s2);
    ball.vx *= k;
    ball.vy *= k;
    ball.vz *= k;
  }
  ball.x += ball.vx * C.dt;
  ball.y += ball.vy * C.dt;
  ball.z += ball.vz * C.dt;

  // Fixed contact order (§5.4): floor → walls W0..W3 → blocks by id.
  if (ball.y + C.ballRadius > C.floorY) {
    ball.y = C.floorY - C.ballRadius;
    if (ball.vy > 0) ball.vy = -ball.vy * C.floorRestitution;
    ball.vx *= C.friction;
    ball.vz *= C.friction;
  }
  if (ball.x < C.ballRadius) {
    ball.x = C.ballRadius;
    if (ball.vx < 0) ball.vx = -ball.vx * C.wallRestitution;
  }
  if (ball.x > C.shaftW - C.ballRadius) {
    ball.x = C.shaftW - C.ballRadius;
    if (ball.vx > 0) ball.vx = -ball.vx * C.wallRestitution;
  }
  if (ball.z < C.ballRadius) {
    ball.z = C.ballRadius;
    if (ball.vz < 0) ball.vz = -ball.vz * C.wallRestitution;
  }
  if (ball.z > C.shaftD - C.ballRadius) {
    ball.z = C.shaftD - C.ballRadius;
    if (ball.vz > 0) ball.vz = -ball.vz * C.wallRestitution;
  }
  resolveBlocks(s, events);
  processQueue(s, events);

  // Run ends when the ball rests on the floor (§3.2 — no death, ever).
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz);
  const onFloor = ball.y + C.ballRadius >= C.floorY - 1;
  s.restTicks = onFloor && speed < C.restSpeed ? s.restTicks + 1 : 0;
  if (s.restTicks > C.restTicks) {
    s.finished = true;
    s.finishTick = s.tick;
    events.push({ kind: "finish" });
  }
  return events;
}

// Aim-laser trajectory: the SAME integrator and wall maths as step(),
// ignoring blocks — the ball's real flight path under the current (held)
// tilt, sampled for ~laserLen of descent. Render-only consumer; never
// mutates state.
export function predictPath(s: SimState, tiltX: number, tiltZ: number): { x: number; y: number; z: number }[] {
  const C = CONFIG;
  const pts: { x: number; y: number; z: number }[] = [];
  let { x, y, z, vx, vy, vz } = s.ball;
  const startY = y;
  for (let i = 0; i < 360; i++) {
    vx += C.g0 * C.kTilt * tiltX * C.dt;
    vy += C.g0 * C.dt;
    vz += C.g0 * C.kTilt * tiltZ * C.dt;
    vx *= C.drag;
    vy *= C.drag;
    vz *= C.drag;
    const s2 = vx * vx + vy * vy + vz * vz;
    if (s2 > C.maxSpeed * C.maxSpeed) {
      const k = C.maxSpeed / Math.sqrt(s2);
      vx *= k;
      vy *= k;
      vz *= k;
    }
    x += vx * C.dt;
    y += vy * C.dt;
    z += vz * C.dt;
    if (x < C.ballRadius) {
      x = C.ballRadius;
      vx = -vx * C.wallRestitution;
    }
    if (x > C.shaftW - C.ballRadius) {
      x = C.shaftW - C.ballRadius;
      vx = -vx * C.wallRestitution;
    }
    if (z < C.ballRadius) {
      z = C.ballRadius;
      vz = -vz * C.wallRestitution;
    }
    if (z > C.shaftD - C.ballRadius) {
      z = C.shaftD - C.ballRadius;
      vz = -vz * C.wallRestitution;
    }
    if (i % 4 === 0) pts.push({ x, y, z });
    if (y - startY > C.laserLen || y + C.ballRadius >= C.floorY) break;
  }
  return pts;
}
