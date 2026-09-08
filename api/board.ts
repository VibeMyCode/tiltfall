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
// Explicit .js: the platform compiles this to ESM and Node does not guess extensions
// for relative imports. The local dev server resolves it either way, which is how the
// deployed function came to crash on import while local testing stayed green.
import { verifyInitData } from "./_initdata.js";
import { db, entitlements, rateLimit, spendRevives } from "./_store.js";
import { replayScore, type RunProof } from "../src/replay.js";
import { CONFIG } from "../src/config.js";

const BEST = "lb:best"; // ZSET uid -> best verified run
const TOTAL = "lb:total"; // ZSET uid -> lifetime points
const RUNS = "stat:runs";
const TOP_N = 100;
// One run cannot have been continued more times than this. The array is
// attacker-controlled and each entry costs a full replay, so it is bounded
// before any of that work is done.
const MAX_SEGMENTS = 12;
const player = (uid: string) => `p:${uid}`;
// HASH {by: who invited this uid, paid: "1" once the inviter has been credited}.
// Both fields are written with HSETNX and never deleted — not even by RESET
// PROGRESS — so one account is one welcome bonus and one payout, ever.
const referral = (uid: string) => `ref:${uid}`;
const refPending = (uid: string) => `ref:pending:${uid}`; // coins owed, drained on boot
const refKids = (uid: string) => `ref:kids:${uid}`; // SET of invitees who played

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
  hit?: string; // attribution beacon, see src/board.ts sourceTag
  boot?: boolean; // Telegram boot: register an invite, collect referral coins
  ref?: string; // inviter uid from startapp=r_<uid>
  initData?: string;
  score?: number;
  depth?: number;
  level?: number;
  skin?: string;
  proofs?: RunProof[];
}

const num = (v: unknown, max: number) =>
  typeof v === "number" && isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0;

// RESET PROGRESS in the game wipes the player locally; without this the board
// would keep ranking a score they no longer have. Identity is checked the same
// way as a submit, so one player can only erase themselves.
export async function DELETE(request: Request): Promise<Response> {
  let initData = "";
  try {
    initData = ((await request.json()) as { initData?: string }).initData ?? "";
  } catch {
    return json({ error: "bad json" }, { status: 400 });
  }
  const user = verifyInitData(initData);
  if (!user) return json({ error: "unverified" }, { status: 401 });
  const uid = String(user.id);
  if (!(await rateLimit().limit(uid)).success) return json({ error: "slow down" }, { status: 429 });

  const pipe = db().pipeline();
  pipe.zrem(BEST, uid);
  pipe.zrem(TOTAL, uid);
  pipe.del(player(uid));
  await pipe.exec();
  // stat:runs is history — how much the game has been played does not become
  // untrue because one player started over.
  return json({ ok: true });
}

export async function POST(request: Request): Promise<Response> {
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return json({ error: "bad json" }, { status: 400 });
  }

  // Attribution: one INCR per open, keyed by the link it came from. Deliberately
  // unauthenticated — web visitors have no initData — so it is a private
  // counter for deciding where to spend promo effort, never a trusted number.
  if (typeof body.hit === "string") {
    if (/^[a-z0-9_-]{1,32}$/.test(body.hit)) await db().incr(`stat:src:${body.hit}`);
    return json({ ok: true });
  }

  const user = verifyInitData(body.initData ?? "");
  if (!user) return json({ error: "unverified" }, { status: 401 });
  const uid = String(user.id);

  if (!(await rateLimit().limit(uid)).success) return json({ error: "slow down" }, { status: 429 });

  if (body.boot) {
    // An invite counts only for a player with no profile yet: a veteran opening
    // a friend's link is not a new player, and HSETNX makes even a real one
    // count once. Self-invites are just ignored.
    let welcome = 0;
    const by = typeof body.ref === "string" && /^\d{1,20}$/.test(body.ref) ? body.ref : null;
    if (by && by !== uid && !(await db().exists(player(uid)))) {
      if (await db().hsetnx(referral(uid), "by", by)) welcome = CONFIG.refReward;
    }
    const [paid, invited] = await Promise.all([db().getdel<number>(refPending(uid)), db().scard(refKids(uid))]);
    return json({ ok: true, welcome, paid: Number(paid ?? 0), invited: Number(invited ?? 0) });
  }

  const claimed = num(body.score, 1e9);
  const best = Number((await db().zscore(BEST, uid)) ?? 0);

  // Above your own proven best, a proof is required — and a fresh player's
  // best is 0, so the very first ranking run is verified like any other.
  let verified = 0;
  if (claimed > best) {
    const proofs = Array.isArray(body.proofs) ? body.proofs.slice(0, MAX_SEGMENTS) : null;
    if (!proofs?.length) return json({ needProof: true }, { status: 200 });

    // More than one segment means the run was continued, and a continue is
    // something you buy. Checked BEFORE replaying: without the ledger the
    // recount would be decorative, since anyone can send a dozen segments.
    const extra = proofs.length - 1;
    if (extra > 0 && (await entitlements(uid)).revives < extra) {
      return json({ error: "unpaid continues" }, { status: 402 });
    }

    let sum = 0;
    for (const p of proofs) {
      const r = replayScore(p);
      if (!r) return json({ error: "bad proof" }, { status: 400 });
      sum += r.score;
    }
    if (sum !== claimed) return json({ error: "proof does not match", scored: sum }, { status: 409 });

    // Spent only now, when the run is actually being accepted, so a rejected
    // submission never costs the player a continue they paid for.
    if (!(await spendRevives(uid, extra))) return json({ error: "unpaid continues" }, { status: 402 });
    verified = sum;
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
  const res = (await pipe.exec()) as unknown[];

  // First run ever (res[1] is the HINCRBY above): the inviter has earned their
  // half. The paid flag is set once per account, so wiping progress and playing
  // again does not pay them twice.
  if (Number(res[1]) === 1) {
    const by = await db().hget<string>(referral(uid), "by");
    if (by && (await db().hsetnx(referral(uid), "paid", "1"))) {
      await Promise.all([db().incrby(refPending(by), CONFIG.refReward), db().sadd(refKids(by), uid)]);
    }
  }

  const [rank, total] = await Promise.all([db().zrevrank(BEST, uid), db().zscore(TOTAL, uid)]);
  return json({
    ok: true,
    verified: verified > 0,
    best: Math.max(best, verified),
    total: Number(total ?? 0),
    rank: rank === null ? null : Number(rank) + 1,
  });
}
