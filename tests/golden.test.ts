// Pinned outcomes. The leaderboard recounts runs by replaying them, so the sim
// must produce EXACTLY these numbers forever — a perf change to the block scan
// that visits one block in a different order would silently invalidate every
// stored proof. predictPath is pinned too: it is the aim thread, and a wrong
// landing disc is a lie to the player.
import { describe, expect, it } from "vitest";
import { activateBooster, createSim, jump, predictPath, step } from "../src/sim";

function scripted(tick: number): { x: number; z: number } {
  if (tick < 160) return { x: 0, z: 0 };
  const phase = tick >> 7;
  const x = ((phase % 4) - 1.5) * 0.6;
  const z = (((phase >> 1) % 3) - 1) * 0.5;
  return { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 };
}

function run(seed: number, ticks: number, shields: number) {
  const sim = createSim(seed, { shields, jumpMaxCharges: 2 });
  const sums: number[] = [];
  const paths: number[] = [];
  for (let t = 0; t < ticks && !sim.finished; t++) {
    if (t === 240) activateBooster(sim, "quake");
    if (t === 700) activateBooster(sim, "x2");
    if (t === 1500) activateBooster(sim, "chain");
    if (t === 2600) activateBooster(sim, "heavy");
    if (t % 400 === 399) jump(sim);
    const inp = scripted(t);
    step(sim, inp.x, inp.z);
    if (t % 120 === 0) {
      sums.push(Math.round(sim.ball.x * 31 + sim.ball.y * 7 + sim.ball.z * 13 + sim.score * 97 + sim.broken * 991));
      const p = predictPath(sim, inp.x, inp.z);
      let h = p.points.length * 1000003 + (p.wallHit ? 7 : 0) + (p.landed ? 13 : 0);
      for (const q of p.points) h = (h * 31 + Math.round(q.x * 3 + q.y * 5 + q.z * 7)) % 2147483647;
      paths.push(h);
    }
  }
  return { sums, paths, score: sim.score, depth: sim.depth, broken: sim.broken, tick: sim.tick };
}

describe("golden outcomes", () => {
  it("seed 20260901 with shields", () => {
    expect(run(20260901, 6000, 2)).toMatchInlineSnapshot(`
      {
        "broken": 93,
        "depth": 10,
        "paths": [
          257776954,
          1307697739,
          1922716610,
          711646311,
          1361946602,
          1812272918,
          1382879076,
          1946592612,
          1055723184,
          1320970306,
          811249802,
          1924636210,
          1262910737,
          401329638,
          1925090842,
          1701930586,
          123219001,
          316589731,
          507314143,
          193136263,
        ],
        "score": 2492,
        "sums": [
          29582,
          41696,
          60917,
          187590,
          205285,
          204888,
          222923,
          225431,
          245365,
          258471,
          251015,
          263952,
          293852,
          310520,
          475378,
          481568,
          495186,
          517310,
          505590,
          527300,
        ],
        "tick": 2372,
      }
    `);
  });
  it("seed 777 bare", () => {
    expect(run(777, 6000, 0)).toMatchInlineSnapshot(`
      {
        "broken": 65,
        "depth": 6,
        "paths": [
          257776954,
          1221839186,
          1922716610,
          461846392,
          2086630152,
          1519699552,
          1375219535,
          332420421,
          84323648,
          64386213,
          566621860,
          591195607,
          1924479033,
          107263623,
        ],
        "score": 1461,
        "sums": [
          29582,
          41696,
          61014,
          217948,
          246369,
          245146,
          254211,
          264198,
          298617,
          311993,
          317386,
          332671,
          343324,
          360015,
        ],
        "tick": 1634,
      }
    `);
  });
  it("seed 424242 with shields", () => {
    expect(run(424242, 6000, 2)).toMatchInlineSnapshot(`
      {
        "broken": 62,
        "depth": 5,
        "paths": [
          257776954,
          1221839186,
          1685276312,
          1423174327,
          906863911,
          221989510,
          1923628986,
          867709800,
          1254331447,
          597463607,
          679589344,
          697716075,
          295106009,
        ],
        "score": 1804,
        "sums": [
          29582,
          41696,
          85251,
          232335,
          263670,
          260115,
          274311,
          273195,
          288553,
          298447,
          302353,
          302789,
          364947,
        ],
        "tick": 1454,
      }
    `);
  });
});
