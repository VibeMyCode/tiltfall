// Client half of Stars payments. Asks the server for an invoice — the server
// prices it from the catalogue — then hands the link to Telegram and reports
// whether the money actually moved.
import { initDataRaw, payWithStars, type PayOutcome } from "./telegram.js";
import { revivePrice, type ProductId } from "./products.js";

const API = "/api/pay";

export interface Entitlements {
  revives: number;
  once: Record<string, number>;
  rerolls: number;
  unlocked: string[];
  skins: string[];
  gifts: Gift[];
}

export interface Gift {
  code: string;
  product: string;
  choice?: string;
  to?: string; // set once a friend has redeemed it
}

// Why the last purchase did not happen, in words a player can act on. A failed
// buy used to restore the button and say nothing, which is indistinguishable
// from a dead button — and is how a broken skin purchase went unreported.
let lastError: string | null = null;
export const payError = (): string | null => lastError;

async function post(body: unknown): Promise<Record<string, unknown> | null> {
  lastError = null;
  const initData = initDataRaw();
  if (!initData) {
    lastError = "Open TILTFALL inside Telegram to pay.";
    return null;
  }
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(body as object), initData }),
    });
    const out = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    if (!r.ok || !out) {
      const why = typeof out?.error === "string" ? `: ${out.error}` : "";
      lastError = `The store answered ${r.status}${why}.`;
      return null;
    }
    return out;
  } catch {
    lastError = "Could not reach the store.";
    return null;
  }
}

/** Turns Telegram's answer into something worth showing, or null when there is
 *  nothing to apologise for. */
export function describeOutcome(o: PayOutcome): string | null {
  switch (o) {
    case "paid":
    case "cancelled":
      return null; // paid, or changed their mind — neither needs a message
    case "pending":
      return "Telegram is still processing the payment.";
    case "unsupported":
      return "This Telegram version cannot open payments — update the app.";
    case "silent":
      return "Telegram never answered. Nothing was charged.";
    default:
      return "Telegram could not complete the payment.";
  }
}

export const starsAvailable = (): boolean => Boolean(initDataRaw());

/** Price of the nth continue in a run — shown on the button before buying. */
export const reviveStars = (n: number): number => revivePrice(n).stars;

/**
 * Buys something and resolves true only once Telegram reports it paid. The
 * server has already banked the entitlement by then, via the webhook.
 */
export async function buy(
  product: ProductId,
  opts: { choice?: string; reviveN?: number; gift?: boolean } = {},
): Promise<boolean> {
  const res = await post({ action: "invoice", product, ...opts });
  const link = typeof res?.link === "string" ? res.link : null;
  if (!link) {
    lastError ??= "The store did not hand back an invoice.";
    return false;
  }
  const outcome = await payWithStars(link);
  lastError = describeOutcome(outcome);
  return outcome === "paid";
}

/** Redeems a gift code. Null when it was already taken, or never existed. */
export async function claimGift(code: string): Promise<Gift | null> {
  const res = await post({ action: "claim", code });
  const g = res?.claimed as Gift | undefined;
  return g?.product ? g : null;
}

export async function fetchEntitlements(): Promise<Entitlements | null> {
  const res = await post({ action: "entitlements" });
  return res && typeof res.revives === "number" ? (res as unknown as Entitlements) : null;
}
