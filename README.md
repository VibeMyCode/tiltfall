# TILTFALL

Babylon.js + Vite + TypeScript game built to `SPEC.md`. Engine guide: `babylon.md`.

Run it: `npm install` · `npm run dev` (served on 0.0.0.0:5173) · `npm test` · `npm run build`

## Status

**Built:** scaffold + **M0 feel probe** in `src/main.ts` (single file per SPEC §11 M0):
§3.3 physics with the gravity-tilt trick, pointer-drag tilt, one 8×8 tier (~30 blocks:
glass/stone + support with 3 dependents), impulse breaking with break-through, staggered
cascade with shard animation + screen shake, smoothed follow camera, auto-reset on floor
rest. Headless-verified (real GPU, cascade breaks 4 blocks, tilt steers both ways,
auto-reset fires, zero console errors).

**Left:** owner playtest gate for M0 (tilt feel + avalanche read), then M1+.

**Next:** owner plays at http://localhost:5173 → verdict on feel → M1 (config/rng/sim
extraction into modules, 5-tier tower, keyboard input, HUD).

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
