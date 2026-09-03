import { describe, expect, it } from "vitest";
import { REV_KEY, SYNCED_KEYS, adoptIfNewer, type KeyStore } from "../src/sync.js";

function fakeStore(): KeyStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const snapshot = (bank: string) => [bank, "7", "{}", '{"score":900,"depth":11}', '"galaxy"', "null"];

describe("cross-device sync", () => {
  it("adopts a newer cloud state whole", () => {
    const s = fakeStore();
    expect(adoptIfNewer(s, 4, 9, snapshot("5000"))).toBe(true);
    expect(s.data["tf.bank"]).toBe("5000");
    expect(s.data["tf.level"]).toBe("7");
    expect(s.data["tf.skin"]).toBe('"galaxy"');
    // Recorded before the caller reloads, so the next boot sees equal revs.
    expect(s.data[REV_KEY]).toBe("9");
  });

  it("leaves an older or equal cloud alone", () => {
    for (const cloudRev of [0, 4, 3]) {
      const s = fakeStore();
      expect(adoptIfNewer(s, 4, cloudRev, snapshot("5000"))).toBe(false);
      expect(Object.keys(s.data)).toEqual([]);
    }
  });

  it("cannot loop: after adopting, the same snapshot is a no-op", () => {
    const s = fakeStore();
    expect(adoptIfNewer(s, 4, 9, snapshot("5000"))).toBe(true);
    const revNow = Number(s.data[REV_KEY]);
    expect(adoptIfNewer(s, revNow, 9, snapshot("5000"))).toBe(false);
  });

  it("propagates a reset by clearing the keys the cloud cleared", () => {
    // What RESET PROGRESS on the other device leaves behind: empty values and a
    // bumped rev. Dropping the keys here restores the defaults, which is the
    // reset arriving.
    const s = fakeStore();
    s.data["tf.bank"] = "9999";
    s.data["tf.level"] = "12";
    expect(adoptIfNewer(s, 4, 9, SYNCED_KEYS.map(() => ""))).toBe(true);
    expect(s.data["tf.bank"]).toBeUndefined();
    expect(s.data["tf.level"]).toBeUndefined();
    expect(s.data[REV_KEY]).toBe("9");
  });

  it("ignores a cloud revision that is not a number", () => {
    for (const junk of [null, "", "abc", undefined, NaN]) {
      const s = fakeStore();
      expect(adoptIfNewer(s, 0, junk, snapshot("5000"))).toBe(false);
    }
  });
});
