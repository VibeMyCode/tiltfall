// The catalogue is the only place a price may come from, and the payload is
// attacker-reachable: it is written by us but returns through a client.
import { describe, expect, it } from "vitest";
import { PRODUCTS, revivePrice } from "../src/products.js";
import { parsePayload } from "../api/telegram.js";

describe("catalogue", () => {
  it("prices everything, and never at zero", () => {
    for (const [id, p] of Object.entries(PRODUCTS)) {
      expect(p.id).toBe(id); // the key and the id cannot drift apart
      expect(p.stars).toBeGreaterThan(0);
      expect(Number.isInteger(p.stars)).toBe(true); // Stars are whole
    }
  });

  it("makes each continue inside a run dearer than the last", () => {
    // This is what keeps a place on the leaderboard from simply being for sale.
    expect(revivePrice(2).stars).toBeGreaterThan(revivePrice(1).stars);
    expect(revivePrice(3).stars).toBeGreaterThan(revivePrice(2).stars);
    // Past the third it stays at the top rung rather than growing forever.
    expect(revivePrice(9).stars).toBe(revivePrice(3).stars);
    // Asking for continue number zero must not buy the cheap one.
    expect(revivePrice(0).stars).toBe(revivePrice(1).stars);
  });
});

describe("payment payload", () => {
  it("accepts what we wrote", () => {
    expect(parsePayload('{"u":"777","p":"booster_once","c":"quake"}')).toEqual({
      u: "777",
      p: "booster_once",
      c: "quake",
    });
  });

  it("refuses anything else instead of throwing on it", () => {
    for (const bad of [
      null,
      42,
      "",
      "not json",
      "{}",
      '{"u":777,"p":"x"}', // uid must be a string
      '{"p":"x"}', // no buyer
      '"' + "x".repeat(400) + '"', // oversized
    ]) {
      expect(parsePayload(bad)).toBeNull();
    }
  });
});
