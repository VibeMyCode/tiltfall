// Copies one Upstash Redis database into another, key by key, keeping types
// and TTLs, then reads both back and compares. Used to move the ledger and
// the leaderboard off the Vercel-managed database.
//
//   node --env-file=.env.local scripts/redis-copy.mjs          # dry run: lists what would move
//   node --env-file=.env.local scripts/redis-copy.mjs --apply  # copies, then verifies
//
// Source: KV_REST_API_URL / KV_REST_API_TOKEN (Vercel's names).
// Destination: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (what the API reads).
// Rate-limit windows (rl:*) are skipped: they expire within a minute anyway.
import { Redis } from "@upstash/redis";

const apply = process.argv.includes("--apply");
const need = (k) => {
  if (!process.env[k]) {
    console.error(`missing ${k}`);
    process.exit(2);
  }
  return process.env[k];
};
// Raw strings in, raw strings out: no JSON guessing on either side.
const src = new Redis({ url: need("KV_REST_API_URL"), token: need("KV_REST_API_TOKEN"), automaticDeserialization: false });
const dst = apply
  ? new Redis({ url: need("UPSTASH_REDIS_REST_URL"), token: need("UPSTASH_REDIS_REST_TOKEN"), automaticDeserialization: false })
  : null;

async function allKeys(r) {
  let cursor = "0";
  const keys = [];
  do {
    const [c, ks] = await r.scan(cursor, { count: 1000 });
    cursor = String(c);
    keys.push(...ks);
  } while (cursor !== "0");
  return keys.filter((k) => !k.startsWith("rl:")).sort();
}

// One canonical snapshot of a key: type + content, comparable across databases.
async function snapshot(r, k) {
  const type = await r.type(k);
  let value;
  if (type === "string") value = await r.get(k);
  else if (type === "hash") value = await r.hgetall(k);
  else if (type === "set") value = (await r.smembers(k)).sort();
  else if (type === "zset") value = await r.zrange(k, 0, -1, { withScores: true });
  else if (type === "list") value = await r.lrange(k, 0, -1);
  else throw new Error(`${k}: unsupported type ${type}`);
  return { type, value, ttl: await r.pttl(k) };
}

async function write(r, k, s) {
  await r.del(k);
  if (s.type === "string") await r.set(k, s.value);
  else if (s.type === "hash") await r.hset(k, s.value);
  else if (s.type === "set") await r.sadd(k, ...s.value);
  else if (s.type === "zset") {
    const entries = [];
    for (let i = 0; i < s.value.length; i += 2) entries.push({ member: s.value[i], score: Number(s.value[i + 1]) });
    await r.zadd(k, ...entries);
  } else if (s.type === "list") await r.rpush(k, ...s.value);
  if (s.ttl > 0) await r.pexpire(k, s.ttl);
}

const keys = await allKeys(src);
console.log(`${apply ? "copying" : "would copy"} ${keys.length} keys`);
const snaps = new Map();
for (const k of keys) {
  const s = await snapshot(src, k);
  snaps.set(k, s);
  console.log(`  ${s.type.padEnd(6)} ${k}${s.ttl > 0 ? `  ttl ${Math.round(s.ttl / 1000)}s` : ""}`);
  if (dst) await write(dst, k, s);
}
if (!dst) process.exit(0);

// Verify: every key reads back with the same type and content; TTLs within a
// few seconds (time passed while copying).
let bad = 0;
for (const k of keys) {
  const a = snaps.get(k);
  const b = await snapshot(dst, k);
  const same = a.type === b.type && JSON.stringify(a.value) === JSON.stringify(b.value) && Math.abs(a.ttl - b.ttl) < 10000;
  if (!same) {
    bad++;
    console.log(`MISMATCH ${k}`, JSON.stringify(a), JSON.stringify(b));
  }
}
const extra = (await allKeys(dst)).filter((k) => !snaps.has(k));
if (extra.length) console.log(`destination has extra keys: ${extra.join(", ")}`);
console.log(bad ? `${bad} keys differ` : `verified: ${keys.length} keys identical on both sides`);
process.exit(bad ? 1 : 0);
