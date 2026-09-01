// Pure simulation (§3.3, §3.4, §4.2, §5.4): zero Babylon imports, no
// Math.random, no Date, no transcendentals. Same layout + same input log +
// same card picks ⇒ same run.
import { CONFIG } from "./config";
import { cardParams, type CardId } from "./cards";
import type { BlockDef } from "./levelgen";

export interface SimBlock extends BlockDef {
  broken: boolean;
}

export interface SimEvent {
  kind: "break" | "finish" | "gate" | "bumper" | "spike" | "pity";
  id?: number;
  gateIndex?: number;
  cascade?: boolean;
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
  comboChain: number; // pieces broken in the current unbroken chain
  maxCombo: number;
  lastBreakTick: number;
  score: number;
  broken: number;
  finished: boolean;
  finishTick: number;
  parTicks: number;
  parBonus: number;
  // Draft gates (§3.4)
  gatesPassed: number;
  gatePhase: "none" | "capture" | "wait";
  gateT: number;
  gateFrom: { x: number; y: number; z: number };
  gateY: number;
  activeCard: CardId | null;
  pierceLeft: number;
  // Anti-stall (§3.2)
  stallTicks: number;
  tierEnterTick: number;
  currentTier: number;
  pityDisabled: boolean;
}

export function createSim(layout: BlockDef[], opts?: { parTicks?: number; pityDisabled?: boolean }): SimState {
  return {
    tick: 0,
    ball: { x: CONFIG.spawn.x, y: CONFIG.spawn.y, z: CONFIG.spawn.z, vx: 0, vy: 0, vz: 0 },
    blocks: layout.map((b) => ({ ...b, broken: false })),
    groupDamage: {},
    queue: [],
    combo: 1,
    comboChain: 0,
    maxCombo: 1,
    lastBreakTick: -1e9,
    score: 0,
    broken: 0,
    finished: false,
    finishTick: 0,
    parTicks: opts?.parTicks ?? 0,
    parBonus: 0,
    gatesPassed: 0,
    gatePhase: "none",
    gateT: 0,
    gateFrom: { x: 0, y: 0, z: 0 },
    gateY: 0,
    activeCard: null,
    pierceLeft: 0,
    stallTicks: 0,
    tierEnterTick: 0,
    currentTier: 0,
    pityDisabled: opts?.pityDisabled ?? false,
  };
}

const tierBaseY = (tier: number): number => CONFIG.firstTierTopY + tier * CONFIG.tierSpacing + CONFIG.blockH;

// Queue every un-broken group whose nearest segment center (XZ, same tier
// band) lies within radius — near-to-far ripple, deterministic total order.
function queueBlast(s: SimState, cx: number, cy: number, cz: number, radius: number, delayStep: number): void {
  const dist = new Map<number, number>();
  for (const b of s.blocks) {
    if (b.broken) continue;
    if (Math.abs(b.cy - cy) > 400) continue; // same tier band
    const dx = b.cx - cx;
    const dz = b.cz - cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > radius || d === 0) continue;
    const prev = dist.get(b.groupId);
    if (prev === undefined || d < prev) dist.set(b.groupId, d);
  }
  [...dist.entries()]
    .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    .forEach(([g], i) => s.queue.push({ tick: s.tick + delayStep * (i + 1), groupId: g }));
}

// Break a whole piece; score once; bombs blast, shockwave card ripples.
function breakGroup(s: SimState, groupId: number, cascade: boolean, events: SimEvent[]): void {
  const P = cardParams(s.activeCard);
  let any = false;
  for (const b of s.blocks) {
    if (b.groupId !== groupId || b.broken) continue;
    b.broken = true;
    any = true;
    events.push({ kind: "break", id: b.id, cascade, bvx: s.ball.vx, bvy: s.ball.vy, bvz: s.ball.vz });
    if (b.primary) {
      if (s.tick - s.lastBreakTick <= P.comboWindowTicks) {
        s.combo = Math.min(CONFIG.comboMax, s.combo + 1);
      } else {
        s.combo = 1;
        s.comboChain = 0;
      }
      s.comboChain++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.lastBreakTick = s.tick;
      s.score += (CONFIG.points[b.type] ?? 0) * b.cells * s.combo;
      if (b.type === "bomb") {
        queueBlast(s, b.cx, b.cy, b.cz, CONFIG.blastRadius * P.blastMul, CONFIG.cascadeStepTicks);
      } else if (!cascade && P.shock) {
        const cells = CONFIG.cards.shockBaseCells + Math.floor(s.comboChain / CONFIG.cards.shockChainPer);
        queueBlast(s, b.cx, b.cy, b.cz, cells * CONFIG.cell + 1, CONFIG.cards.shockDelayTicks);
      }
    }
  }
  if (any) s.broken++;
}

