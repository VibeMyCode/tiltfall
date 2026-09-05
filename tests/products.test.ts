// The catalogue is the only place a price may come from, and the payload is
// attacker-reachable: it is written by us but returns through a client.
import { describe, expect, it } from "vitest";
import { PRODUCTS, reviveProduct, revivePrice } from "../src/products.js";
import { parsePayload } from "../api/telegram.js";
import { encodePayload } from "../api/pay.js";
import { giftCode } from "../api/_store.js";

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

  it("names the same product the price came from", () => {
    // The button quotes revivePrice and the invoice is bought by reviveProduct.
    // If these ever disagree, a player is shown one number and charged another.
    for (const n of [0, 1, 2, 3, 4, 99]) {
      expect(PRODUCTS[reviveProduct(n)].stars).toBe(revivePrice(n).stars);
    }
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

describe("gifts", () => {
  it("carries the gift flag through Telegram and back", () => {
    // The flag rides the invoice payload, so a purchase that was meant for a
    // friend must not come back looking like one for the buyer.
    const raw = encodePayload("777", "skin_legendary", "legend_sharingan_4", true);
    expect(parsePayload(raw)).toEqual({ u: "777", p: "skin_legendary", c: "legend_sharingan_4", g: 1 });
    expect(parsePayload(encodePayload("777", "skin_common", "com_polka_dots"))?.g).toBeUndefined();
    // Telegram caps the payload at 128 bytes.
    expect(raw.length).toBeLessThanOrEqual(128);
  });

  it("mints the same code for the same charge, and only startapp-safe ones", () => {
    // Telegram redelivers updates, so a code derived from the charge is what
    // stops one payment minting two gifts. The shape has to satisfy both the
    // server's own check and startapp, which allows only A-Z a-z 0-9 _ -.
    expect(giftCode("stars_abc")).toBe(giftCode("stars_abc"));
    expect(giftCode("stars_abc")).not.toBe(giftCode("stars_abd"));
    expect(giftCode("stars_abc")).toMatch(/^[0-9a-f]{16}$/);
  });
});
