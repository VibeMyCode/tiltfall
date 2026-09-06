// Telegram webhook. Two jobs, and the second is why it had to come back:
//
//  - /start and /play answer with a button that opens the game, for anyone who
//    lands in the bot chat instead of the Mini App.
//  - Stars payments. Telegram will not complete a purchase unless the bot
//    answers pre_checkout_query within ten seconds, and successful_payment is
//    the only trustworthy word that money changed hands. Both arrive here.
import { credit, revoke } from "./_store.js";
import { PRODUCTS } from "../src/products.js";

const WEB_APP = "https://tiltfall.netlify.app/";
const MINI_APP = "https://t.me/tiltfall_bot/play";

// Matches /start and /play, with or without the @botname suffix Telegram adds
// in groups, and with or without deep-link payload after it.
export const isLaunchCommand = (text: string): boolean => /^\/(start|play)(@\w+)?(\s|$)/.test(text);

interface Payload {
  u?: string;
  p?: string;
  c?: string;
  g?: number; // bought as a gift: mints a code rather than granting to the buyer
}

export function parsePayload(raw: unknown): Payload | null {
  if (typeof raw !== "string" || raw.length > 256) return null;
  try {
    const v = JSON.parse(raw) as Payload;
    return v && typeof v.u === "string" && typeof v.p === "string" ? v : null;
  } catch {
    return null;
  }
}

const api = (method: string, body: unknown): Promise<unknown> =>
  fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);

export async function POST(request: Request): Promise<Response> {
  // Telegram echoes this header on every delivery. Without the check, anyone
  // who guesses the URL could puppet the bot — including approving their own
  // checkouts. Unset secret => nothing matches => closed, which is the right
  // way to fail.
  if (request.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  // Any non-200 makes Telegram redeliver the same update, so every path below
  // returns 200 — an update we cannot use is handled by ignoring it.
  const update = (await request.json().catch(() => null)) as Record<string, any> | null;
  if (!update) return new Response("ok");

  // --- checkout --------------------------------------------------------------
  // Ten seconds, and a silent bot means the purchase simply fails. Approve only
  // what the catalogue actually sells; the payload was written by us, but it
  // came back through a client, so it is checked like anything else.
  const pre = update.preCheckoutQuery ?? update.pre_checkout_query;
  if (pre?.id) {
    const p = parsePayload(pre.invoice_payload);
    const known = p?.p && (p.p in PRODUCTS || p.p.startsWith("revive"));
    await api("answerPreCheckoutQuery", {
      pre_checkout_query_id: pre.id,
      ok: Boolean(known),
      ...(known ? {} : { error_message: "This item is no longer available." }),
    });
    return new Response("ok");
  }

  const msg = update.message;

  // --- payment landed --------------------------------------------------------
  const paid = msg?.successful_payment;
  if (paid) {
    const p = parsePayload(paid.invoice_payload);
    const buyer = String(msg.from?.id ?? "");
    // The payload names the buyer, but the message says who actually paid. If
    // they disagree, believe the message: the payload rode through a client.
    if (p?.p && buyer && paid.telegram_payment_charge_id) {
      await credit(buyer, p.p, p.c, String(paid.telegram_payment_charge_id), p.g === 1);
    }
    return new Response("ok");
  }

  // --- money went back -------------------------------------------------------
  // A refund arrives as a service message. Telegram lets the buyer claw Stars
  // back and lets the bot return them, so goods bought and then refunded have
  // to go back too — otherwise the pair is a way to keep them for nothing.
  const refunded = msg?.refunded_payment;
  if (refunded?.telegram_payment_charge_id) {
    await revoke(String(refunded.telegram_payment_charge_id));
    return new Response("ok");
  }

  // --- the way in ------------------------------------------------------------
  if (!msg?.chat?.id || !isLaunchCommand(msg.text ?? "")) return new Response("ok");

  // web_app buttons are private-chat only; groups get a plain link instead.
  const button =
    msg.chat.type === "private"
      ? { text: "▶  PLAY TILTFALL", web_app: { url: WEB_APP } }
      : { text: "▶  PLAY TILTFALL", url: MINI_APP };

  await api("sendMessage", {
    chat_id: msg.chat.id,
    text: "Steer a falling ball down an endless tower. Smash blocks for combos, dodge the mines, ride boosters deeper through five shifting biomes.",
    reply_markup: { inline_keyboard: [[button]] },
  });

  return new Response("ok");
}
