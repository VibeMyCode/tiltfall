# X / Twitter launch thread (DRAFT)

> Status: not published. Needs an X account (owner). Suggested cadence:
> 1 thread/week. #screenshotsaturday works for reach; keep hashtags ≤ 3.
> Media to attach: press/telegram-1280x720.png, press/logo.webp, public/og.jpg.
> Short gameplay clips (10–20 s) outperform images once the clip pipeline
> exists.

---

**Post 1 (thread start, #indiedev):**
I spent the summer building TILTFALL — an endless falling-ball arcade where
every run is a freshly generated crystal tower. No ads, no install, plays in
the browser or right inside Telegram. 🕹️

**Post 2:**
The pitch is simple: steer the ball down. Smash glass, punch stone, chain
bombs into slow-mo cascades, bounce off bumpers — and never, ever touch a
mine. One touch. That's the run.

**Post 3:**
Everything is procedural. Towers stream from a per-run seed — 120 Hz
deterministic sim, no physics engine, same seed = same tower. We use the
determinism for replays in the test suite. (Yes, I am that kind of dev.)

**Post 4:**
Textureless-first look: flat materials, glow layer, depth fog, impact
shards. Five biomes crossfade the deeper you fall. Runs on phones — portrait
or landscape — no install, ~free.

**Post 5 (CTA):**
Play the browser build: tiltfall.netlify.app
Or in Telegram (leaderboard + skins): t.me/tiltfall_bot/play
Free. Tell me your depth record. 🏔️ #screenshotsaturday #webgame

**Follow-up/engagement drafts:**
- Reply to record screenshots: "Nice depth! The mines get personal around
  tier 40+ — what's your survival secret?"
- Retweet-and-ask: "Devs: fixed-timestep 120 Hz or accumulator pattern for a
  falling-ball sim? I chose the first, details in the devlog."
