// ALL tunables live here (SPEC §1.6). Tuning the game = editing this file.
export const CONFIG = {
  // Logical space (§2): tower-local, X/Z ∈ [0, shaftW], Y DOWN from 0 at top.
  shaftW: 1200,
  shaftD: 1200,
  ballRadius: 40,

  // Tower shape (M1: 5 tiers, temporary inline generator until §4.3 levelgen).
  tierCount: 5,
  firstTierTopY: 800,
  tierSpacing: 700,
  floorY: 4400,
  spawn: { x: 650, y: 140, z: 650 },
  cell: 100,
  gridN: 8,
  gridX0: 200,
  blockH: 100,

  // Physics (§3.3) — fixed timestep, semi-implicit Euler.
  dt: 1 / 120,
  g0: 3200,
  kTilt: 0.6, // lateral gravity fraction at full tilt (linear — §2, no trig)
  drag: 0.999,
  maxSpeed: 2600,
  wallRestitution: 0.6,
  floorRestitution: 0.35,
  blockRestitution: 0.5,
  friction: 0.98,

  // Breaking (§3.3): J = round(|v_axis| * mass / impulseScale); a one-tier
  // free fall lands at J ≈ 25.
  ballMass: 1,
  impulseScale: 96,
  breakThroughLoss: 0.62,
  thresholds: { glass: 8, stone: 22, support: 8, dep: 8 } as Record<string, number>,
  points: { glass: 10, stone: 25, support: 20, dep: 10 } as Record<string, number>,

  // Cascade (§4.2).
  cascadeStepTicks: 12,

  // Combo & scoring (§3.5). Window/timer are in ticks.
  comboWindowTicks: 300, // 2.5 s
  comboMax: 10,

  // Run end: ball resting on the floor.
  restSpeed: 100,
  restTicks: 45,

  // Tilt input (§3.1).
  tiltFullDragPx: 140,
  tiltReleaseEaseMs: 250,
  keyTiltRate: 5.5, // tilt units per second toward keyboard target

  // Visual tilt (§2) — renderer only; signs are set by LOOKING (SPEC §2).
  visualTiltSignX: 1,
  visualTiltSignZ: 1,
  maxVisualTiltDeg: 8,

  // Camera.
  camHeight: 1500,
  camDist: 1020,
  camFov: 0.9,
  camSmooth: 0.09,
  camTiltZoom: 0.25, // zoom-OUT fraction at full tilt
  portraitTargetAspect: 1.15, // keep shaft width in frame on portrait phones

  // Juice (render-only).
  shardImpactInherit: 0.45,
  hitStopMs: 40,
} as const;
