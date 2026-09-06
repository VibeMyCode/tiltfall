# Babylon.js forum — "Show your work" post (FINAL)

> Status: ready to publish by owner on forum.babylonjs.com (Show your work).
> Owner attaches 2–4 screenshots after the text.

---

**Title: TILTFALL — an endless falling-ball arcade built with Babylon.js (playable now, in browser & Telegram)**

I've been building a small arcade game on Babylon.js and it finally reached a state I'm happy to share publicly.

The pitch: a glowing ball plummets down an endlessly generated crystal tower. You steer it in the air, smash through glass panes, punch stone blocks apart, detonate bombs into chain reactions, bounce off launchers — and survive the mines that end the run in one touch. Every run is a freshly generated tower, score banks between runs, and a handful of biomes crossfade as you fall deeper.

For anyone curious about the engine side:

- **Pure-TypeScript fixed-timestep simulation at 1/120 s, no physics engine.** Sphere-vs-AABB with min-penetration-axis resolution, fixed contact order (walls, then blocks by id), impulse-based piece breaking. Multi-cell pieces (L, П, 2×2) share a group id, break as a whole and score once.
- **Determinism by construction.** Seeded RNG streams only — no `Math.random`, no `Date` inside the sim modules. Same seed + same input log ⇒ same run; the test suite replays runs and compares checksums.
- **Procedural endless tower.** Tiers stream from the run seed ahead of the fall; the walls follow the ball. No floor, no loading seams.
- **Textureless-first presentation.** Flat-shaded materials, GlowLayer + bloom + FXAA, depth fog scaled with camera zoom, impact-directed shards, short hit-stop on kills. No camera shake — the camera never fights the steering.
- **Runs on phones** (portrait and landscape), tablets and desktops, no install.

It ships as a Telegram Mini App, so the browser build is deliberately lean and mobile-first — the same game minus payments and the leaderboard.

Play it: https://t.me/tiltfall_bot/play (Telegram Mini App)
Browser build: https://tiltfall.vercel.app

Screenshots below. I'd genuinely love FPS reports from real devices on deep tower levels (the mesh count climbs as you fall) — and any feedback or bug reports. Devlog and weekly challenges live at @tiltfall_news.
