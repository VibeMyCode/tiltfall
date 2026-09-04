// The one Redis client, and the ledger of what a player has paid for.
//
// Entitlements live HERE and not on the client. A purchase that only the
// browser knows about can be granted by anyone who opens devtools, and the
// leaderboard verifies runs by replaying them — a paid continue that the server
// cannot confirm would make that verification meaningless.
//
// The leading underscore keeps Vercel from treating this as an endpoint.
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Lazy: module bodies run at build time too, where Redis.fromEnv() would throw
// for want of credentials that are not there yet.
let _redis: Redis | null = null;
export const db = (): Redis => (_redis ??= Redis.fromEnv());

let _limiter: Ratelimit | null = null;
export const rateLimit = (): Ratelimit =>
  (_limiter ??= new Ratelimit({
    redis: db(),
    // A run takes tens of seconds, so this is generous for a player and still
    // caps a script hammering the endpoint.
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    prefix: "rl",
  }));

const wallet = (uid: string) => `pay:${uid}`;
const unlocks = (uid: string) => `unlocked:${uid}`;

export interface Entitlements {
  revives: number; // unspent continues, bought at escalating prices
  once: Record<string, number>; // booster id -> unspent single uses
  rerolls: number;
  unlocked: string[]; // boosters opened with Stars rather than levels
}

export async function entitlements(uid: string): Promise<Entitlements> {
  const [h, u] = await Promise.all([
    db().hgetall<Record<string, string>>(wallet(uid)),
    db().smembers(unlocks(uid)),
  ]);
  const once: Record<string, number> = {};
  for (const [k, v] of Object.entries(h ?? {})) {
    if (k.startsWith("once:")) once[k.slice(5)] = Number(v) || 0;
  }
  return {
    revives: Number(h?.revives ?? 0),
    once,
    rerolls: Number(h?.reroll ?? 0),
    unlocked: (u ?? []).map(String),
  };
}

/**
 * Records a paid purchase. Telegram can redeliver an update, so the charge id
 * is claimed first and the credit only happens for the caller that won it —
 * paying once must never grant twice.
 * Returns false when this charge was already banked.
 */
export async function credit(
  uid: string,
  product: string,
  choice: string | undefined,
  chargeId: string,
): Promise<boolean> {
  // What the charge bought is stored with it, so a refund can undo precisely
  // this and nothing else.
  const fresh = await db().set(
    `charge:${chargeId}`,
    JSON.stringify({ uid, product, choice }),
    { nx: true, ex: 60 * 60 * 24 * 365 },
  );
  if (!fresh) return false;
  await grant(uid, product, choice, 1);
  return true;
}

/**
 * Undoes a refunded charge. Telegram lets a buyer get their Stars back — and
 * lets the bot hand them back, which is how you test without spending — so
 * without this, buy-and-refund would be a way to keep the goods for free.
 * Idempotent: the charge record is deleted, so a redelivered refund is a no-op.
 */
export async function revoke(chargeId: string): Promise<boolean> {
  const raw = await db().get<string | { uid: string; product: string; choice?: string }>(`charge:${chargeId}`);
  if (!raw) return false;
  const rec = typeof raw === "string" ? (JSON.parse(raw) as { uid: string; product: string; choice?: string }) : raw;
  await db().del(`charge:${chargeId}`);
  await grant(rec.uid, rec.product, rec.choice, -1);
  return true;
}

// Applies a purchase, or takes it back when n is negative. Counters are held at
// zero: a refund must not leave a debt that a later honest purchase pays off.
async function grant(uid: string, product: string, choice: string | undefined, n: 1 | -1): Promise<void> {
  const bump = async (field: string) => {
    const left = await db().hincrby(wallet(uid), field, n);
    if (left < 0) await db().hset(wallet(uid), { [field]: 0 });
  };
  if (product.startsWith("revive")) await bump("revives");
  else if (product === "daily_reroll") await bump("reroll");
  else if (product === "booster_once" && choice) await bump(`once:${choice}`);
  else if (product === "booster_unlock" && choice) {
    if (n > 0) await db().sadd(unlocks(uid), choice);
    else await db().srem(unlocks(uid), choice);
  }
}

/**
 * Consumes n paid continues at once, when a submitted run turns out to have
 * been carried on that many times. Refuses rather than going negative.
 */
export async function spendRevives(uid: string, n: number): Promise<boolean> {
  if (n <= 0) return true;
  const left = await db().hincrby(wallet(uid), "revives", -n);
  if (left >= 0) return true;
  await db().hincrby(wallet(uid), "revives", n);
  return false;
}

/**
 * Consumes one unspent credit. Returns false if there was none, so a caller
 * cannot spend what was never bought.
 */
export async function spend(uid: string, field: string): Promise<boolean> {
  const left = await db().hincrby(wallet(uid), field, -1);
  if (left >= 0) return true;
  await db().hincrby(wallet(uid), field, 1); // put the borrow back
  return false;
}
