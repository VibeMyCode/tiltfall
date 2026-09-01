# TILTFALL — Game Specification (BGE v2)

A spectacular vertical-descent arcade game. A glowing ball plummets down a huge
crystalline tower. The player does not steer the ball — they **tilt the entire tower**
like a giant labyrinth toy, steering the ball's ricochets through tiers of breakable
blocks. Smashes chain into avalanches of shattering crystal. Between tiers the fall
freezes for 3 seconds to draft one of three power cards. At the end you compare your
descent against a recorded ghost. Runs last 60–90 seconds. Identical with touch and
mouse/keyboard, on phones, tablets, PCs and Macs, in the browser.

This document is the single source of truth for an autonomous AI coding agent.
It supersedes the earlier Orbit Smash spec as the active build target. Build milestone
by milestone (M0 → M5, section 11). Do not skip ahead: each milestone has acceptance checks and
must be proven from the running game, not from a clean compile.

---

## 1. Vision and pillars

1. **Spectacle first.** Every second on screen must feel kinetic: a falling ball,
   shattering blocks, cascading debris, particles, glow, screen shake. The wow is the
   destruction, and it is produced by CODE (flat-shaded geometry + emissive colors +
   bloom + particles), not by textures. Zero generated textures are required for the
   game to look great — see §9.
2. **One verb everywhere.** Tilt is the only continuous control. Drag anywhere
   (touch or mouse) or hold WASD/arrows — identical result. Card drafting is a single
   tap/click/keypress.
3. **Determinism by construction.** All gameplay simulation is hand-rolled math in
   pure TypeScript. NO physics engine (no Havok, no Cannon, no Ammo). Same seed +
   same input log ⇒ bit-identical simulation on every device. Hard rules in §5.4.
4. **Fair by architecture.** The daily competitive run uses frozen baseline stats for
   everyone; progression upgrades apply only in Free Fall mode. Nothing purchasable or
   unlockable ever touches the physics of a compared run. Daily attempts are free and
   unlimited (best score counts — replaying the Daily IS the practice); what is
   forbidden is any PAID practice or paid advantage on the competitive seed.
5. **Short sessions, long pull.** A descent is ~90 seconds. The meta (upgrade track,
   daily seed, quests, streak, offline miners) makes the player return daily.
6. **Forgiving architecture.** Small flat modules, plain functions, one save JSON,
   all tunable numbers in one config file. Optimized for iteration by a local LLM.

Out of scope for v1 (do not build): accounts, backend of any kind, real-time
multiplayer, anti-cheat, monetization (a designed seam exists — §8), audio music
tracks, localization (English UI only), gyroscope input.

---

## 2. Tech stack

- **Engine/host:** Babylon.js + TypeScript + Vite (godogen `babylon` target). Browser
  game; production = static `dist/`. Same conventions as SPEC_v1 §2.
- **Rendering:** one Babylon scene, perspective camera looking slightly down into a
  vertical shaft, following the ball. The TOWER mesh tilts visually; the ball stays
  near screen center. GlowLayer + bloom via DefaultRenderingPipeline; GPU particles.
- **Gameplay simulation:** pure TypeScript module with zero Babylon imports
  (`sim.ts`). Rendering mirrors sim state; sim never reads the renderer.
- **UI:** plain HTML/CSS DOM overlay (buttons, panels, counters, card picker).
- **Persistence:** a single JSON object in `localStorage`.
- **Tests:** vitest (`npm test`), importing `sim.ts` / `levelgen.ts` / `meta.ts` directly.
- **No other runtime dependencies.**

### Logical space

The sim runs in **tower-local coordinates**: a rectangular shaft, X ∈ [0, 1200],
Z ∈ [0, 1200], Y downward from 0 at the top (Y increases as the ball falls). All sim
units are logical. **The tilt trick (load-bearing):** the sim NEVER rotates geometry.
Tilting the tower is implemented as rotating the *gravity vector* in tower-local space:
`g = (g0 * kTilt * tiltX, g0, g0 * kTilt * tiltZ)` with tilt in [-1, 1] per axis
(linear by design — do NOT reach for trig here; §5.4 bans it in the sim).
The renderer rotates the tower mesh (and counter-rotates the camera) by
`tiltX * maxVisualTiltDeg` for the visual "you are tilting the mountain" effect.
The visual sign/axis mapping is NOT derivable in advance and does not matter:
define `visualTiltSignX/Z = 1` in config, run the game, and flip a sign if the
tower leans the wrong way. Do not investigate engine rotation conventions.
Sim stays axis-aligned forever: collisions are sphere-vs-AABB and sphere-vs-wall only.
Vertical geometry: ball radius 40; tier slabs are 700 units apart in Y; a 5-tier tower
is ~3500 units tall plus the floor. All of it in `config.ts`.

