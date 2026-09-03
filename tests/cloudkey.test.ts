// Telegram accepts only A-Z, a-z, 0-9, _ and - in a CloudStorage key, 1-128
// characters. Our keys are dotted ("tf.bank"), every write was rejected, and
// because setItem reports through its callback rather than by throwing, the
// failure was invisible: cross-device sync never worked and nothing said so.
import { describe, expect, it } from "vitest";
import { cloudKey } from "../src/telegram.js";
import { REV_KEY, SYNCED_KEYS } from "../src/sync.js";

const VALID = /^[A-Za-z0-9_-]{1,128}$/;

describe("cloud keys", () => {
  it("every key the game actually stores is one Telegram accepts", () => {
    for (const k of [...SYNCED_KEYS, REV_KEY, "tf.probe"]) {
      expect(cloudKey(k)).toMatch(VALID);
    }
  });

  it("maps distinct keys to distinct names", () => {
    const mapped = SYNCED_KEYS.map(cloudKey);
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it("replaces what is not allowed and caps the length", () => {
    expect(cloudKey("tf.bank")).toBe("tf_bank");
    expect(cloudKey("a b/c:d")).toMatch(VALID);
    expect(cloudKey("x".repeat(300))).toHaveLength(128);
  });
});
