# TILTFALL — Game Specification (v3, living document)

A glowing ball plummets down an ENDLESS crystalline tower. You steer it in the
air (drag a target the ball chases, or arrows/WASD), smash through glass panes
and stone blocks, detonate bombs into chain reactions, bounce off launchers,
dodge spikes — and survive the MINES that end the run in one touch. Score is
banked between runs and spent on boosters, player levels (jump power, skins,
mine shields). Every run is a freshly generated tower. Browser game: phones,
tablets, PCs, Macs; portrait and landscape.

This document reflects the SHIPPED design after twelve owner playtest
iterations (2026-09-01/02). Where it contradicts older revisions, this one
wins. History: v1 Orbit Smash (superseded), v2 tilt-the-tower with draft
gates (core survived; tower-tilt visual, draft gates, ghosts, daily tower and
par were all removed by owner decision — see §9).

---

## 1. Pillars

1. **One uninterrupted flow.** A run never pauses, never teleports the ball,
   never takes control away. Everything meta happens between runs.
2. **Excitement first.** Destruction must feel physical: impact-directed
   shards, chain explosions, slow-mo showcases, hit-stop, glow. No camera
   shake or FOV punches — the camera never fights steering.
3. **Determinism by construction.** Pure-TS fixed-timestep sim (1/120 s), no
   physics engine, no `Math.random`/`Date`/transcendentals inside sim modules;
   seeded streams only. Same seed + input log + activation log ⇒ same run.
4. **Legibility.** Every material reads at a glance: glass = thin translucent
   cyan pane; stone = chunky matte brown cube; bomb = glowing amber; bumper =
   acid-green launcher; spike = red cone bed; mine = pulsing red sphere.
5. **All tunables in config.ts.** Tuning = editing one file.

## 2. Tech stack

