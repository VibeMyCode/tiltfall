// Leaderboard API. GET returns the public board; POST reports a finished run.
//
// The trust model, since it is the whole point of this file:
//  - WHO you are comes from Telegram's initData signature, never from a field
//    in the body. Without that anyone could post as anyone.
//  - WHAT you scored is only believed once the sim has been re-run from the
//    proof (see src/replay.ts). A score above your own verified best is
//    refused until a proof arrives, and one at or below it is clamped to that
//    best - so the lifetime total can only grow as fast as you have actually
//    proven you can play.
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createHmac, timingSafeEqual } from "node:crypto";
import { replayScore, type RunProof } from "../src/replay";

// Lazy: module bodies run at build time too, and Redis.fromEnv() throws when
// the credentials are not there yet. Nothing here should need a database to be
// importable — the tests below import this file precisely to avoid one.
let _redis: Redis | null = null;
const db = (): Redis => (_redis ??= Redis.fromEnv());

let _limiter: Ratelimit | null = null;
const rateLimit = (): Ratelimit =>
  (_limiter ??= new Ratelimit({
    redis: db(),
    // A run takes tens of seconds, so this is generous for a player and still
    // caps a script hammering the endpoint.
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    prefix: "rl",
  }));

const BEST = "lb:best"; // ZSET uid -> best verified run
const TOTAL = "lb:total"; // ZSET uid -> lifetime points
const RUNS = "stat:runs";
const TOP_N = 100;
const player = (uid: string) => `p:${uid}`;

interface Row {
  uid: string;
  name: string;
  level: number;
  skin: string;
  best: number;
  total: number;
  runs: number;
  depth: number;
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

// --- identity ---------------------------------------------------------------

interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

// Telegram signs initData with a key derived from the bot token. Verifying it
// is the only thing standing between the board and anyone claiming any id.
export function verifyInitData(initData: string): TgUser | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || typeof initData !== "string" || initData.length > 4096) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // Telegram signs the fields sorted by key, one "k=v" per line.
  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const mine = createHmac("sha256", secret).update(check).digest();
  // Buffer.from(..., "hex") silently drops anything that is not hex rather than
  // throwing, so a short or malformed hash has to be rejected by shape first.
  if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
  if (!timingSafeEqual(mine, Buffer.from(hash, "hex"))) return null;

  // A signature stays valid forever, so freshness is what stops a captured
  // initData being replayed months later.
  const authDate = Number(params.get("auth_date"));
  if (!isFinite(authDate) || Date.now() / 1000 - authDate > 86_400) return null;

  try {
    const u = JSON.parse(params.get("user") ?? "null") as TgUser | null;
    return u && typeof u.id === "number" ? u : null;
  } catch {
    return null;
  }
}

// --- reading ----------------------------------------------------------------

async function topRows(): Promise<Row[]> {
  const flat = (await db().zrange(BEST, 0, TOP_N - 1, { rev: true, withScores: true })) as (
    | string
    | number
  )[];
  const uids: string[] = [];
  const bests: number[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    uids.push(String(flat[i]));
    bests.push(Number(flat[i + 1]));
  }
  if (!uids.length) return [];

  // One round trip for every profile in the page, not one per row.
  const pipe = db().pipeline();
  for (const uid of uids) pipe.hgetall(player(uid));
  for (const uid of uids) pipe.zscore(TOTAL, uid);
  const res = (await pipe.exec()) as unknown[];

  return uids.map((uid, i) => {
    const h = (res[i] ?? {}) as Record<string, string>;
    return {
      uid,
      name: h?.name ?? "player",
      level: Number(h?.level ?? 1),
      skin: h?.skin ?? "core",
      best: bests[i],
      total: Number(res[uids.length + i] ?? 0),
      runs: Number(h?.runs ?? 0),
      depth: Number(h?.depth ?? 0),
    };
  });
}

export async function GET(): Promise<Response> {
  const [rows, players, runs] = await Promise.all([topRows(), db().zcard(TOTAL), db().get<number>(RUNS)]);
  return json(
    { rows, players, runs: Number(runs ?? 0) },
    // The board is the same for everyone, so the CDN can serve it. Personal
    // rank rides on the POST response instead, which keeps this cacheable.
    { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=60" } },
  );
}

// --- writing ----------------------------------------------------------------

interface SubmitBody {
  initData?: string;
  score?: number;
  depth?: number;
  level?: number;
  skin?: string;
  proof?: RunProof;
}

const num = (v: unknown, max: number) =>
  typeof v === "number" && isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0;

export async function POST(request: Request): Promise<Response> {
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return json({ error: "bad json" }, { status: 400 });
  }

  const user = verifyInitData(body.initData ?? "");
  if (!user) return json({ error: "unverified" }, { status: 401 });
  const uid = String(user.id);

  if (!(await rateLimit().limit(uid)).success) return json({ error: "slow down" }, { status: 429 });

  const claimed = num(body.score, 1e9);
  const best = Number((await db().zscore(BEST, uid)) ?? 0);

  // Above your own proven best, a proof is required — and a fresh player's
  // best is 0, so the very first ranking run is verified like any other.
  let verified = 0;
  if (claimed > best) {
    if (!body.proof) return json({ needProof: true }, { status: 200 });
    const r = replayScore(body.proof);
    if (!r) return json({ error: "bad proof" }, { status: 400 });
    if (r.score !== claimed) return json({ error: "proof does not match", scored: r.score }, { status: 409 });
    verified = r.score;
  }

  // Unproven runs still count toward the totals, but only up to what this
  // player has actually demonstrated — so grinding cannot outrun ability.
  const counted = verified || Math.min(claimed, best);

  const pipe = db().pipeline();
  pipe.hset(player(uid), {
    name: (user.first_name ?? user.username ?? "player").slice(0, 32),
    level: String(num(body.level, 999)),
    skin: String(body.skin ?? "core").slice(0, 24),
    seen: String(Date.now()),
  });
  pipe.hincrby(player(uid), "runs", 1);
  pipe.incr(RUNS);
  pipe.zincrby(TOTAL, counted, uid);
  if (verified > best) {
    pipe.zadd(BEST, { score: verified, member: uid });
    pipe.hset(player(uid), { depth: String(num(body.depth, 100000)) });
  }
  await pipe.exec();

  const [rank, total] = await Promise.all([db().zrevrank(BEST, uid), db().zscore(TOTAL, uid)]);
  return json({
    ok: true,
    verified: verified > 0,
    best: Math.max(best, verified),
    total: Number(total ?? 0),
    rank: rank === null ? null : Number(rank) + 1,
  });
}
