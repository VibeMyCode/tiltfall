# itch.io page copy (DRAFT)

> Status: not published. Needs: itch.io account + API key (owner), then the
> HTML5 build can be uploaded/updated by Hermes via butler CLI. itch allows
> external links in the page body — put the Telegram link there, not in the
> embedded game frame. Cover art: use press/telegram-1280x720.png or a
> cropped 630×500 variant.

---

**Title:** TILTFALL

**Tagline:** Steer the falling ball. Smash everything. Dodge the mines.

**Short description (one line, for listings):**
Endless falling-ball arcade with a procedural crystal tower, chained
explosions and one-touch mines. Free, no ads, runs in the browser.

**Tags:** endless · arcade · physics · procedural · web · high-score ·
casual · balls

**Classification:** Web → HTML5 (playable in browser)
**Price:** Free
**Genre:** Arcade / Casual
**Status:** Released (playable, actively tuned)
**Controls:** Mouse/touch drag to steer (relative), WASD/arrows as fallback,
Space to jump. Portrait and landscape.

**Full description:**

TILTFALL drops a glowing ball down an endless, freshly generated crystal
tower — and leaves the steering to you.

Smash through glass panes, punch stone blocks apart, detonate bombs into
chain reactions, bounce off launchers, ride shockwave boosters. Every hit
feels physical: impact-directed shards, hit-stop on kills, slow-mo cascades.
Then the mines start showing up — one touch ends the run.

Every run is a brand-new tower, streamed from a per-run seed. No two falls
are alike, and the sim is deterministic: same seed, same run.

Score banks between runs. Spend it on boosters and player levels (jump
power, mine shields, ball skins). Play in the browser here, or in Telegram
for the full version with leaderboard and skins: https://t.me/tiltfall_bot/play

Free, no ads, no install. Portrait or landscape, phone or desktop.

**Devlog notes (first post):**
Built with Babylon.js 9 + TypeScript. Pure-TS fixed-timestep sim at 120 Hz,
no physics engine — collisions, cascade order and break thresholds are all
hand-rolled and deterministic. Post-launch tuning happens in a single
config file. More technical detail on the Babylon.js forum post (link).