function processQueue(s: SimState, events: SimEvent[]): void {
  s.queue.sort((a, b) => a.tick - b.tick || a.groupId - b.groupId);
  while (s.queue.length && s.queue[0].tick <= s.tick) {
    const e = s.queue.shift()!;
    breakGroup(s, e.groupId, true, events);
  }
}

function resolveBlocks(s: SimState, events: SimEvent[]): void {
  const { ball } = s;
  const P = cardParams(s.activeCard);
  const r = CONFIG.ballRadius;
  for (const b of s.blocks) {
    if (b.broken) continue;
    const hx = b.hx + r;
    const hy = b.hy + r;
    const hz = b.hz + r;
    const dx = ball.x - b.cx;
    const dy = ball.y - b.cy;
    const dz = ball.z - b.cz;
    if (Math.abs(dx) >= hx || Math.abs(dy) >= hy || Math.abs(dz) >= hz) continue;
    const px = hx - Math.abs(dx);
    const py = hy - Math.abs(dy);
    const pz = hz - Math.abs(dz);
    const axis: "x" | "y" | "z" = px <= py && px <= pz ? "x" : py <= pz ? "y" : "z";
    const vAxis = axis === "x" ? ball.vx : axis === "y" ? ball.vy : ball.vz;
    const j = Math.round((Math.abs(vAxis) * CONFIG.ballMass * P.massMul) / CONFIG.impulseScale);
    const dmg = (s.groupDamage[b.groupId] ?? 0) + j;
    const breakable = b.threshold !== Infinity;
    if (breakable && (dmg >= b.threshold || (P.pierce && s.pierceLeft > 0))) {
      if (P.pierce && s.pierceLeft > 0) {
        s.pierceLeft--;
        breakGroup(s, b.groupId, false, events);
        continue; // Piercer: no bounce, no speed loss at all
      }
      breakGroup(s, b.groupId, false, events);
      if (axis === "y" && vAxis > 0) ball.vy = -ball.vy * P.breakBounce;
      else if (axis === "x") ball.vx *= CONFIG.breakThroughLoss;
      else if (axis === "y") ball.vy *= CONFIG.breakThroughLoss;
      else ball.vz *= CONFIG.breakThroughLoss;
      continue;
    }
    if (breakable) s.groupDamage[b.groupId] = dmg;
    // Bounce response. Bumpers launch; spikes punish.
    const rest =
      b.type === "bumper"
        ? CONFIG.bumperRestitution
        : Math.min(0.95, CONFIG.blockRestitution + P.restAdd);
    if (axis === "x") {
      ball.x = b.cx + Math.sign(dx) * hx;
      ball.vx = -ball.vx * rest;
      ball.vy *= CONFIG.friction;
      ball.vz *= CONFIG.friction;
    } else if (axis === "y") {
      ball.y = b.cy + Math.sign(dy) * hy;
      ball.vy = -ball.vy * rest;
      ball.vx *= CONFIG.friction;
      ball.vz *= CONFIG.friction;
    } else {
      ball.z = b.cz + Math.sign(dz) * hz;
      ball.vz = -ball.vz * rest;
      ball.vx *= CONFIG.friction;
      ball.vy *= CONFIG.friction;
    }
    if (b.type === "bumper") {
      s.score += CONFIG.bumperPoints; // flat, never multiplied (§3.5)
      events.push({ kind: "bumper", id: b.id });
    } else if (b.type === "spike") {
      s.combo = 1;
      s.comboChain = 0;
      ball.vx *= CONFIG.spikeSlow;
      ball.vy *= CONFIG.spikeSlow;
      ball.vz *= CONFIG.spikeSlow;
      events.push({ kind: "spike", id: b.id });
    }
  }
}

