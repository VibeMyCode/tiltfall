// The one Redis client, and the ledger of what a player has paid for.
//
// Entitlements live HERE and not on the client. A purchase that only the
// browser knows about can be granted by anyone who opens devtools, and the
// leaderboard verifies runs by replaying them — a paid continue that the server
// cannot confirm would make that verification meaningless.
//
// The leading underscore keeps Vercel from treating this as an endpoint.
import { createHash } from "node:crypto";
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
const owned = (uid: string) => `skins:${uid}`;
const giftKey = (code: string) => `gift:${code}`;
const minted = (uid: string) => `gifts:${uid}`;

export interface Gift {
  code: string;
  product: string;
  choice?: string;
  to?: string; // who claimed it, absent while it is still unsent
}

// Derived from the charge rather than random, so a redelivered payment mints
// the SAME gift instead of a second one. Half a SHA-256 is short enough for a
// deep link and far too wide to guess.
export const giftCode = (chargeId: string): string => createHash("sha256").update(chargeId).digest("hex").slice(0, 16);

export interface Entitlements {
  revives: number; // unspent continues, bought at escalating prices
  once: Record<string, number>; // booster id -> unspent single uses
  rerolls: number;
  unlocked: string[]; // boosters opened with Stars rather than levels
  skins: string[]; // skins bought with Stars rather than levelled into
  gifts: Gift[]; // bought FOR someone else, so the buyer can send the link again
}

export async function entitlements(uid: string): Promise<Entitlements> {
  const [h, u, sk, codes] = await Promise.all([
    db().hgetall<Record<string, string>>(wallet(uid)),
    db().smembers(unlocks(uid)),
    db().smembers(owned(uid)),
    db().smembers(minted(uid)),
  ]);
  const gifts = (
    await Promise.all(
      (codes ?? []).map(async (code) => {
        const g = await db().hgetall<Record<string, string>>(giftKey(String(code)));
        const gift: Gift | null = g?.product
          ? { code: String(code), product: g.product, choice: g.choice, to: g.to }
          : null;
        return gift;
      }),
    )
  ).filter((g): g is Gift => g !== null);
  const once: Record<string, number> = {};
  for (const [k, v] of Object.entries(h ?? {})) {
    if (k.startsWith("once:")) once[k.slice(5)] = Number(v) || 0;
  }
  return {
    revives: Number(h?.revives ?? 0),
    once,
    rerolls: Number(h?.reroll ?? 0),
    unlocked: (u ?? []).map(String),
    skins: (sk ?? []).map(String),
    gifts,
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
  gift = false,
): Promise<boolean> {
  // What the charge bought is stored with it, so a refund can undo precisely
  // this and nothing else.
  const fresh = await db().set(
    `charge:${chargeId}`,
    JSON.stringify({ uid, product, choice, gift }),
    { nx: true, ex: 60 * 60 * 24 * 365 },
  );
  if (!fresh) return false;
  // A gift buys nothing for the buyer: it mints a code somebody else redeems.
  if (gift) {
    const code = giftCode(chargeId);
    await db().hset(giftKey(code), { product, from: uid, ...(choice ? { choice } : {}) });
    await db().sadd(minted(uid), code);
  } else {
    await grant(uid, product, choice, 1);
  }
  return true;
}

/**
 * Redeems a gift. The claim is a single HSETNX, so of two friends opening the
 * same link at once exactly one gets the goods — checking first and writing
 * after would hand it to both.
 * Returns what was granted, or null when the code is unknown or already taken.
 */
export async function claimGift(code: string, uid: string): Promise<Gift | null> {
  const rec = await db().hgetall<Record<string, string>>(giftKey(code));
  if (!rec?.product) return null;
  if (!(await db().hsetnx(giftKey(code), "to", uid))) return null;
  await grant(uid, rec.product, rec.choice, 1);
  return { code, product: rec.product, choice: rec.choice, to: uid };
}

/**
 * Undoes a refunded charge. Telegram lets a buyer get their Stars back — and
 * lets the bot hand them back, which is how you test without spending — so
 * without this, buy-and-refund would be a way to keep the goods for free.
 * Idempotent: the charge record is deleted, so a redelivered refund is a no-op.
 */
export async function revoke(chargeId: string): Promise<boolean> {
  type Charge = { uid: string; product: string; choice?: string; gift?: boolean };
  const raw = await db().get<string | Charge>(`charge:${chargeId}`);
  if (!raw) return false;
  const rec = typeof raw === "string" ? (JSON.parse(raw) as Charge) : raw;
  await db().del(`charge:${chargeId}`);
  if (rec.gift) {
    // Take it back from whoever redeemed it — otherwise buy, gift, refund is a
    // way to hand a friend something nobody paid for.
    const code = giftCode(chargeId);
    const g = await db().hgetall<Record<string, string>>(giftKey(code));
    if (g?.to) await grant(g.to, rec.product, rec.choice, -1);
    await db().del(giftKey(code));
    await db().srem(minted(rec.uid), code);
  } else {
    await grant(rec.uid, rec.product, rec.choice, -1);
  }
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
  } else if (product.startsWith("skin_") && choice) {
    if (n > 0) await db().sadd(owned(uid), choice);
    else await db().srem(owned(uid), choice);
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
