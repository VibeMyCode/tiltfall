// Telegram Stars: hands the client an invoice link, and tells it what it has
// already paid for.
//
// The price comes from the catalogue in src/products.ts, never from the
// request. A client that could name its own price would be a client that pays
// one Star for anything.
import { verifyInitData } from "./_initdata.js";
import { claimGift, entitlements, rateLimit } from "./_store.js";
import { BOOSTER_ORDER } from "../src/boosters.js";
import { PRODUCTS, revivePrice, skinProduct, type Product, type ProductId } from "../src/products.js";
import { SHOP_SKINS } from "../src/skins.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Body {
  initData?: string;
  action?: "invoice" | "entitlements" | "claim";
  product?: ProductId;
  choice?: string; // which booster, for the products that need one
  reviveN?: number; // which continue this is within the run — sets the price
  gift?: boolean; // bought for somebody else: mints a code instead of goods
  code?: string; // the gift being redeemed
}

// The payload rides through Telegram and comes back on successful_payment.
// Telegram caps it at 128 bytes, so it stays terse.
export const encodePayload = (uid: string, product: string, choice?: string, gift?: boolean): string =>
  JSON.stringify({ u: uid, p: product, ...(choice ? { c: choice } : {}), ...(gift ? { g: 1 } : {}) });

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const user = verifyInitData(body.initData ?? "");
  if (!user) return json({ error: "unverified" }, 401);
  const uid = String(user.id);

  if (!(await rateLimit().limit(`pay:${uid}`)).success) return json({ error: "slow down" }, 429);

  if (body.action === "entitlements") return json(await entitlements(uid));

  // --- redeeming a gift ------------------------------------------------------
  if (body.action === "claim") {
    const code = String(body.code ?? "");
    if (!/^[0-9a-f]{16}$/.test(code)) return json({ error: "bad code" }, 400);
    const g = await claimGift(code, uid);
    return g ? json({ claimed: g }) : json({ error: "already claimed" }, 409);
  }

  // --- invoice ---------------------------------------------------------------
  let product: Product | undefined;
  if (body.product === "revive1" || body.product === "revive2" || body.product === "revive3") {
    // The client says which continue this is; the ladder decides the price, so
    // asking for the cheap rung on a third continue buys the third rung.
    product = revivePrice(Math.max(1, Math.floor(Number(body.reviveN) || 1)));
  } else if (body.product && PRODUCTS[body.product]) {
    product = PRODUCTS[body.product];
  }
  if (!product) return json({ error: "no such product" }, 400);

  // A choice is only a choice among things that exist.
  let choice: string | undefined;
  if (product.needsChoice === "booster") {
    choice = String(body.choice ?? "");
    if (!(BOOSTER_ORDER as readonly string[]).includes(choice)) {
      return json({ error: "no such booster" }, 400);
    }
  } else if (product.needsChoice === "skin") {
    choice = String(body.choice ?? "");
    // The rarity has to match the product, or the cheap invoice would buy the
    // dear skin.
    if (!SHOP_SKINS.includes(choice) || skinProduct(choice) !== product.id) {
      return json({ error: "no such skin" }, 400);
    }
  }

  // A continue is consumed by the run that is happening right now, so there is
  // nobody else it could be for.
  const gift = body.gift === true && !product.id.startsWith("revive");

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return json({ error: "payments unavailable" }, 503);

  const r = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: gift ? `Gift: ${product.title}` : product.title,
      description: (choice ? `${product.desc} — ${choice.toUpperCase()}` : product.desc) + (gift ? " — for a friend" : ""),
      payload: encodePayload(uid, product.id, choice, gift),
      // XTR is Stars. It takes no provider token, and the amount is a count of
      // Stars rather than the usual minor currency units.
      currency: "XTR",
      prices: [{ label: product.title, amount: product.stars }],
    }),
  }).catch(() => null);

  const out = (await r?.json().catch(() => null)) as { ok?: boolean; result?: string } | null;
  if (!out?.ok || !out.result) return json({ error: "invoice failed" }, 502);
  return json({ link: out.result, stars: product.stars, product: product.id, gift });
}