// Anti-stall (§3.2): nudge toward the nearest open cell of the current tier.
function antiStall(s: SimState, events: SimEvent[]): void {
  const C = CONFIG;
  const { ball } = s;
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz);
  const onFloor = ball.y + C.ballRadius >= C.floorY - 1;
  const tier = Math.max(0, Math.min(C.tierCount - 1, Math.floor((ball.y - C.firstTierTopY) / C.tierSpacing)));
  if (tier !== s.currentTier) {
    s.currentTier = tier;
    s.tierEnterTick = s.tick;
  }
  s.stallTicks = !onFloor && speed < C.restSpeed ? s.stallTicks + 1 : 0;
  if (s.stallTicks > C.stallTicks) {
    s.stallTicks = 0;
    // Deterministic target: the open cell nearest to the ball (lowest index ties).
    const covered = new Array(C.gridN * C.gridN).fill(false);
    for (const b of s.blocks) {
      if (b.broken) continue;
      if (Math.abs(b.cy - (tierBaseY(tier) - 50)) > 200) continue;
      const c0 = Math.round((b.cx - b.hx - C.gridX0) / C.cell);
      const r0 = Math.round((b.cz - b.hz - C.gridX0) / C.cell);
      const cols = Math.round((b.hx * 2) / C.cell);
      const rows = Math.round((b.hz * 2) / C.cell);
      for (let rr = r0; rr < r0 + rows; rr++)
        for (let cc = c0; cc < c0 + cols; cc++)
          if (rr >= 0 && rr < C.gridN && cc >= 0 && cc < C.gridN) covered[rr * C.gridN + cc] = true;
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < covered.length; i++) {
      if (covered[i]) continue;
      const cx = C.gridX0 + (i % C.gridN) * C.cell + C.cell / 2;
      const cz = C.gridX0 + Math.floor(i / C.gridN) * C.cell + C.cell / 2;
      const d = (cx - ball.x) * (cx - ball.x) + (cz - ball.z) * (cz - ball.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      const cx = C.gridX0 + (best % C.gridN) * C.cell + C.cell / 2;
      const cz = C.gridX0 + Math.floor(best / C.gridN) * C.cell + C.cell / 2;
      const dx = cx - ball.x;
      const dz = cz - ball.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      ball.vx += (dx / len) * C.nudgeImpulse;
      ball.vz += (dz / len) * C.nudgeImpulse;
    }
  }
  // Pity (§3.2): a tier held too long auto-shatters, spectacularly.
  if (!s.pityDisabled && s.tick - s.tierEnterTick > C.pityTicks) {
    s.tierEnterTick = s.tick; // once
    const groups = new Set<number>();
    for (const b of s.blocks) {
      if (!b.broken && b.threshold !== Infinity && Math.abs(b.cy - (tierBaseY(tier) - 50)) < 200) groups.add(b.groupId);
    }
    [...groups].sort((a, b) => a - b).forEach((g, i) => s.queue.push({ tick: s.tick + 4 * (i + 1), groupId: g }));
    if (groups.size) events.push({ kind: "pity" });
  }
}

// The player's pick lands: card active until the next gate, ball released.
export function applyCard(s: SimState, card: CardId): void {
  if (s.gatePhase !== "wait") return;
  s.activeCard = card;
  s.pierceLeft = card === "pierce" ? CONFIG.cards.pierceCount : 0;
  s.gatePhase = "none";
  s.gatesPassed++;
  s.ball.vx = 0;
  s.ball.vz = 0;
  s.ball.vy = CONFIG.gateDropSpeed;
}

