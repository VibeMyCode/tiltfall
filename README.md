# TILTFALL

Babylon.js + Vite + TypeScript game built to `SPEC.md`. Engine guide: `babylon.md`.

Run it: `npm install` · `npm run dev` (served on 0.0.0.0:5173) · `npm test` · `npm run build`

## Status

**Built:** M0 (owner-approved with feedback applied) + **M1 — The toy**, now in
proper modules per SPEC §10: `config.ts` (all tunables), `rng.ts` (mulberry32 named
streams, FNV-1a, dateSeed), `levelgen.ts` (seeded 5-tier generator, M1 subset of
§4.3), `sim.ts` (pure deterministic simulation: §3.3 physics, contact order,
impulse/break-through, support cascades, combo ×10, scoring, finish), `input.ts`
(pointer drag + WASD/arrows eased to parity, per-tick millitilt sampling),
`render.ts` (Babylon mirror: glow/bloom/fog, impact-inheriting shards, floor debris,
shockwaves, hit-stop, shake, tilt zoom-out, portrait aspect zoom), `ui.ts` (HUD:
time/score/combo; Results + replay). Tests: determinism (checksummed double-run),
banned-API source grep, smoke. Headless-verified: cascade, steering by pointer AND
keyboard, full descent → results → replay, portrait framing, median 60 fps, zero
console errors.

**Shipped (M0-M5):** endless generative tower (fresh random seed per run,
tiers streamed as you fall), mines end the run, jump with cooldown/charges,
BANK economy — score funds boosters (one-shot QUAKE/CHAIN, run-long ×2/HEAVY/
AGILITY, instant SHIELD) and 15 player levels (jump power, procedural skins,
free shields, extra jump charge, booster unlocks cheapest-first), daily tasks,
title screen, synthesized WebAudio SFX (zero audio files), PWA manifest for
"add to home screen". Tests: 18 unit (determinism, banned APIs, boosters, jump,
mines/shields, meta/daily) + a headless suite driving a real-GPU browser.

### Milestones (from SPEC.md §11)

- [ ] **M0 — The feel probe**: one tier of blocks, exact §3.3 physics via gravity-tilt, drag input only, one 3-dependent cascade. Owner must confirm tilt feels controllable and cascade reads as an avalanche.
- [ ] **M1 — The toy**: shaft + 5-tier tower from fixed seed, flat-colored boxes, ball, tilt via drag AND keyboard, bounces, impulse breaking, combo, score, run clock → bare Results. Median FPS ≥ 55.
- [ ] **M2 — Avalanche and drafts**: dependency-graph cascades with shard/particle/shake effects; draft gates (3-card UI, countdown, auto-pick); all 8 cards via `effectiveRunConfig`; anti-stall guards; par from probes.
- [ ] **M3 — The meta**: save/load, crystals, 15-tier track with Free-Fall-only stat firewall, endless Free Fall, offline miners, daily quests, streak.
- [ ] **M4 — Daily and ghosts**: date-seeded Daily with frozen stats, ghost record/co-sim/replay (translucent ball + gate split deltas), par pacer, local leaderboards, share codes.
- [ ] **M5 — Spectacle, garnish, ship**: §9.1 polish pass, optional generated garnish, SFX, PWA manifest, config tuning; Lighthouse mobile ≥ 75 and median FPS ≥ 50 during a cascade-heavy capture.

## Build notes (durable — read before writing code)

- **Babylon 9 has no `exports` map**: import by actual camelCase file paths, e.g.
  `@babylonjs/core/Cameras/arcRotateCamera`, and `Scene` lives at the package root
  (`@babylonjs/core/scene`). Confirm IMPORT PATHS (and nothing else) against
  `node_modules/@babylonjs/core` when unsure. Never read Babylon sources to derive
  behavior, rotation signs, or conventions — resolve those by running the game and
  flipping a constant if it looks wrong.
- **npm cache is EPERM in this sandbox**: run installs with
  `npm install --cache /tmp/dsh-npm-cache`.
- Headless-capture readiness: `src/main.ts` sets a `__DSH_READY` flag on the first
  rendered frame — gate screenshots/videos on it.

## Assets

Generated assets live under `src/assets/` (loaded via Vite). No paid generation spent yet — `$asset-gen` requires owner confirmation first.

| Asset | Kind | Source / prompt | Status |
| ----- | ---- | --------------- | ------ |
| `public/favicon.svg` | icon | Vite template scaffold | present |
