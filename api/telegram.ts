// Telegram webhook — the only server-side piece of TILTFALL. It exists so that
// someone who lands in the bot chat instead of the Mini App has a way in:
// /start and /play answer with a button that opens the game. Nothing else is
// handled, and no state is kept.
const WEB_APP = "https://tiltfall.vercel.app/";
const MINI_APP = "https://t.me/tiltfall_bot/play";

// Matches /start and /play, with or without the @botname suffix Telegram adds
// in groups, and with or without deep-link payload after it.
export const isLaunchCommand = (text: string): boolean => /^\/(start|play)(@\w+)?(\s|$)/.test(text);

export async function POST(request: Request): Promise<Response> {
  // Telegram echoes this header on every delivery. Without the check, anyone
  // who guesses the URL could puppet the bot. Unset secret => nothing matches
  // => closed, which is the right way to fail.
  if (request.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  // Any non-200 makes Telegram redeliver the same update, so every path below
  // returns 200 — an update we can't use is handled by ignoring it.
  const update = await request.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.chat?.id || !isLaunchCommand(msg.text ?? "")) return new Response("ok");

  // web_app buttons are private-chat only; groups get a plain link instead.
  const button =
    msg.chat.type === "private"
      ? { text: "▶  PLAY TILTFALL", web_app: { url: WEB_APP } }
      : { text: "▶  PLAY TILTFALL", url: MINI_APP };

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: msg.chat.id,
      text: "Steer a falling ball down an endless tower. Smash blocks for combos, dodge the mines, ride boosters deeper through five shifting biomes.",
      reply_markup: { inline_keyboard: [[button]] },
    }),
  });

  return new Response("ok");
}
