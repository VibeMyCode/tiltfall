// The one place that calls the Bot API with the token. Returns Telegram's
// `result` or null: every caller treats Telegram being down as best-effort.
//
// The leading underscore keeps this from becoming an endpoint.
export const WEB_APP = "https://tiltfall.com/";

// Why the last call failed. Returning a bare null lost the one sentence that
// says WHICH of "bad token", "wrong URL" or "chat blocked" it was, and a bot
// that answers nothing looks identical in all three cases.
let lastError: string | null = null;
export const botError = (): string | null => lastError;

export async function botApi<T = unknown>(method: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { ok?: boolean; result?: T; description?: string };
    if (!j.ok) {
      lastError = `${method}: ${j.description ?? `http ${r.status}`}`;
      return null;
    }
    return j.result ?? null;
  } catch (e) {
    lastError = `${method}: ${String(e)}`;
    return null;
  }
}