**Override note:** godogen's babylon.md advises driving gameplay off the engine frame
delta — for THIS project that guidance is overridden: gameplay advances only through
the fixed-timestep accumulator (§5.4). Never enable Havok or any physics plugin.

---

## 3. Core gameplay

### 3.1 Controls (input parity is mandatory)

- **Touch / mouse:** pointer down anywhere starts a tilt gesture; drag offset from the
  gesture origin maps linearly to (tiltX, tiltZ), clamped to [-1, 1] at
  `tiltFullDragPx` (~140 px, DPI-scaled). Release → tilt eases back to 0 over 250 ms.
  One code path via pointer events.
- **Keyboard:** arrows/WASD set target tilt per axis (-1/0/+1); actual tilt eases
  toward target at `tiltKeyEase` per second, so keyboard and a fast drag feel the same.
- **Card gates:** tap/click a card, or keys 1/2/3. Nothing else is interactive mid-run.
- Input is sampled ONCE per sim tick into integer millitilts (-1000..1000 per axis);
  the input log (§5.3, `ghost.ts`) stores these samples. The sim consumes only the sampled log —
  never raw events — so live play and replay share one code path.

### 3.2 The tower and the descent

- A run = one tower of **5 tiers** + a floor. Each tier is a horizontal platform slab
  spanning the shaft, carrying a seeded grid of unit blocks (§4) with gaps. The ball
  falls, bounces and rolls under tilted gravity, smashes through breakable blocks,
  drops through gaps to the next tier.
- Between tiers — the **draft gate** (§3.4), with NO sloped geometry (the sim has no
  sloped surfaces): when the ball falls below a tier's exit plane, the sim enters a
  scripted GATE state — over 30 ticks the ball's position lerps to the gate anchor
  (shaft center, fixed Y) and velocity zeroes, then the sim freezes for the draft.
  After the pick the ball is released from the anchor with velocity (0, dropSpeed, 0).
  The renderer dresses this as an energy funnel/beam — visual only.
- The run clock counts up; it PAUSES during draft freezes. There is no death: spikes
  and dead-ends cost time and combo, never the run. The run ends when the ball
  reaches the floor. Score favors fast, destructive, high-combo descents.
- Anti-stall guards: if ball speed stays < `restSpeed` for 1.5 s, a horizontal
  auto-nudge impulse of fixed magnitude is applied toward the target gap —
  deterministically chosen as the open gap cell on the current tier with the smallest
  squared distance to the ball, ties broken by lowest cell index. If a tier takes
  > 45 s, the tier's remaining blocks auto-shatter (spectacular pity cascade) and the
  ball drops through. (Both guards exist in Daily only; Free Fall uses the Surge, §5.2.)

### 3.3 Ball physics (pure TS, deterministic)

Fixed timestep `dt = 1/120 s`, semi-implicit Euler:

```
v += gravity(tilt) * dt
v *= drag                    // 0.999 per step
v = clampLength(v, maxSpeed)
pos += v * dt
resolve collisions (total order, §5.4)
```

- **Sphere vs AABB** (blocks, platform slabs, safety platforms): push out along the
  minimum-penetration axis; reflect the velocity component on that axis with the
  surface's restitution; tangential components keep `friction` factor (0.98).
- **Sphere vs shaft walls** (4 planes): restitution 0.6.
- Restitution: platform slab 0.35, generic block 0.5, bumper block 1.3, spike 0.8.
- **Impact impulse** (used for breaking): `J = round(|v_normal| * ballMass / impulseScale)`
  in integer impulse units; calibrate `impulseScale` in config so a free fall from one
  tier height lands at J ≈ 25 (the glass 8 / stone 22 thresholds assume this scale).
  Computed BEFORE the bounce response.
