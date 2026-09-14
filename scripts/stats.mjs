// Prints the attribution counters, DAU and D1/D7 retention from the live Redis.
//   npm run stats
// Nothing to configure: the npm script passes --env-file=.env.local, which
// already holds UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
//
// D1 = share of a day's NEW players (first run that day) who ran again the next
// day; D7 = a week later. "Ran" means a finished run reported to the board, so
// this is Telegram players only — web opens are counted, web play is not.
import { Redis } from "@upstash/redis";

const r = Redis.fromEnv();
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const shift = (d, n) => day(Date.parse(d) + n * 86400e3);

const keys = (await r.keys("stat:src:*")).sort();
const vals = keys.length ? await r.mget(...keys) : [];
console.log("opens by source");
keys.forEach((k, i) => console.log(`  ${k.slice("stat:src:".length).padEnd(24)} ${vals[i]}`));
console.log("players", await r.zcard("lb:total"), " runs", (await r.get("stat:runs")) ?? 0);
const botErr = await r.get("stat:boterr");
if (botErr) console.log("LAST BOT API FAILURE:", botErr);

// Which client each player last ran on, and whether its CloudStorage answered.
// "cloud:silent" is the one that matters: that device cannot sync and its
// progress is stranded.
console.log("\nplayers by client (last run)");
for (const k of await r.keys("p:*")) {
  const h = await r.hgetall(k);
  if (h) console.log(`  ${k.padEnd(14)} level ${String(h.level).padEnd(3)} ${h.env || "(before env tracking)"}`);
}

// Last 14 days of DAU, oldest first.
const days = [...Array(14)].map((_, i) => shift(day(Date.now()), -i)).reverse();
const dau = {};
for (const d of days) dau[d] = new Set((await r.smembers(`dau:${d}`)).map(String));
console.log("\nDAU (players with a run that day)");
for (const d of days) if (dau[d].size) console.log(`  ${d} ${dau[d].size}`);

// Cohorts by first-run day, from the player hashes.
const cohorts = {};
for (const k of await r.keys("p:*")) {
  const first = await r.hget(k, "first");
  if (first) (cohorts[day(Number(first))] ??= []).push(k.slice(2));
}
const back = (uids, d) => (dau[d] ? String(uids.filter((u) => dau[d].has(u)).length) : "-");
console.log("\nretention by first-run day (new / came back D1 / D7; - = outside the 14-day window)");
for (const d of Object.keys(cohorts).sort()) {
  const c = cohorts[d];
  console.log(`  ${d} new ${String(c.length).padEnd(3)} D1 ${back(c, shift(d, 1)).padEnd(3)} D7 ${back(c, shift(d, 7))}`);
}
