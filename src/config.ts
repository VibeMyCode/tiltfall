// ALL tunables live here (SPEC §1.6). Tuning the game = editing this file.
export const CONFIG = {
  // Logical space (§2): tower-local, X/Z ∈ [0, shaftW], Y DOWN from 0 at top.
  shaftW: 1200,
  shaftD: 1200,
  ballRadius: 40,

  // Tower shape. Air between tiers is a GAMEPLAY feature (owner feedback):
  // the long fall is where you see the next tier, aim, and prepare.
  tierCount: 5,
  firstTierTopY: 1200,
  tierSpacing: 2400,
  floorY: 13400,
  spawn: { x: 650, y: 140, z: 650 },
  cell: 100,
  gridN: 8,
  gridX0: 200,
  blockH: 50, // tallest piece height; levelgen uses 20 (flat) / 40 / 50 (owner)

  // Physics (§3.3) — fixed timestep, semi-implicit Euler.
  dt: 1 / 120,
  g0: 3200,
  kTilt: 0.6, // lateral gravity fraction at full tilt (linear — §2, no trig)
  drag: 0.999,
  maxSpeed: 2600,
  wallRestitution: 0.6,
  floorRestitution: 0.35,
  blockRestitution: 0.6, // bouncier ball (owner feedback)
  friction: 0.98,

  // Breaking (§3.3): J = round(|v_axis| * mass / impulseScale); a one-tier
  // free fall lands at J ≈ 25.
  ballMass: 1,
  impulseScale: 96,
  breakThroughLoss: 0.62,
  breakBounce: 0.32, // smashing DOWN through a piece pops the ball back up —
  // a beat of air time to aim at the next tier (owner design)
  thresholds: { glass: 8, stone: 22, bomb: 8 } as Record<string, number>,
  points: { glass: 10, stone: 25, bomb: 30 } as Record<string, number>,

  // Cascade (§4.2): a BOMB (yellow) breaks every piece whose center is within
  // blastRadius, rippling outward with the step delay.
  cascadeStepTicks: 10,
  blastRadius: 240,

  // Combo & scoring (§3.5). Window/timer are in ticks.
  comboWindowTicks: 300, // 2.5 s
  comboMax: 10,

  // Run end: ball resting on the floor.
  restSpeed: 100,
  restTicks: 45,

  // Tilt input (§3.1). Screen-space signs set by LOOKING at the running game
  // (with the static world the camera faces -Z, so screen-right is world -X).
  tiltFullDragPx: 140,
  tiltReleaseEaseMs: 250,
  keyTiltRate: 5.5, // tilt units per second toward keyboard target
  inputSignX: -1,
  inputSignZ: 1,

  // Visual presentation of steering. 0 = direct "air control" look (owner
  // pick: the world stays still, you steer the falling ball; the landing
  // reticle shows where you are headed). Set > 0 to bring back the
  // tilt-the-tower look for comparison.
  visualTiltSignX: 1,
  visualTiltSignZ: 1,
  maxVisualTiltDeg: 0,
  camAimAheadY: 380, // camera looks this far BELOW the ball — see what's coming

  // Aim beacon (owner design): a soft trajectory thread from the ball down
  // to a dark landing disc — the disc IS the predicted landing spot under
  // current steering. Future monetization slot: sellable / reward-activated
  // booster; for development it is always on.
  laserOn: true,
  laserPoints: 30,

  // Target control (owner design): the pointer drives the landing DISC
  // directly (it snaps to the finger/cursor), and a PD controller steers the
  // ball after it by synthesizing the same tilt input the sim always eats —
  // the sim itself is unchanged. Keyboard keeps direct tilt.
  targetControl: true,
  targetGainDist: 420, // err units per full tilt (smaller = snappier chase)
  targetGainVel: 2600, // velocity damping (bigger = less braking)

  // Camera.
  camHeight: 1500,
  camDist: 1020,
  camFov: 0.9,
  camSmooth: 0.09,
  camTiltZoom: 0, // input-linked zoom retired with the static world (owner: jerky)
  portraitTargetAspect: 1.15, // keep shaft width in frame on portrait phones

  // Juice (render-only). No positional camera shake — it reads as an input
  // glitch while tilting (owner feedback); breaks pulse the ball + FOV instead.
  shardImpactInherit: 0.45,
  hitStopMs: 40,

  // Fog scales with the camera zoom (portrait/tilt) so zooming out never
  // drowns the tower (owner feedback).
  fogStart: 2200,
  fogEnd: 9000,
} as const;