export function step(s: SimState, tiltX: number, tiltZ: number): SimEvent[] {
  const events: SimEvent[] = [];
  if (s.finished || s.gatePhase === "wait") return events; // frozen at a gate
  s.tick++;
  const { ball } = s;
  const C = CONFIG;

  if (s.gatePhase === "capture") {
    // Scripted gate capture (§3.2): lerp to the anchor, then freeze.
    s.gateT++;
    const k = s.gateT / C.gateCaptureTicks;
    ball.x = s.gateFrom.x + (C.shaftW / 2 - s.gateFrom.x) * k;
    ball.y = s.gateFrom.y + (s.gateY - s.gateFrom.y) * k;
    ball.z = s.gateFrom.z + (C.shaftD / 2 - s.gateFrom.z) * k;
    ball.vx = ball.vy = ball.vz = 0;
    if (s.gateT >= C.gateCaptureTicks) {
      s.gatePhase = "wait";
      events.push({ kind: "gate", gateIndex: s.gatesPassed });
    }
    return events;
  }

  const P = cardParams(s.activeCard);
  ball.vx += C.g0 * C.kTilt * P.kTiltMul * tiltX * C.dt;
  ball.vy += C.g0 * C.dt;
  ball.vz += C.g0 * C.kTilt * P.kTiltMul * tiltZ * C.dt;
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

  // Gate trigger: passing below a tier's gate plane captures the ball.
  if (s.gatesPassed < C.tierCount - 1 && s.gatePhase === "none") {
    const gateY = tierBaseY(s.gatesPassed) + C.gateDepthBelowTier;
    if (ball.y > gateY) {
      s.gatePhase = "capture";
      s.gateT = 0;
      s.gateFrom = { x: ball.x, y: ball.y, z: ball.z };
      s.gateY = gateY;
      return events;
    }
  }

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
  antiStall(s, events);

  // The run ends the moment the ball reaches the floor (§3.2).
  if (ball.y + C.ballRadius >= C.floorY - 1) {
    s.finished = true;
    s.finishTick = s.tick;
    if (s.parTicks > 0) {
      s.parBonus = Math.max(0, Math.floor((s.parTicks - s.finishTick) / C.parScaleTicks));
      s.score += s.parBonus;
    }
    events.push({ kind: "finish" });
  }
  return events;
}

// Aim trajectory: the SAME integrator and wall maths as step(), ignoring
// breakables except as landing surfaces. Hard wall contact CUTS the line
// (owner: the bent bounce segment looked wrong); the LAST point is the
// landing spot. Render-only consumer; never mutates state.
export function predictPath(
  s: SimState,
  tiltX: number,
  tiltZ: number,
): { points: { x: number; y: number; z: number }[]; wallHit: boolean } {
  const C = CONFIG;
  const WALL_CUT_SPEED = 150;
  const P = cardParams(s.activeCard);
  const pts: { x: number; y: number; z: number }[] = [];
  let wallHit = false;
  let { x, y, z, vx, vy, vz } = s.ball;
  outer: for (let i = 0; i < 900; i++) {
    vx += C.g0 * C.kTilt * P.kTiltMul * tiltX * C.dt;
    vy += C.g0 * C.dt;
    vz += C.g0 * C.kTilt * P.kTiltMul * tiltZ * C.dt;
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
    const wallChecks: [boolean, () => void][] = [
      [x < C.ballRadius && vx < 0, () => ((x = C.ballRadius), (vx = -vx * C.wallRestitution))],
      [x > C.shaftW - C.ballRadius && vx > 0, () => ((x = C.shaftW - C.ballRadius), (vx = -vx * C.wallRestitution))],
      [z < C.ballRadius && vz < 0, () => ((z = C.ballRadius), (vz = -vz * C.wallRestitution))],
      [z > C.shaftD - C.ballRadius && vz > 0, () => ((z = C.shaftD - C.ballRadius), (vz = -vz * C.wallRestitution))],
    ];
    for (const [hit, resolve] of wallChecks) {
      if (!hit) continue;
      const lateral = Math.max(Math.abs(vx), Math.abs(vz));
      if (lateral > WALL_CUT_SPEED) {
        pts.push({ x, y, z });
        wallHit = true;
        break outer;
      }
      resolve();
    }
    if (i % 5 === 0) pts.push({ x, y, z });
    if (y + C.ballRadius >= C.floorY) {
      pts.push({ x, y: C.floorY, z });
      break;
    }
    let landed = false;
    for (const blk of s.blocks) {
      if (blk.broken) continue;
      const top = blk.cy - blk.hy;
      if (y + C.ballRadius < top) continue;
      if (y > blk.cy + blk.hy) continue;
      if (Math.abs(x - blk.cx) <= blk.hx && Math.abs(z - blk.cz) <= blk.hz) {
        pts.push({ x, y: top, z });
        landed = true;
        break;
      }
    }
    if (landed) break;
  }
  return { points: pts, wallHit };
}
