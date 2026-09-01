// Pure simulation (§3.3, §4.2, §5.4): zero Babylon imports, no Math.random,
// no Date, no transcendentals. Same layout + same input log + same booster
// activations ⇒ same run. No mid-run interruptions (owner: gates removed).
import { CONFIG } from "./config";
import { BOOSTER_MODE, type BoosterId } from "./boosters";
import type { BlockDef } from "./levelgen";

export interface SimBlock extends BlockDef {
  broken: boolean;
}

export interface SimEvent {
  kind: "break" | "finish" | "bumper" | "spike" | "pity";
  id?: number;
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
  comboChain: number;
  maxCombo: number;
  lastBreakTick: number;
  score: number;
  broken: number;
  finished: boolean;
  finishTick: number;
  armed: Partial<Record<BoosterId, boolean>>; // one-shot boosters, waiting to fire
  runOn: Partial<Record<BoosterId, boolean>>; // run-long boosters (x2, feather)
  chainBlastTick: number; // last chain-bomb consumption (drives the slow-mo showcase)
  tierEnterTick: number;
  currentTier: number;
  pityDisabled: boolean;
}

export function createSim(layout: BlockDef[], opts?: { pityDisabled?: boolean }): SimState {
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
    armed: {},
    runOn: {},
    chainBlastTick: -1e9,
    tierEnterTick: 0,
    currentTier: 0,
    pityDisabled: opts?.pityDisabled ?? false,
  };
}

// Activate an owned booster (main handles inventory; replay logs (tick, id)).
// Impact boosters ARM (fire once on the next matching hit); x2/feather stay
// on until the run ends.
export function activateBooster(s: SimState, id: BoosterId): void {
  if (BOOSTER_MODE[id] === "armed") s.armed[id] = true;
  else s.runOn[id] = true;
}

const tierBaseY = (tier: number): number => CONFIG.firstTierTopY + tier * CONFIG.tierSpacing + CONFIG.blockH;

