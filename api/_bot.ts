// The one place that calls the Bot API with the token. Returns Telegram's
// `result` or null: every caller treats Telegram being down as best-effort.
//
// The leading underscore keeps this from becoming an endpoint.
export const WEB_APP = "https://tiltfall.netlify.app/";

export async function botApi<T = unknown>(method: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { ok?: boolean; result?: T };
    return j.ok ? (j.result ?? null) : null;
  } catch {
    return null;
  }
}
