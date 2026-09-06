// Perf + fidelity harness. Drives the built game frame by frame in headless
// Chrome under a VIRTUAL clock with a seeded Math.random, so frame N is the
// same frame on every run and on every build — which is what makes two
// builds comparable pixel for pixel, and makes CPU cost per frame a number
// instead of an impression.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/perf-harness.mjs out/new                # depth 0, 900 frames
//   node scripts/perf-harness.mjs out/deep --warp 80     # teleport 80 tiers down
//   node scripts/perf-harness.mjs out/t --timing         # clean CPU numbers, no screenshots
//
// To compare against another build, serve it on another port (a git worktree
// of the old commit, `npx vite preview --port 4174`), run with --url, then
//   node scripts/pixdiff.mjs out/old out/new
//
// Two Math.random streams: Babylon draws GUIDs through String.replace
// callbacks, and how many depends on how many meshes a build creates. The
// game's own draws (run seed, debris, lightning) get a stream of their own so
// both builds see identical values. Telling the two apart costs a stack
// capture per call, which distorts CPU timing — --timing uses one plain
// stream instead (same seed and run, debris differs, no screenshots).
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const outDir = args[0];
if (!outDir) {
  console.error("usage: node scripts/perf-harness.mjs <outDir> [--url U] [--warp N] [--frames N] [--shots a,b,c] [--timing]");
  process.exit(2);
}
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const url = opt("--url", "http://localhost:4173/");
const warp = Number(opt("--warp", "0"));
const frames = Number(opt("--frames", "900"));
const timing = args.includes("--timing");
const shots = new Set(
  (timing ? "" : opt("--shots", "1,45,70,90,120,180,240,300,400,500,600,750,900")).split(",").filter(Boolean).map(Number),
);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.text());
});

await page.addInitScript((t) => {
  window.__timing = t;
}, timing);
await page.addInitScript(() => {
  const mulberry = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let game = mulberry(0x9e3779b9);
  const other = mulberry(0x1234567);
  window.__gameRnd = 0;
  Math.random = window.__timing
    ? () => game()
    : () => {
        if ((new Error().stack || "").includes("String.replace")) return other();
        window.__gameRnd++;
        return game();
      };
  // Reseeded right before PLAY, so the run seed is the first draw after it.
  window.__reseed = () => {
    game = mulberry(0x51ed270b);
  };
  // Virtual clock: performance.now advances 1000/60 per stepped frame; the
  // engine's delta time and the input sampler both read it.
  const realNow = performance.now.bind(performance);
  let vt = 1000;
  performance.now = () => vt;
  let pending = null;
  window.requestAnimationFrame = (cb) => {
    pending = cb;
    return 1;
  };
  window.cancelAnimationFrame = () => {};
  window.__frame = 0;
  window.__step = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const cb = pending;
      pending = null;
      if (!cb) break;
      vt += 1000 / 60;
      const t0 = realNow();
      cb(vt);
      out.push(realNow() - t0);
      window.__frame++;
    }
    return out;
  };
  localStorage.clear();
});

await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.__tf && window.__tf.renderer);
// Canvas only: HUD chips and banners animate on the real clock and would
// only add timing noise to a diff of the rendering.
await page.addStyleTag({ content: ".hud,.booster-bar,.biome-banner,.title{display:none!important}" });
await page.evaluate(() => {
  const r = window.__tf.renderer;
  window.__gl = r.engine.getGlInfo();
  window.__stats = [];
  let lastDraws = 0;
  r.scene.onAfterRenderObservable.add(() => {
    const cum = r.engine._drawCalls.current;
    window.__stats.push({
      f: window.__frame,
      draws: cum - lastDraws,
      active: r.scene.getActiveMeshes().length,
      meshes: r.scene.meshes.length,
      tick: window.__tf.tick,
      depth: window.__tf.depth,
      fin: window.__tf.finished,
      rnd: window.__gameRnd,
    });
    lastDraws = cum;
  });
});
console.log("GL", JSON.stringify(await page.evaluate(() => window.__gl)));
await page.evaluate(() => window.__step(5)); // title screen
await page.evaluate(() => {
  window.__reseed();
  document.getElementById("title-play").click();
});
console.log("seed", await page.evaluate(() => window.__tf.seed));
await page.evaluate(() => window.__step(1));
if (warp > 0) await page.evaluate((w) => window.__tf.warp(w), warp);
// Boosters that exercise every effect path: shield aura, agility trail,
// chain lightning, quake shake.
await page.evaluate(() => {
  const tf = window.__tf;
  tf.grant("shield", 1);
  tf.grant("agility", 1);
  tf.grant("chain", 1);
  tf.grant("quake", 1);
  tf.activate(4); // shield
  tf.activate(5); // agility
});

const cpu = [];
const script = {
  100: () => window.__tf.activate(1), // chain
  130: () => window.__tf.setTilt(0.6, 0.3),
  260: () => window.__tf.setTilt(-0.5, -0.4),
  330: () => window.__tf.activate(0), // quake
  420: () => window.__tf.clearTilt(),
  520: () => window.__tf.jump(),
  700: () => window.__tf.setTilt(0.3, -0.6),
};
for (let f = 1; f <= frames; f++) {
  if (script[f]) await page.evaluate(script[f]);
  const ms = await page.evaluate(() => window.__step(1));
  cpu.push(ms[0] ?? NaN);
  if (shots.has(f)) await page.screenshot({ path: join(outDir, `f${String(f).padStart(4, "0")}.png`) });
  if (await page.evaluate(() => window.__tf.finished)) {
    console.log("finished at frame", f);
    break;
  }
}
const stats = await page.evaluate(() => window.__stats);
writeFileSync(join(outDir, "stats.json"), JSON.stringify({ cpu, stats }, null, 1));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const win = 100;
const lines = [];
for (let i = 0; i < cpu.length; i += win) {
  const c = cpu.slice(i, i + win);
  const st = stats.filter((s) => s.f > i && s.f <= i + win);
  const avg = (k) => (st.length ? Math.round(sum(st.map((s) => s[k])) / st.length) : 0);
  const sorted = [...c].sort((a, b) => a - b);
  lines.push(
    `frames ${i + 1}-${i + c.length}: cpu avg ${(sum(c) / c.length).toFixed(2)}ms p95 ${sorted[Math.floor(sorted.length * 0.95)]?.toFixed(2)}ms max ${sorted[sorted.length - 1]?.toFixed(2)}ms | draws ${avg("draws")} active ${avg("active")} meshes ${avg("meshes")} | depth ${st[st.length - 1]?.depth}`,
  );
}
console.log(lines.join("\n"));
writeFileSync(join(outDir, "summary.txt"), lines.join("\n") + "\n");
await browser.close();