- **Break-through rule (load-bearing):** if J ≥ the block's remaining threshold, the
  block breaks and applies NO bounce — the ball passes through, keeping its velocity
  minus a 10% `breakThroughLoss` on the normal component (Piercer card: 0%). If J <
  threshold, a normal bounce applies and the block accumulates J damage toward its
  threshold.
- **Contact order:** when the ball overlaps several colliders in one tick, resolve in
  this fixed order: floor/tier slabs, then walls W0..W3, then blocks by ascending
  blockId.

### 3.4 Draft gates and the card pool

Daily: 4 gates (after tiers 1–4). Free Fall: a gate after every 2nd tier, endless.
At a gate: freeze the sim (the tick counter pauses — draft wall-clock time NEVER counts
toward run time), show 3 cards, 3.0 s countdown ring, auto-pick the highlighted
(leftmost) card on timeout. The 3 offers are drawn by `rng(towerSeed, gateIndex)` —
in Daily the tower seed is the date seed, so offers are **identical for every player
on Earth that day**, independent of account/level. A card's effect lasts until the
next gate (the last one until the floor). Pool of 8 (all numbers in `config.ts`):

| id | Card | Effect until next gate |
|---|---|---|
| shockwave | Shockwave | each break also breaks blocks within radius `1 + floor(breaksThisCombo / 15)` cells, where `breaksThisCombo` = blocks broken in the current unbroken combo chain — scales with in-run state, so no fixed "best pick" exists |
| heavy | Heavyweight | ballMass ×1.4 (breaks stone in one hit), tilt authority ×0.8 |
| feather | Featherlight | tilt authority ×1.35, ballMass ×0.75 |
| chain | Chain Reactor | cascade propagation depth +1 hop (§4.2) |
| magnet | Crystal Magnet | crystals within a FIXED 120 units drift to the ball — independent of the Free-Fall magnet upgrade stat, so the card also works in Daily where that stat is 0 |
| bouncy | Bouncy | all restitutions +0.25 |
| pierce | Piercer | first 6 breakable blocks this tier break at any impulse without slowing the ball |
| surge | Combo Surge | combo timer window ×2 this tier |

Card effects are applied through a single `effectiveRunConfig(baseCfg, activeCard,
runState)` function — never scattered `if (card)` checks.

### 3.5 Scoring and combo

- Breaking a block: +points per block type (§4.1), multiplied by the current combo.
- Combo: any break within `comboWindow` (2.5 s) of the previous raises combo
  ×1 → ×2 → … up to ×10. Spike hits reset combo to ×1. Cascade breaks (§4.2) count.
- Bumper hits: +5 flat — never multiplied by combo, never extends the combo window.
- Crystals: currency pickup (flat, never multiplied) — entity model in §4.1.
- `runTimeMs = simTicks * dt * 1000` — pure sim time; draft freezes and pauses add zero.
- Finish bonus: `max(0, parTimeMs - runTimeMs) / 100` points (par per seed from
  levelgen probes, §4.3).
- Run score = block points + finish bonus. Shown with per-tier splits.

---

## 4. Blocks, destruction, level generation

### 4.1 Block types

Unit cell 100×100×100. Per tier: a W×D grid (8–10 × 8–10) with 25–40% gap cells.

| Type | Break threshold (impulse units) | Points | Notes |
|---|---|---|---|
| glass | 8 | 10 | most common; shatters bright |
| stone | 22 | 25 | needs speed or Heavyweight |
| crystal | 8 | 15 | also drops 2 crystals (currency) |
| support | 8 | 20 | breaking it triggers its dependents (§4.2) |
| bumper | unbreakable | 5 per hit | restitution 1.3, launches the ball |
| spike | unbreakable | 0 | resets combo; slight speed loss |

**Crystal entities:** breaking a crystal block spawns 2 crystal pickups at the block
center (offset ±30 on X). They fall under un-tilted gravity, ignore all collisions,
are collected when within `crystalPickupRadius` (60) of the ball, and despawn after
600 ticks. Under the Crystal Magnet card, crystals within 120 units additionally move
toward the ball at `magnetSpeed` per tick (deterministic). Crystals are sim entities
and are part of the determinism contract.

### 4.2 Cascade destruction — precomputed dependency graph (load-bearing)

