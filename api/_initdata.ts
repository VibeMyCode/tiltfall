// Telegram identity, shared by every endpoint that needs to know who is
// calling. One copy on purpose: this is the line between "a player" and
// "anyone with a URL", and two implementations of it would drift apart.
//
// The leading underscore keeps Vercel from treating this as an endpoint.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

// Telegram signs initData with a key derived from the bot token. Verifying it
// is the only thing standing between the board and anyone claiming any id.
export function verifyInitData(initData: string): TgUser | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || typeof initData !== "string" || initData.length > 4096) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // Telegram signs the fields sorted by key, one "k=v" per line.
  const check = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const mine = createHmac("sha256", secret).update(check).digest();
  // Buffer.from(..., "hex") silently drops anything that is not hex rather than
  // throwing, so a short or malformed hash has to be rejected by shape first.
  if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
  if (!timingSafeEqual(mine, Buffer.from(hash, "hex"))) return null;

  // A signature stays valid forever, so freshness is what stops a captured
  // initData being replayed months later.
  const authDate = Number(params.get("auth_date"));
  if (!isFinite(authDate) || Date.now() / 1000 - authDate > 86_400) return null;

  try {
    const u = JSON.parse(params.get("user") ?? "null") as TgUser | null;
    return u && typeof u.id === "number" ? u : null;
  } catch {
    return null;
  }
}

