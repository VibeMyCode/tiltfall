# Babylon.js forum — "Show your work" post (FINAL, verified against code)

> Status: ready to publish by owner on forum.babylonjs.com (Show your work).
> Owner attaches 2–4 screenshots after the text. Fact-checked 2026-09-06
> against the game repo by the game's own dev agent.

---

**Title: TILTFALL — an endless falling-ball arcade built with Babylon.js (playable now, in browser & Telegram)**

I've been building a small arcade game on Babylon.js and it finally reached a state I'm happy to share publicly.

The pitch: a glowing ball plummets down an endlessly generated tower. You steer it in the air, punch through glass panes, crack stone blocks (they throw you back up), detonate bombs into chain reactions, bounce off launchers — and survive the mines that end the run in one touch. Every run is a freshly generated tower, score banks between runs, and five biomes crossfade as you fall deeper.

For anyone curious about the engine side:

- **Pure-TypeScript fixed-timestep simulation at 1/120 s, no physics engine.** The ball is an AABB for collision purposes, resolved along the minimum-penetration axis in a fixed contact order (walls, then blocks by id). Breaking is impulse-based; multi-cell pieces (L, П, 2×2) share a group id, break as a whole and score once.
- **Determinism by construction.** Seeded RNG streams only — no `Math.random`, `Date` or transcendental Math inside the sim modules (a test greps for them). Same seed + same input log ⇒ same run. The leaderboard relies on it: a new best is accepted only after the server re-runs the run from its input log.
- **Procedural endless tower.** Tiers stream from the run seed ahead of the fall, the walls follow the ball, tiers left behind are disposed — so the mesh count stays flat however deep you go. No floor, no loading seams.
- **Blocks are flat-colour, untextured StandardMaterials**; the only textures are the ball skins (24 painted ones) and the two face marks. GlowLayer + bloom + FXAA, depth fog scaled with camera zoom, impact-directed debris, one hit-stop beat on death. Opaque repeats (block bodies, spikes, mines, debris) are hardware instances; effects are pooled. No per-hit camera shake — impacts pulse the ball instead, so the camera never fights the steering; only the QUAKE booster jolts it once.
- **Babylon 9.23 via subpath imports**; the whole game including the engine is 1.2 MB, 300 KB gzipped.
- **Runs on phones** (portrait and landscape), tablets and desktops, no install.

Play it in Telegram (Mini App, leaderboard + skins): https://t.me/tiltfall_bot/play
Browser build: https://tiltfall.com/

Screenshots below. I'd genuinely love FPS reports from real devices, especially mid-range Android — and any feedback or bug reports. Devlog and weekly challenges live at @tiltfall_news.
