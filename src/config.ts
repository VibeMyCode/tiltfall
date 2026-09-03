// ALL tunables live here (SPEC §1.6). Tuning the game = editing this file.
export const CONFIG = {
  // Logical space (§2): tower-local, X/Z ∈ [0, shaftW], Y DOWN from 0 at top.
  shaftW: 1200,
  shaftD: 1200,
  ballRadius: 40,

  // Tower shape. ENDLESS (owner design): tiers stream forever, every run on a
  // fresh random seed; the run ends only on a MINE. Depth is the badge.
  firstTierTopY: 1200,
  tierSpacing: 2400,
  spawn: { x: 650, y: 140, z: 650 },
  tierLookahead: 3, // generate this many tiers below the ball
  // Mines: none on the first tiers, then the tower turns hostile with depth.
  mineFreeTiers: 3,
  mineCount: (tier: number) => Math.min(4, 1 + Math.floor((tier - 3) / 3)),
  // Difficulty ramp caps.
  stonePMax: 0.5,
  spikeMaxPerTier: 3,
  cell: 100,
  gridN: 8,
  gridX0: 200,
  blockH: 50, // tallest piece height; levelgen uses 20 (flat) / 40 / 50 (owner)

  // Physics (§3.3) — fixed timestep, semi-implicit Euler.
  dt: 1 / 120,
  g0: 3200,
  // Lateral authority at full tilt, as a fraction of gravity. At 1.0 the rule
  // is legible — you can steer exactly as hard as you fall — and it is what
  // lets the ball keep up with a finger sweeping across the shaft. It was 0.6,
  // which left the ball trailing the target by six ball-radii (§2, no trig).
  kTilt: 1.0,
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
  // Score is DENOMINATED ×1/10 (owner): small readable numbers, and every
  // purchase costs several runs instead of one.
  thresholds: { glass: 8, stone: 22, bomb: 8 } as Record<string, number>,
  points: { glass: 1, stone: 3, bomb: 3, mine: 5 } as Record<string, number>,

  // Cascade (§4.2): a BOMB (yellow) breaks every piece whose center is within
  // blastRadius, rippling outward with the step delay. The blast is resolved
  // at RUNTIME (deterministically) so cards can widen it.
  cascadeStepTicks: 10,
  blastRadius: 240,

  // BOOSTERS (owner design): bought from the BANK after a run, activated on
  // demand. Impact boosters are ONE-SHOT (armed until the next matching hit);
  // x2/heavy/agility run to the end of the run.
  //
  // Prices are set against the whole SET, not one item: at 1250 total a single
  // average run bought all six, so there was never a choice to make and the
  // shop was decoration. ~3500 puts a full loadout at about three runs, which
  // makes "which one this time?" a real question and gives boosters something
  // to trade against — every point spent here is a point not spent on a level.
  boosters: {
    quake: { price: 900, blastCells: 3.4 }, // one-shot: huge blast + slow-mo
    chain: { price: 720, blastMul: 2.2 }, // one-shot: mega-chain + slow-mo
    x2: { price: 620, scoreMul: 2 }, // run-long
    heavy: { price: 500, gravityMul: 1.12 }, // run-long: lead ball, stone = glass
    shield: { price: 420 }, // instant: +1 mine shield this run
    agility: { price: 340, tiltMul: 1.8 }, // run-long: razor steering + comet tail
  },
  slowMoScale: 0.35, // playback speed for quake/chain showcase cascades

  // JUMP (owner design): Space / on-screen button; the ball hops up, then must
  // recharge. Power is flat across levels on purpose — see jumpCooldownTicks()
  // below: a stronger jump cannot exist without a longer wait behind it, so
  // levels buy skins, boosters, shields and a second charge instead.
  jumpBasePower: 1000,
  jumpHoverMargin: 1.6, // cooldown ÷ fall-back time; at 1.0 the ball breaks even
  // Levels are bought with the same bank as boosters, so these two curves have
  // to be read together. Growth was 1.7, which is fine for the first handful
  // and then a wall: the perk table ends at 15, and 1.7 put level 15 roughly
  // 870 runs away, so most of the table was content nobody would ever see.
  // 1.42 keeps the early levels quick and brings 15 to ~130 runs — far, but a
  // destination rather than an asymptote.
  levelBaseCost: 300,
  levelCostGrowth: 1.42,

  // LEVEL PERK TABLE (owner): every level unlocks something concrete, and
  // boosters appear cheapest-first so the shop grows with the player.
  levelPerks: [
    { level: 1, skin: "core", booster: "agility" },
    { level: 2, skin: "ember" },
    { level: 3, booster: "shield" },
    { level: 4, skin: "prism" },
    { level: 5, shield: 1 }, // a free shield every run
    { level: 6, booster: "heavy" },
    { level: 7, jumpCharge: 1 }, // a second jump before the cooldown
    { level: 8, skin: "galaxy" },
    { level: 9, booster: "x2" },
    { level: 10, skin: "aurora" },
    { level: 11, booster: "chain" },
    { level: 12, skin: "checker" },
    { level: 13, shield: 1 },
    { level: 14, booster: "quake" },
    { level: 15, skin: "magma" },
  ] as { level: number; skin?: string; booster?: string; shield?: number; jumpCharge?: number }[],

  // Telegram: direct Mini App link used by the share button — opens the game
  // itself, not the bot chat (which would cost the recipient an extra tap).
  botUrl: "https://t.me/tiltfall_bot/play",

  // Daily tasks (same for everyone, seeded by UTC date; rewards go to BANK).
  // Goals are multi-run by design (owner: 1-3 runs cleared everything).
  dailyRewardEach: 90,
  dailyRewardAll: 180,

  // Unbreakables (§4.1). Bumpers must FEEL like launchers; spikes stop the
  // ball dead (owner).
  bumperRestitution: 1.9,
  bumperMinLaunch: 1250,
  bumperPoints: 5,
  spikeStop: 0.05,

  // Pity (§3.2, owner-tuned): no nudging — if a tier holds the ball this
  // long, it auto-shatters spectacularly. The nudge is gone.
  pityTicks: 2160, // 18 s
  tierAttributionBias: 300, // resting ON a tier counts as THAT tier (pity fix)

  // Probe validation (tests only — no par UI, owner).
  probeTierTickLimit: 4800,

  // Combo & scoring (§3.5). Window/timer are in ticks.
  comboWindowTicks: 300, // 2.5 s
  comboMax: 10,

  // Run end: ball resting on the floor.
  restSpeed: 100,

  // Tilt input (§3.1). Screen-space signs set by LOOKING at the running game
  // (with the static world the camera faces -Z, so screen-right is world -X).
  tiltFullDragPx: 140,
  tiltReleaseEaseMs: 250,
  keyTiltRate: 8, // tilt units per second toward keyboard target (desktop main)
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
  // These two set the spring the ball rides toward the drag target. The pair
  // was 420/2600, a damping ratio of 0.17: 52% overshoot and still swinging
  // after six seconds, which is why steering felt disobedient rather than
  // merely slow. 220/620 puts it at 0.68 — arrives, barely overshoots, settles.
  targetGainDist: 220, // err units per full tilt (smaller = snappier chase)
  targetGainVel: 620, // velocity damping (SMALLER = more braking; the D gain)
  // RELATIVE pointer drag (owner: a finger glued to the disc covers the
  // action on phones): the drag MOVES the target from where the ball was at
  // touch-start, amplified — the finger can rest anywhere on screen.
  pointerDragAmplify: 1.6,
  pointerDragAmplifyTouch: 1.05, // calmer on phones (owner)
  doubleTapMs: 300, // touch: double tap = JUMP (the button is desktop-only)
  doubleTapSlopPx: 60,

  // Camera.
  camHeight: 1500,
  camDist: 1020,
  camFov: 0.9,
  camSmooth: 0.09,
  camTiltZoom: 0, // input-linked zoom retired with the static world (owner: jerky)
  portraitTargetAspect: 0.62, // portrait zoom-out target — smaller = bigger tower
  // (the tower no longer tilts, so it can fill more of a phone screen)

  // Juice (render-only). No positional camera shake — it reads as an input
  // glitch while tilting (owner feedback); breaks pulse the ball + FOV instead.
  shardImpactInherit: 0.45,
  hitStopMs: 40,

  // Fog scales with the camera zoom (portrait/tilt) so zooming out never
  // drowns the tower (owner feedback).
  fogStart: 2200,
  fogEnd: 9000,
} as const;

// A jump SETS upward velocity instead of adding to it, so the only thing
// stopping a player from climbing forever is having to wait out the fall.
// Gravity cancels the launch in jumpBasePower/g0 seconds and needs as long
// again to bring the ball home, so 2·power/g0 is the break-even cooldown —
// anything shorter is a net rise, repeatable without limit. The margin is what
// turns break-even into an actual descent, and it is the whole reason jump
// power no longer scales with level: raising power raises this floor with it.
export const jumpCooldownTicks = (): number =>
  Math.ceil(((2 * CONFIG.jumpBasePower) / CONFIG.g0 / CONFIG.dt) * CONFIG.jumpHoverMargin);