There is NO simulated rubble physics. At levelgen time, per tier, build a
**dependency graph**: each `support` block lists 2–5 dependent block ids (blocks
"resting on it" — chosen by adjacency above/diagonal). At runtime:

- When a block's accumulated impulse ≥ its threshold → emit `Break(blockId, tick)`.
- Breaking a `support` enqueues its dependents with `delay = cascadeStepTicks`
  (12 ticks) between hops, up to `cascadeDepth` hops (baseline 2; modifiers are
  ADDITIVE and stack: Chain Reactor card +1, Free-Fall Cascade I upgrade +1).
- The break queue is processed **in deterministic total order: sort by (tick, blockId),
  single-threaded, one pass per tick.** This rule exists because simultaneous
  same-tick impacts otherwise resolve in platform-dependent order and fork the
  simulation. The same rule applies to contact resolution — full fixed order in §3.3:
  floor/slabs → walls W0..W3 → blocks by ascending blockId.
- Broken blocks become non-colliding instantly in the sim. Everything the player
  SEES on a break — the block splitting into 6–10 flying shards, tumbling and
  fading — is render-only (canned shard animation from a seeded per-type variation
  table, GPU particles, glow pulse, screen shake scaled by cascade size). The sim
  never knows shards exist.

### 4.3 Level generation (`levelgen.ts`, seeded)

Given a seed, generate the tower: for each tier, place gaps (connected — at least one
gap path reachable from any quadrant), then blocks by weighted type table, then
2–4 supports with their dependency lists, 1–2 bumpers, 0–2 spikes (tier 1: zero
spikes), crystals on ~15% of breakables. Then run the **validation probe**: 16
deterministic probe descents through the real sim with pity systems DISABLED. Probe
inputs come from a fixed table in `config.ts`: 8 constant tilts at compass headings
(strength 0.6), 4 alternating zig-zags (2 s period), 2 lookup-table spirals, 1
zero-tilt, 1 full-tilt. Require: for ≥ 80% of probes, EVERY tier individually clears
in < 40 s (the 5 s margin under the 45 s pity threshold is intentional); else
regenerate with seed+1009. After 10 failed loops FAIL LOUDLY (throw — surfaced in
tests and as an on-screen generation error); never silently accept an unvalidated
tower. Probe results also produce `parTimeMs` (median probe time × 0.9) and per-tier
pace splits used for ghost pace markers.

Daily seed = `hash(YYYYMMDD)` (UTC). Free Fall seeds = random (outside the sim).

---

## 5. Modes, fairness, determinism

### 5.1 Daily Descent (competitive)