// Queue every un-broken group whose nearest segment center (XZ, same tier
// band) lies within radius — near-to-far ripple, deterministic total order.
function queueBlast(s: SimState, cx: number, cy: number, cz: number, radius: number, delayStep: number): void {
  const dist = new Map<number, number>();
  for (const b of s.blocks) {
    if (b.broken || b.threshold === Infinity) continue;
    if (Math.abs(b.cy - cy) > 400) continue;
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

function breakGroup(s: SimState, groupId: number, cascade: boolean, events: SimEvent[]): void {
  const B = CONFIG.boosters;
  let any = false;
  for (const b of s.blocks) {
    if (b.groupId !== groupId || b.broken) continue;
    b.broken = true;
    any = true;
    events.push({ kind: "break", id: b.id, cascade, bvx: s.ball.vx, bvy: s.ball.vy, bvz: s.ball.vz });
    if (b.primary) {
      if (s.tick - s.lastBreakTick <= CONFIG.comboWindowTicks) {
        s.combo = Math.min(CONFIG.comboMax, s.combo + 1);
      } else {
        s.combo = 1;
        s.comboChain = 0;
      }
      s.comboChain++;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.lastBreakTick = s.tick;
      const scoreMul = s.runOn.x2 ? B.x2.scoreMul : 1;
      s.score += (CONFIG.points[b.type] ?? 0) * b.cells * s.combo * scoreMul;
      if (b.type === "bomb") {
        // CHAIN BOMB (one-shot): this bomb mega-chains, in slow motion.
        const mul = s.armed.chain ? B.chain.blastMul : 1;
        if (s.armed.chain) {
          s.armed.chain = false;
          s.chainBlastTick = s.tick;
        }
        queueBlast(s, b.cx, b.cy, b.cz, CONFIG.blastRadius * mul, CONFIG.cascadeStepTicks);
      }
      if (!cascade && s.armed.quake) {
        // QUAKE (one-shot): this smash levels a huge area.
        s.armed.quake = false;
        queueBlast(s, b.cx, b.cy, b.cz, B.quake.blastCells * CONFIG.cell, 6);
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
    const j = Math.round((Math.abs(vAxis) * CONFIG.ballMass) / CONFIG.impulseScale);
    const dmg = (s.groupDamage[b.groupId] ?? 0) + j;
    const breakable = b.threshold !== Infinity;
    // HEAVY (one-shot): the next hit breaks ANY breakable piece instantly.
    const heavySmash = breakable && s.armed.heavy;
    if (breakable && (dmg >= b.threshold || heavySmash)) {
      if (heavySmash) s.armed.heavy = false;
      breakGroup(s, b.groupId, false, events);
      if (axis === "y" && vAxis > 0) {
        // BOUNCE (one-shot): this smash launches you up like a bumper.
        if (s.armed.bounce) {
          s.armed.bounce = false;
          ball.vy = -CONFIG.bumperMinLaunch;
        } else {
          ball.vy = -ball.vy * CONFIG.breakBounce;
        }
      } else if (axis === "x") ball.vx *= CONFIG.breakThroughLoss;
      else if (axis === "y") ball.vy *= CONFIG.breakThroughLoss;
      else ball.vz *= CONFIG.breakThroughLoss;
      continue;
    }
    if (breakable) s.groupDamage[b.groupId] = dmg;
    if (b.type === "spike") {
      // Impale ONCE on a fast hit (dead stop, combo dies); afterwards the
      // ball may slowly roll off under tilt — never a permanent trap.
      if (axis === "x") ball.x = b.cx + Math.sign(dx) * hx;
      else if (axis === "y") ball.y = b.cy + Math.sign(dy) * hy;
      else ball.z = b.cz + Math.sign(dz) * hz;
      if (Math.abs(vAxis) > 300) {
        ball.vx *= CONFIG.spikeStop;
        ball.vy *= CONFIG.spikeStop;
        ball.vz *= CONFIG.spikeStop;
        s.combo = 1;
        s.comboChain = 0;
        events.push({ kind: "spike", id: b.id });
      } else {
        // resting on the spikes: soft contact, tilt can drag the ball off
        if (axis === "x") ball.vx = -ball.vx * 0.1;
        else if (axis === "y") ball.vy = -ball.vy * 0.1;
        else ball.vz = -ball.vz * 0.1;
      }
      continue;
    }
    const rest = b.type === "bumper" ? CONFIG.bumperRestitution : CONFIG.blockRestitution;
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
      // A launcher must LAUNCH (owner): guarantee a violent exit speed.
      if (axis === "x") ball.vx = Math.sign(ball.vx) * Math.max(Math.abs(ball.vx), CONFIG.bumperMinLaunch);
      else if (axis === "y") ball.vy = Math.sign(ball.vy) * Math.max(Math.abs(ball.vy), CONFIG.bumperMinLaunch);
      else ball.vz = Math.sign(ball.vz) * Math.max(Math.abs(ball.vz), CONFIG.bumperMinLaunch);
      s.score += CONFIG.bumperPoints;
      events.push({ kind: "bumper", id: b.id });
    }
  }
}

// Pity only (§3.2, owner-tuned): no nudging — a tier that holds the ball
// for pityTicks auto-shatters, spectacularly.
function pity(s: SimState, events: SimEvent[]): void {
  const C = CONFIG;
  // Bias DOWN so a ball resting ON a tier's blocks is attributed to THAT
  // tier (owner bug report: pity was shattering the tier above).
  const tier = Math.max(
    0,
    Math.min(C.tierCount - 1, Math.floor((s.ball.y + C.tierAttributionBias - C.firstTierTopY) / C.tierSpacing)),
  );
  if (tier !== s.currentTier) {
    s.currentTier = tier;
    s.tierEnterTick = s.tick;
  }
  if (!s.pityDisabled && s.tick - s.tierEnterTick > C.pityTicks) {
    s.tierEnterTick = s.tick;
    const groups = new Set<number>();
    for (const b of s.blocks) {
      if (!b.broken && b.threshold !== Infinity && Math.abs(b.cy - (tierBaseY(tier) - 50)) < 200) groups.add(b.groupId);
    }
    [...groups].sort((a, b) => a - b).forEach((g, i) => s.queue.push({ tick: s.tick + 4 * (i + 1), groupId: g }));
    if (groups.size) events.push({ kind: "pity" });
  }
}

export function step(s: SimState, tiltX: number, tiltZ: number): SimEvent[] {
  const events: SimEvent[] = [];
  if (s.finished) return events;
  s.tick++;
  const { ball } = s;
  const C = CONFIG;
  const kTiltMul = s.runOn.feather ? C.boosters.feather.tiltMul : 1;
  ball.vx += C.g0 * C.kTilt * kTiltMul * tiltX * C.dt;
  ball.vy += C.g0 * C.dt;
  ball.vz += C.g0 * C.kTilt * kTiltMul * tiltZ * C.dt;
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
  pity(s, events);

  // The run ends the moment the ball reaches the floor (§3.2).
  if (ball.y + C.ballRadius >= C.floorY - 1) {
    s.finished = true;
    s.finishTick = s.tick;
    events.push({ kind: "finish" });
  }
  return events;
}

// Aim trajectory: the SAME integrator and wall maths as step(), ignoring
// breakables except as landing surfaces. Hard wall contact CUTS the line;
// the LAST point is the landing spot. Render-only consumer.
export function predictPath(
  s: SimState,
  tiltX: number,
  tiltZ: number,
): { points: { x: number; y: number; z: number }[]; wallHit: boolean } {
  const C = CONFIG;
  const WALL_CUT_SPEED = 150;
  const kTiltMul = s.runOn.feather ? C.boosters.feather.tiltMul : 1;
  const pts: { x: number; y: number; z: number }[] = [];
  let wallHit = false;
  let { x, y, z, vx, vy, vz } = s.ball;
  outer: for (let i = 0; i < 900; i++) {
    vx += C.g0 * C.kTilt * kTiltMul * tiltX * C.dt;
    vy += C.g0 * C.dt;
    vz += C.g0 * C.kTilt * kTiltMul * tiltZ * C.dt;
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
