// Prints the attribution counters and headline numbers from the live Redis.
//   npm run stats
// Nothing to configure: the npm script passes --env-file=.env.local, which
// already holds UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
import { Redis } from "@upstash/redis";

const r = Redis.fromEnv();
const keys = (await r.keys("stat:src:*")).sort();
const vals = keys.length ? await r.mget(...keys) : [];
console.log("opens by source");
keys.forEach((k, i) => console.log(`  ${k.slice("stat:src:".length).padEnd(24)} ${vals[i]}`));
console.log("players", await r.zcard("lb:total"), " runs", (await r.get("stat:runs")) ?? 0);
