# TILTFALL

Steer a falling ball down an endless tower. Smash blocks for combos, dodge the
mines, ride boosters deeper through five biomes. Ships as a Telegram Mini App
([@tiltfall_bot](https://t.me/tiltfall_bot/play)) and as a plain web page —
every Telegram call is guarded, so the browser build is the same game minus
payments and the leaderboard.

Babylon.js + Vite + TypeScript, built to `SPEC.md`. Engine guide: `babylon.md`.

`npm install` · `npm run dev` (0.0.0.0:5173) · `npm test` · `npm run build`

## What is built

**The run.** Endless generative tower, fresh seed each time, tiers streamed as
you fall. Mines end it. Glass is punched through, stone bounces, bombs brake.
Five depth biomes crossfade sky, fog, walls and block tints. The ball rolls as
it falls, so the whole skin comes past.

**The meta.** Score banks into coins; coins buy boosters (one-shot QUAKE and
CHAIN BOMB, run-long ×2/HEAVY/AGILITY, instant SHIELD) and 15 player levels
that hand out jump power, free shields, an extra jump charge, skins, and the
boosters themselves cheapest-first. Three daily tasks pay 1000 each.

**Telegram.** SDK bootstrap, haptics, CloudStorage progress mirrored across
devices, a bot that answers `/start` with a launch button, and a SHARE that
posts the run.

**Leaderboard.** Server-side, and it does not take your word for it — see
*Fairness* below.

**Stars.** Continue a dead run (30/60/120, dearer each time within the run),
open a booster ahead of its level, reroll the daily tasks, buy any of 24 skins,
or buy one as a gift for a friend.

**Skins.** 24 painted textures across four rarities, plus the free ones levels
hand out, in their own store screen. Four are drawn in code, not painted: the
eyes.

Tests: 76 across 16 files — determinism, pinned golden runs, replay
verification, initData signatures, the product catalogue, the skin table, palettes, level furniture,
cross-device sync, banned APIs, ESM import specifiers.

## How it is put together

| | |
| --- | --- |
| `src/sim.ts` | the whole game, deterministic, no DOM and no renderer |
| `src/render.ts` | Babylon: tower, ball, shards, trails, biome palettes |
| `src/ui.ts` | every screen — HUD, results, menu, store, leaderboard, sheets |
| `src/main.ts` | wiring, persistence, the run loop |
| `src/replay.ts` | records inputs, re-runs them to a score |
| `api/` | the API: leaderboard, Stars, the bot webhook (Netlify functions via `netlify/functions/`) |

`api/_store.ts` is the ledger — Upstash Redis, wallets and entitlements.
`api/_initdata.ts` is the only place a Telegram identity is verified. Both are
underscore-prefixed by convention: only the three files with a Netlify adapter
are reachable as endpoints.

Environment: see *Deploying*.

## Fairness

The leaderboard is the reason several things are shaped the way they are.

- **Who** you are comes from Telegram's initData HMAC, never from a field in
  the request body.
- **What** you scored is believed only after the server re-runs the sim from
  the recorded inputs. A score above your verified best is refused without a
  proof; one at or below it is clamped to that best.
- That only works because the sim is deterministic: fixed 120 Hz, `dt: 1/120`,
  no `Math.random`, no wall clock, and no transcendental `Math` either — those
  are implementation-approximated and differ between JS engines, so the
  server's replay would disagree with the phone that produced it.
  `tests/determinism.test.ts` and `tests/banned-api.test.ts` keep it that way.
  **Anything that breaks determinism breaks the leaderboard.**
- Paid continues are counted against a server-side ledger, so a run carried on
  three times cannot be reported as one clean run.

## Things that cost us a production incident

Durable, non-obvious, and cheaper to read than to rediscover.

- **`api/` imports need explicit `.js`.** Vercel used to transpile those files
  one by one, and Node will not guess extensions for relative imports; the dev
  server resolved them either way, which is exactly how a crash reached
  production. Netlify bundles with esbuild and would forgive it, but
  `tests/imports.test.ts` keeps the rule so the code stays runnable under any
  per-file transpiler. `api/` and `netlify/` are in the tsconfig `include`.
- **Babylon's sphere runs V bottom-up.** The BOTTOM edge of a texture is the
  pole facing the camera. Get it backwards and the design lands on the far
  side of the ball.
- **The camera is 34° off the pole** (`camHeight` 1500 over `camDist` 1020),
  so what faces the player is not the top of the texture.
- **Skin previews project the equator**, not the pole — the pole is the single
  point where every texture column converges, and a pole-on swatch turns
  stripes into a whirlpool. The four eye skins are the exception and carry
  `polar: true`.
- **Telegram CloudStorage keys allow only `A-Za-z0-9_-`.** Dotted keys are
  rejected silently; `cloudKey()` maps them.
- **Babylon 9 has no `exports` map**: import by real camelCase paths, e.g.
  `@babylonjs/core/Cameras/arcRotateCamera`; `Scene` is at the package root.
  Read `node_modules/@babylonjs/core` to confirm an import path exists — never
  to derive behaviour. Sign conventions get settled by running the game.
- **A hosting 403 may be about your IP, not the project.** A flagged VPN exit
  node gets challenged by the CDN edge. curl from it proves nothing.

## Performance

Built for mid-range phones; `src/render.ts` explains each rule in place.
Everything opaque that repeats (block bodies, spike cones, mines, debris) is
a hardware instance of one template, so a tier costs a handful of draw calls
rather than one per block. Debris, rings, lightning and the comet tail are
pooled and reused, never built mid-run. Tiers two spacings above the ball are
disposed — a deep run used to carry six thousand meshes behind it. The sim
scans only the tiers around the ball (`tierStart`), bit-identical to the full
scan, and `tests/golden.test.ts` pins three runs and their aim paths so a
scan that visits one block out of order cannot pass.

Numbers are measured, not guessed: `scripts/perf-harness.mjs` drives the
built game under a virtual clock with a seeded random, reports CPU per frame,
draw calls and active meshes, and screenshots fixed frames;
`scripts/pixdiff.mjs` compares two runs pixel for pixel. Same seed, depth 80,
M3 Max: 7.4-13 ms → 1.0-2.2 ms CPU per frame, 540-930 → 140-210 draw calls.
Frames with no debris in flight are pixel-identical to the pre-instancing
build; the one known deviation is the blend order of translucent glass shards
overlapping each other, since a batch draws in pool order rather than by
depth. Glass blocks and the face marks are deliberately NOT instanced for
that reason: they are alpha-blended and sort per mesh.

## Assets

| Asset | Kind | Source | Status |
| --- | --- | --- | --- |
| `public/skins/*.jpg` | 20 ball textures, 512px | image generator, prompt in git history | shipped, 960 KB with thumbs |
| `public/skins/t/*.jpg` | 128px thumbnails | derived, used by the store grid | shipped |
| the four eyes | canvas patterns in `src/skins.ts` | drawn in code | shipped |
| `art/skins/` | 1024px masters | kept out of the build | local only, 4.7 MB |
| `press/` | promo card for BotFather | generated | local only |
| SFX | synthesized WebAudio | `src/sfx.ts`, zero audio files | shipped |

A generator kept tiling the eye textures vertically, which wraps into a
dartboard on a sphere. An eye is four flat bands and three commas — drawing it
was shorter than describing it.

## Deploying

Netlify, from `master`: every push builds `dist` and publishes it, so a merge
is a deploy. `netlify.toml` names the build and the functions directory;
`public/_headers` carries the Telegram `frame-ancestors` CSP and the immutable
cache for hashed assets. The API handlers stay in `api/` as plain
Request → Response functions; `netlify/functions/*.mts` are the adapters that
give each one its path. Environment (set in Netlify, not in the repo):
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`. After changing one, redeploy — functions read
them at boot. The bot's webhook must point at `/api/telegram` on the live
domain with the same secret (`setWebhook`), and BotFather's Mini App URL at
the site root.

Attribution: every open sends one beacon and the server bumps `stat:src:<tag>`.
In Telegram the tag is the `startapp` payload (so an ad link is
`t.me/tiltfall_bot/play?startapp=ads_x`) or `tg` for a bare open, and opens
that went through the bot chat count as `bot`. On the web it is `?src=<tag>`
(use it on every link you post: `https://tiltfall.netlify.app/?src=forum`),
falling back to the referrer host, then `web`. Read the counters with
`npm run stats` (it loads `.env.local` itself).
