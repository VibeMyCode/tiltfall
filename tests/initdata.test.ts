// Everything the leaderboard believes about WHO submitted a run rests on this
// one function, so it is tested for what it must refuse, not just what it
// accepts.
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

const TOKEN = "8232158531:TEST_TOKEN_NOT_A_REAL_ONE_0000000000";

// Builds initData the way Telegram does: fields sorted, one "k=v" per line,
// signed with a key derived from the bot token.
function sign(fields: Record<string, string>, token = TOKEN): string {
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}

const fresh = () => ({
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: "AAF",
  user: JSON.stringify({ id: 777, first_name: "Andrei" }),
});

let verifyInitData: (s: string) => { id: number; first_name?: string } | null;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  ({ verifyInitData } = await import("../api/_initdata"));
});

describe("initData verification", () => {
  it("accepts a signature made with the real bot token", () => {
    const u = verifyInitData(sign(fresh()));
    expect(u).not.toBeNull();
    expect(u!.id).toBe(777);
    expect(u!.first_name).toBe("Andrei");
  });

  it("refuses a body edited after signing", () => {
    // The exact attack the signature exists for: keep the hash, swap the user.
    const good = sign(fresh());
    const p = new URLSearchParams(good);
    p.set("user", JSON.stringify({ id: 999, first_name: "Someone Else" }));
    expect(verifyInitData(p.toString())).toBeNull();
  });

  it("refuses a signature from a different bot token", () => {
    expect(verifyInitData(sign(fresh(), "9999999999:SOME_OTHER_BOT_TOKEN_00000000000000"))).toBeNull();
  });

  it("refuses stale initData, so a captured one cannot be replayed forever", () => {
    const old = { ...fresh(), auth_date: String(Math.floor(Date.now() / 1000) - 90_000) };
    expect(verifyInitData(sign(old))).toBeNull();
  });

  it("refuses missing and malformed hashes", () => {
    const p = new URLSearchParams(sign(fresh()));
    p.delete("hash");
    expect(verifyInitData(p.toString())).toBeNull();

    // Buffer.from(_, "hex") drops non-hex silently, so a truncated hash must be
    // caught by shape rather than by comparison.
    for (const bad of ["", "zz", "00", "not-hex-at-all", "a".repeat(63), "a".repeat(65)]) {
      const q = new URLSearchParams(sign(fresh()));
      q.set("hash", bad);
      expect(verifyInitData(q.toString())).toBeNull();
    }
  });

  it("refuses junk instead of throwing on it", () => {
    for (const bad of ["", "&&&", "hash=", "x".repeat(5000)]) {
      expect(verifyInitData(bad)).toBeNull();
    }
  });
});
