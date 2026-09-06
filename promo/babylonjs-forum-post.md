# Babylon.js forum — "Show your work" post (DRAFT)

> Status: not published. To publish: register on forum.babylonjs.com, open
> "Show your work" board, post under your account. Community norm = devlogs
> are welcome there; this is a dev post, not an ad.

---

**Title: TILTFALL — an endless falling-ball arcade built on Babylon.js (playable in-browser)**

I built a small arcade game on Babylon.js 9 and it's finally in a state I'm
happy to share. Every run is a freshly generated endless crystal tower; you
steer a glowing ball down it, punch through glass panes, smash stone blocks,
chain bombs, bounce off bumpers — and one touch of a mine ends the run.

**Why it might interest you (the engine bits):**
- Pure-TypeScript fixed-timestep simulation at 1/120 s with **no physics
  engine** — sphere-vs-AABB collisions with min-penetration axis resolution,
  contact order fixed by wall/block ids, impulse-based piece breaking.
- **Determinism by construction**: seeded RNG streams only (no
  `Math.random`/`Date` inside sim modules). Same seed + same input log ⇒ same
  run — the replay protocol is used in the test suite.
- **Procedural level generation**: tiers are streamed from the run seed ahead
  of the fall; multi-cell pieces (L, П, 2×2) share group ids and break as a
  whole with one score event.
- **Textureless presentation**: flat-shaded materials, GlowLayer + bloom +
  FXAA, depth fog that scales with camera zoom, impact-directed shards.
  Kept it all shader/effect work on the engine side, zero external art.
- Five depth biomes crossfade sky, fog, walls and block tints as you fall.

**Play it:** https://tiltfall.vercel.app (plain web, no install)
**Or in Telegram:** https://t.me/tiltfall_bot/play (same game, plus leaderboard)

It ships as a Telegram Mini App, so the browser build is deliberately
dependency-light and runs on phones — I'd love FPS reports from real
hardware, especially on the deep tower levels where the mesh count climbs.
Feedback, bug reports and "it lags on my phone" messages are all welcome!