One shared seeded tower per UTC day. Attempts are free and UNLIMITED; the best score
of the day counts (replaying today's tower is by design — it is the free practice).
**Frozen baseline config for everyone** — upgrade tiers (§7.2) do NOT apply here;
only cosmetics do. Your best run's input log becomes today's **ghost**. Completing at
least one Daily feeds the streak.

### 5.2 Free Fall (progression playground)

Endless tower (tiers keep generating, difficulty ramps: more stone/spikes, narrower
gaps every 3 tiers), random seed each run, upgrades ACTIVE, crystal farming. This is
where progression is felt. No leaderboard (local best depth/score only).

Structure: a draft gate after every 2nd tier, offers from `rng(runSeed, gateIndex)`.
The run ends when the **Surge** — a glowing energy ceiling that starts 2 tiers above
the ball and descends at `surgeSpeed` (+8% per tier passed) — catches the ball, or
when the player taps the always-visible "Bail out" button. Either way all crystals
and score are kept; score = depth reached + block points. The Surge exists only in
Free Fall; the pity systems (§3.2) exist only in Daily.

### 5.3 Ghost — separate-instance architecture (load-bearing)

A ghost is `{seedDate, simVersion, inputLog, cardPicks, score, splits}`; a stored
ghost whose `simVersion` differs from the current build's is discarded on load. Gate
protocol: the tick counter pauses during drafts (§3.4), so input logs contain no
draft time; the ghost co-sim applies its recorded pick instantly on entering each of
its own gates. Split deltas compare tick-time at gate entries. During a Daily run, the
ghost is replayed in a **second, fully independent SimState** advancing in the same
tick loop — its own tower copy, its own destruction state, zero interaction with the
live run. Renderer shows only: a translucent ghost ball + trail (it may pass through
blocks that are intact in YOUR tower — that is correct and expected), and split-time
deltas at each gate ("+1.2 s vs ghost"). Never render the ghost's tower state.
If no own ghost exists yet, use `parTimeMs` pace splits as a "par pacer" line (no
ghost ball). Keep ghosts for the last 3 dates.

### 5.4 Determinism rules (hard, non-negotiable)

- `sim.ts`, `levelgen.ts`, `cards.ts` never call `Math.random`, `Date.now`,
  `performance.now`, `Math.sin/cos/tan/atan2/pow/exp/log`, and never read frame time.
  Allowed math: `+ - * /`, `Math.sqrt`, `Math.abs/min/max/floor/round`, comparisons
  (IEEE-754-exact and identical across JS engines). If an angle is ever needed,
  use the shared 256-entry lookup table in `mathtab.ts`.
- Randomness only via injected mulberry32 streams (`rng.ts`); separate named streams
  for levelgen / card offers / shard-variation so adding a draw in one never shifts
  another.
- Fixed timestep 1/120 with an accumulator in `main.ts`; the sim never sees frame
  delta. Input sampled once per tick as integer millitilts (§3.1).
- Collision & break resolution follow the total-order rules of §4.2.
- A static banned-API test (`banned-api.test.ts`) greps the SOURCE of `sim.ts`,
  `levelgen.ts`, `cards.ts`, `mathtab.ts` for `Math.random`, `Date.`,
  `performance.now`, `Math.sin/cos/tan/atan/pow/exp/log` and fails on any hit —
  the cheapest guard against a determinism leak sneaking in.
- The determinism test (§10) replays a recorded log twice and cross-checks state
  checksums every 120 ticks; it is the first test written and must stay green forever.
  M4's two-browser-profiles check extends it cross-instance; additionally running it
  in a second engine (Safari/Firefox) is recommended — any divergence there means a
  banned-API leak, since all allowed operations are IEEE-exact per ECMA-262.

---

## 6. Competition (async, no backend in v1)

- **Local leaderboards:** best Free Fall depth/score ever; best Daily score per date
  (keep 30 days).
- **Ghost:** §5.3.
- **Share codes:** Results screen → "Copy challenge code":
  `base64url(JSON {v:2, d:"YYYY-MM-DD", s:<score>, t:<runTimeMs>, sp:[tier splits],
  h:<FNV-1a of the other fields>})`; reject codes whose `h` mismatches (deters casual
  text-editor forgery; real anti-cheat stays out of scope).
  Paste on the Daily panel → friend row ranked next to your score with split
  comparison. Invalid input → shake, nothing stored. Shape validation only.
- **v2 seam (do not build now):** a tiny HTTP backend storing `{date, score,
  inputLog}` would enable true global ghosts and a world leaderboard; `ghost.ts`
  already treats a ghost as opaque `{inputLog, cardPicks}` so a downloaded ghost
  plugs in with zero sim changes. Server-side replay validation (rerun the log,
  compare score) is the anti-cheat seam — explicitly out of scope for v1.

---

## 7. Meta and retention

All meta logic in `meta.ts` as pure functions over the save object.

### 7.1 Crystal economy

Crystals are the only currency. Sources: crystal blocks in runs, offline miners,
quest rewards, streak bonuses. Sink: the 15-tier upgrade track.

### 7.2 Upgrade track — exactly 15 sequential tiers

Bought strictly in order. **Stat tiers apply in Free Fall ONLY (via
`effectiveConfig(save, mode)`); cosmetic tiers apply everywhere.** Table lives
verbatim in `config.ts`:

| Tier | Cost | Reward | Type |
|---|---|---|---|
| 1 | 60 | Magnet I — magnetRadius 0 → 80 (Free Fall) | stat |
| 2 | 120 | Ball skin: **Ember** (lava core) | cosmetic |
| 3 | 200 | Tilt I — tilt authority ×1.1 (Free Fall) | stat |
| 4 | 320 | Tower biome: **Glacier** palette | cosmetic |
| 5 | 480 | Starting card: pick from 4 at gate 1 (Free Fall) | stat |
| 6 | 700 | Ball skin: **Orbit** (ringed) | cosmetic |
| 7 | 980 | Combo I — comboWindow 2.5 → 3.0 s (Free Fall) | stat |
| 8 | 1350 | Tower biome: **Magma** palette | cosmetic |
| 9 | 1800 | Magnet II — magnetRadius 80 → 130 (Free Fall) | stat |
| 10 | 2400 | Ball skin: **Prism** (refracting) | cosmetic |
| 11 | 3100 | Cascade I — cascadeDepth +1 (Free Fall) | stat |
| 12 | 3900 | Miner upgrade — offline rate 25 → 40 crystals/h | stat |
| 13 | 4900 | Ball skin: **Nova** (pulsing glow) | cosmetic |
| 14 | 6100 | Combo II — max combo ×10 → ×12 (Free Fall) | stat |
| 15 | 7500 | **Aurora** biome + permanent iridescent trail | cosmetic |

### 7.3 Offline miners

`earned = min(hoursSince(lastSeenTs), 12) * minerRate` on app load. Persist the new
`lastSeenTs` (and credited amount) to the save IMMEDIATELY, before showing the collect
dialog — reloads or multiple tabs must not double-credit. Collect dialog with
count-up when earned ≥ 5. Clock cheating is explicitly not our problem.

### 7.4 Streak

Increments on first completed Daily per UTC day; miss a day → reset to 1. Flame icon.
Every 3rd streak day: +180 crystals toast.

### 7.5 Daily quests

3 distinct quests per UTC day, seeded by date (same for everyone), from a pool of 12:
break 40 glass; break 10 stone; trigger 5 cascades; reach ×8 combo; collect 60
crystals; finish a Daily; beat your Daily best (only if one exists — otherwise take
the next quest in the same seeded shuffle order, skipping duplicates);
finish 3 runs; finish a tier under 8 s; hit 6 bumpers in one run; pick 4 different
cards today; reach Free Fall tier 8. Reward: 60 crystals each, +120 when all three
done. Progress bars + claim buttons on Home.

---

## 8. Monetization seam (priority 2 — design in, do NOT implement)

The save schema includes `entitlements: string[]` (empty in v1) and all cosmetics
resolve through `isOwned(save, id)`. A future Telegram Stars build adds purchasable
entitlements: cosmetic skins/biomes/trails, extra Free Fall practice slots, quest
reroll. **Rule, stated here so it never gets violated later: nothing purchasable may
ever alter Daily-run physics or card offers, and practice purchases never run on the
competitive daily seed.** No payment code, no store UI in v1.

---

## 9. Art and audio — textureless-first

### 9.1 Primary art direction (no generated images required)

The game's look is built entirely from code and geometry — this is the PRIMARY
direction, not a fallback:

- Flat-shaded low-poly (flat normals, vertex colors), Monument-Valley-like purity.
- One 5-color palette per biome (Classic/Glacier/Magma/Aurora) in `config.ts`;
  blocks tinted per type (glass = translucent alpha 0.55 + fresnel rim, crystal =
  emissive core, spikes = dark with warning tint).
- DefaultRenderingPipeline: bloom (weight ~0.4), slight vignette, FXAA. GlowLayer for
  emissive: the ball, crystal cores, combo-charged ball trail. A `quality` setting
  (auto-detected from measured fps, overridable in settings) may disable bloom/glow
  and halve particle counts on weak devices — gameplay identical, dressing lighter.
- Ball trail: Babylon TrailMesh; brightness scales with combo.
- Break spectacle: seeded canned shard animations (§4.2) + particle bursts — use
  `GPUParticleSystem.IsSupported ? GPUParticleSystem : ParticleSystem`; the CPU
  fallback is mandatory (older WebViews lack WebGL2) — +
  screen shake (amplitude by cascade size) + brief chromatic flash at combo ≥ ×5.
- Sky/background: procedural vertical gradient + slow parallax fog planes.
  Depth fog tints deeper tiers darker for a sense of descent.

### 9.2 Optional generated garnish (never a blocker)

If the local Draw Things API (FLUX, A1111-style, `POST http://127.0.0.1:7860/sdapi/v1/txt2img`)
is reachable: background nebula/cavern paintings per biome (1024×576) and ~14 UI
icons (256²), style anchor: `"flat vector game icon, bold silhouette, soft glow,
dark background, saturated palette"`. Fallback: `GOOGLE_API_KEY` Gemini image gen;
final fallback: procedural gradients + emoji-free CSS icons already defined in
`ui.ts`. Paid generation (Gemini, Tripo3D) requires explicit user opt-in per
AGENTS.md; in an autonomous run with no human in the loop, default to SKIPPING all
paid tiers. If `TRIPO3D_API_KEY` is set and time permits: 3 decorative low-poly props
per biome (statues/arches on tier edges, non-colliding). Generated art is milestone
M5 garnish; the game must look shippable without any of it.

### 9.3 Audio

No audio files. `sfx.ts` synthesizes ~10 SFX with WebAudio (oscillator + noise +
gain envelopes): glass shatter (noise burst), stone crack, cascade rumble (layered),
bumper ding, crystal pickup arpeggio note (pitch rises with combo), card pick,
gate whoosh, finish fanfare, tick of the draft countdown. Mute toggle in save.
Resume AudioContext on first gesture.

---

## 10. Code layout, save schema, tests

```
src/
  main.ts     — boot, Babylon engine/scene, fixed-timestep loop with accumulator,
                mode switching, ghost co-simulation driver
  config.ts   — ALL tunables: physics, tilt, block table, card pool, cascade, economy,
                tier table, quest pool, biome palettes, par constants
  rng.ts      — mulberry32(seed), named stream helper, dateSeed(dateStr), hash
  mathtab.ts  — shared integer-indexed lookup tables (sin/cos 256 entries)
  sim.ts      — pure simulation: SimState, step(state, inputSample), collisions in
                total order, impulse/break/cascade queue, combo, scoring.
                NO Babylon imports, no Math.random, no Date, no transcendentals.
  levelgen.ts — seeded tower generator + dependency graphs + probe validation + par
  cards.ts    — card definitions, gate offer rolls, effectiveRunConfig
  ghost.ts    — input-log record (millitilt samples + picks), replay adapter,
                share-code encode/decode
  render.ts   — Babylon meshes mirroring SimState; tower tilt visuals; shard
                animations; particles; camera follow; letterbox/safe-area
  input.ts    — pointer + keyboard → per-tick millitilt sampler; card pick input
  meta.ts     — pure: miners, buyTier, effectiveConfig(save, mode), quests, streak
  save.ts     — load/save/migrate localStorage JSON ("tiltfall.save.v2"), autosave,
                corrupted-save recovery
  score.ts    — run bookkeeping, splits, results computation
  ui.ts       — DOM screens: Home / Run HUD / Draft overlay / Results; quest panel,
                upgrade track, skin/biome picker, friends list
  sfx.ts      — WebAudio synth
tests/
  determinism.test.ts — replay same log twice ⇒ identical checksums each 120 ticks
                        (1500+ ticks, includes a cascade and a gate)
  banned-api.test.ts  — source grep of sim/levelgen/cards/mathtab for banned APIs (§5.4)
  levelgen.test.ts    — 20 seeds + the NEXT 60 real calendar dates ⇒ constraints hold,
                        probes pass without hitting the 10-loop cap, par produced
  cascade.test.ts     — dependency graph: total order, depth limits, Chain Reactor
  cards.test.ts       — daily offers deterministic per date+gate; effectiveRunConfig
  meta.test.ts        — miners cap; tier order/costs; Free-Fall-only stat firewall
                        (Daily config unchanged at tier 15); quests; streak;
                        share-code round-trip
```

Style rules: plain functions/interfaces over classes (except where Babylon requires);
no `any`; files under ~300 lines — split if bigger; one-line responsibility header
per module.

### Save schema

```ts
interface SaveV2 {
  v: 2;
  crystals: number;
  tier: number;                        // 0..15 sequential
  skin: "core"|"ember"|"orbit"|"prism"|"nova";
  biome: "classic"|"glacier"|"magma"|"aurora";
  muted: boolean;
  entitlements: string[];              // v1: always [] (monetization seam, §8)
  lastSeenTs: number;
  bestFreeFall: { depth: number; score: number };
  daily: Record<string, { best: number; timeMs: number; done: boolean }>; // 30 dates
  ghosts: Record<string, { simVersion: number; log: number[]; picks: number[];
                           score: number; splits: number[] }>;   // keep 3 dates
  quests: { date: string; items: { id: string; progress: number; claimed: boolean }[] };
  streak: { count: number; lastDate: string };
  friends: { code: string; date: string; score: number; timeMs: number;
             splits: number[] }[];
}
```

---

## 11. Milestones and acceptance

After each milestone: `npm test`, run the game, capture proof (godogen capture flow —
15–20 s clip or live URL). Done = acceptance passes **in the running game**.

**M0 — The feel probe (throwaway, hours not days).** A single file: one tier of ~30
blocks placed by a SHORT INLINE LOOP over a rows×cols grid with fixed constants (do
NOT derive individual coordinates by hand — write the loop and let it compute them;
no levelgen module), the exact §3.3 physics with the gravity-tilt trick, drag input
only, one support block with 3 dependents cascading via canned animation. NO levelgen,
cards, meta, ghost. Purpose: falsify the core bet before anything else is built.
*Accept:* the OWNER (a human) plays it in a browser and confirms two things — tilting
feels controllable, and the cascade reads as an avalanche rather than scripted
vanishing. If either fails, stop and redesign; do not proceed to M1.

**M1 — The toy.** Shaft, one 5-tier tower from a fixed seed, primitive flat-colored
boxes, ball, tilt via drag AND keyboard, bounces, block breaking by impulse, combo,
score, run clock, floor → bare Results. *Accept:* median `engine.getFps()` ≥ 55 over
a 10 s sample on desktop (logged during capture); the tilt visibly
rotates the tower mesh while the sim stays axis-aligned; mouse-drag and WASD produce
the same feel; determinism test green; breaking a block at speed works and glass vs
stone thresholds differ.

**M2 — Avalanche and drafts.** Dependency-graph cascades with canned shard
animations + particles + shake; draft gates with 3-card UI, countdown, auto-pick;
all 8 cards functional via `effectiveRunConfig`; anti-stall guards; par from probes.
*Accept:* cascade/cards/levelgen tests green; a support break visibly avalanches
5+ blocks; each card demonstrably changes the run; a no-input run still finishes
(pity systems fire).

**M3 — The meta.** Save/load, crystals, 15-tier track with the Free-Fall-only stat
firewall, Free Fall endless mode with difficulty ramp, offline miners, daily quests,
streak. *Accept:* meta tests green (including the firewall test: Daily physics
identical at tier 0 and tier 15); reload preserves all; Free Fall at tier 3 feels
visibly more agile than Daily.

**M4 — Daily and ghosts.** Date-seeded Daily, frozen-stat enforcement, ghost record/
co-simulation/replay with translucent ball + gate split deltas, par pacer when no
ghost, local leaderboards, share codes with friend rows. *Accept:* two fresh browser
profiles on one date show identical towers and identical gate card offers; a ghost
from the previous best races correctly; ghost ball passing through your intact
blocks is visibly acceptable (translucent); codes round-trip.

**M5 — Spectacle, garnish, ship.** Full §9.1 polish pass (glow, bloom, trails,
chromatic flash, depth fog, palettes ×4), optional FLUX/Tripo3D garnish per §9.2,
SFX, PWA manifest + icons, economy/difficulty tuning over `config.ts` (first run
earns 40–80 crystals; tier 1 affordable after ~2 runs; median first Daily finishes
under par + 20 s), final proof clip. *Accept:* all tests green; Lighthouse mobile
performance ≥ 75 AND median `engine.getFps()` ≥ 50 during a cascade-heavy 20 s
desktop capture — Lighthouse measures load, not gameplay, so BOTH bars are required;
proof clip shows: draft pick → cascade avalanche → ×6 combo → finish vs ghost with
split deltas → quest claim.

---

## 12. Verification discipline

- `npm test` green at every commit; determinism test is sacred.
- Judge from the running game (clips/screenshots), never from compile success.
- Feel tuning = edit `config.ts` only; log changes in `TUNING.md`.
- If a step fails twice, simplify the approach — prefer deleting scope over adding
  machinery. The descope ladder, in order: drop Tripo3D props → drop FLUX garnish →
  disable bloom/glow via the quality setting (the sanctioned fix for perf-bar
  misses) → reduce card pool to 4 → reduce tiers per tower to 3 → drop the ghost
  ball (keep par pacer + splits). Never descope: determinism, tilt parity, the
  fairness firewall, cascade total order.
