# TILTFALL

Babylon.js + Vite + TypeScript game built to `SPEC.md`. Engine guide: `babylon.md`.

Run it: `npm install` · `npm run dev` (served on 0.0.0.0:5173) · `npm test` · `npm run build`

## Status

**Shipped (M0-M5):** endless generative tower (fresh random seed per run,
tiers streamed as you fall), mines end the run, jump with cooldown/charges,
BANK economy — score funds boosters (one-shot QUAKE/CHAIN, run-long ×2/HEAVY/
AGILITY, instant SHIELD) and 15 player levels (jump power, procedural skins,
free shields, extra jump charge, booster unlocks cheapest-first), daily tasks,
title screen, synthesized WebAudio SFX (zero audio files), PWA manifest for
"add to home screen". Tests: 18 unit (determinism, banned APIs, boosters, jump,
mines/shields, meta/daily) + a headless suite driving a real-GPU browser.

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
