// Client half of Stars payments. Asks the server for an invoice — the server
// prices it from the catalogue — then hands the link to Telegram and reports
// whether the money actually moved.
import { initDataRaw, payWithStars } from "./telegram.js";
import { revivePrice, type ProductId } from "./products.js";

const API = "/api/pay";

export interface Entitlements {
  revives: number;
  once: Record<string, number>;
  rerolls: number;
  unlocked: string[];
}

async function post(body: unknown): Promise<Record<string, unknown> | null> {
  const initData = initDataRaw();
  if (!initData) return null; // outside Telegram there is nobody to charge
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(body as object), initData }),
    });
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const starsAvailable = (): boolean => Boolean(initDataRaw());

/** Price of the nth continue in a run — shown on the button before buying. */
export const reviveStars = (n: number): number => revivePrice(n).stars;

/**
 * Buys something and resolves true only once Telegram reports it paid. The
 * server has already banked the entitlement by then, via the webhook.
 */
export async function buy(product: ProductId, opts: { choice?: string; reviveN?: number } = {}): Promise<boolean> {
  const res = await post({ action: "invoice", product, ...opts });
  const link = typeof res?.link === "string" ? res.link : null;
  return link ? payWithStars(link) : false;
}

export async function fetchEntitlements(): Promise<Entitlements | null> {
  const res = await post({ action: "entitlements" });
  return res && typeof res.revives === "number" ? (res as unknown as Entitlements) : null;
}