Babylon.js + TypeScript + Vite (godogen `babylon` target). Pure sim modules
(`sim.ts`, `levelgen.ts`, `rng.ts`, `boosters.ts`, `config.ts`) with zero
Babylon imports — enforced by a source-grep test. DOM UI (no Babylon GUI).
`localStorage` persistence. vitest. Fixed-timestep accumulator drives the sim;
render mirrors state (overrides babylon.md's frame-delta guidance).

## 3. Controls

- **Target control (touch & mouse):** relative drag — at touch-start the
  target anchors on the ball; dragging moves the aim disc (amplified ×1.6);
  a PD controller synthesizes tilt input chasing it. The finger never needs
  to cover the action. Release = free fall.
- **Keyboard:** arrows/WASD = direct tilt (eased). Screen-space correct
  (D = screen-right). Invert-Y toggle exists for the legacy relative-pointer
  mode only.
- **JUMP:** Space / round on-screen button. Instant upward impulse with a
  cooldown ring. Power and cooldown scale with player level.
- **Aim assist:** a soft thread shows the true predicted trajectory (same
  integrator, walls included; hard wall contact cuts the line) ending in a
  dark landing disc on the first REAL surface below (falls through gaps).
  Doubles as the depth cue (drop-shadow). `laserOn` is a future monetization
  gate.

## 4. The endless tower

- Tower-local space: X/Z ∈ [0,1200], Y down from 0; tiers every 2400 units,
  first at 1200. Tiers STREAM from the run seed (`buildTier(seed, tier)`),
  `tierLookahead` ahead of the fall. No floor. Walls follow the ball.
- Per tier: one bomb (tier 0's under the spawn with glass fuel — the opening
  detonation is guaranteed), one big piece (2×2 or П), two bars, one L,
  singles denser on the border; two bumpers; spikes ramp with depth
  (max 3); **mines from tier 3**, count 1 + (tier−3)/3, max 4.
- Pieces are multi-cell (1×1, 1×2, 2×1, 2×2, L, П) groups of AABB segments
  sharing groupId; a piece breaks as a whole and scores once
  (points × cells × combo). Heights: glass 20, stone 60, specials 50.
- Types: glass (thr 8, 10 pts) · stone (22, 25) · bomb (8, 30; runtime blast
  radius 240, near-to-far ripple) · bumper (unbreakable, restitution 1.9,
  min exit speed 1250, +5 flat) · spike (unbreakable; fast hit = one-time
  dead stop + combo reset; then you can roll off) · **mine (touch = run
  over; a mine SHIELD from levels absorbs one and pops you upward)**.
- Pity: a tier holding the ball > 18 s auto-shatters its breakables
  (mines/bumpers/spikes survive). No nudging. Tier attribution is biased
  +300 units down so "resting on tier N" counts as tier N.

## 5. Physics (sim contract)

Semi-implicit Euler, dt=1/120; gravity 3200 with lateral tilt fraction 0.6
(linear, no trig); drag 0.999; max speed 2600; sphere-vs-AABB with
min-penetration axis; fixed contact order: walls W0..W3 → blocks ascending
id; break-through: J = round(|v_axis|/96) ≥ threshold → piece breaks, ball
passes through (downward smashes bounce the ball up: breakBounce 0.32);
impulse damage accumulates per group. Cascade/blast queue resolves in
(tick, groupId) total order.

## 6. Economy & progression (owner design)

- **Score → BANK** (cumulative, persisted). Everything is bought from it.
- **Boosters** (shop on the game-over screen; icons = hand-drawn inline SVG;
  activation = tap on the top bar or keys 1–6):
  - one-shot (ARMED until the next matching hit): QUAKE 3000 (huge blast on
    next smash), CHAIN BOMB 2500 (next bomb mega-chains ×2.2 — cascade plays
    in slow motion 0.35×), HEAVY 1800 (next hit breaks anything), BOUNCE 1500
    (next smash launches like a bumper);
  - run-long (ON until game over): SCORE ×2 2200, FEATHER 1200 (tilt ×1.8).
  - Prices tuned so a typical 5–7k run affords 2–3 purchases.
- **Player levels** (LEVEL UP button, cost 4000 × 1.55^(n−1)): each level
  = jump power +90 and cooldown −25 ticks (floor 180); even levels unlock
  ball skins (core/ember/prism/galaxy/aurora — procedural materials);
  levels 5 and 10 grant mine shields (+1 each, per run).
- **Daily tasks:** 3 per UTC date, identical for everyone (seeded roll from
  a pool of 8), progress tracked across runs, claim = +800 bank each,
  +1500 for all three.
- Best score/depth persisted; "NEW BEST!" celebration.
- **Monetization seam** (priority 2, not built): boosters, bank top-ups and
  skins map 1:1 to Telegram Stars purchases; `laserOn` gates the aim assist.

## 7. Presentation

Textureless-first: flat-shaded boxes, palette-coded materials, GlowLayer +
bloom + FXAA, linear fog scaled with camera zoom, translucent walls, depth
fog. Impact-directed shards (glass → triangular panes, stone → chunky
boxes), expanding shockwave discs, ball glow pulse on breaks (NO camera
shake), 220 ms hit-stop + red burst on mine death, jump ring. Camera:
smoothed follow, looks 380 below the ball, portrait aspect zoom
(`portraitTargetAspect 0.85`). HUD: time/score/combo/depth (tabular
numerals), booster bar, jump button. Skins recolor the ball material.

## 8. Verification discipline

- `npm test` green at every commit: determinism double-run checksums (with
  jumps + booster activations in the replay protocol), banned-API source
  grep, booster/jump/mine/shield/meta/daily unit tests.
- Judge from the RUNNING game via the headless suite (real-GPU Chrome):
  cascade, steering (pointer chase + keyboard), jump, mine death, panels,
  level-up purchase, replay, portrait framing, zero console errors.
- Feel tuning = config.ts only. Fail twice → simplify (delete scope).

## 9. Removed by owner decision (do not resurrect without asking)

Tower-tilt visual (world must stay still) · draft gates / mid-run stops of
any kind · ball ghost & time-based racing (this is score-attack, not a
race) · daily shared tower (replaced by full generativity) · par/probes in
the UI (tests only) · camera shake and FOV punches · emoji icons ·
timed-duration boosters (one-shot or run-long only) · pay-to-rehearse
mechanics of any form.
