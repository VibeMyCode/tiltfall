// The skin table is edited by hand and read by the shop, and a row that
// silently disappears takes a purchasable item with it — which is exactly what
// happened once, when an edit to the eye skins cut the five rare ones off the
// end of the table and nothing failed.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RARITY_STARS, SHOP_SKINS, SKINS, skinStars, type Rarity } from "../src/skins.js";
import { PRODUCTS, skinProduct } from "../src/products.js";

const countBy = (r: Rarity) => SHOP_SKINS.filter((id) => SKINS[id].rarity === r).length;

describe("skin shop", () => {
  it("still has every rarity stocked", () => {
    expect(countBy("common")).toBe(5);
    expect(countBy("rare")).toBe(5);
    expect(countBy("epic")).toBe(5);
    expect(countBy("legendary")).toBe(9);
    expect(SHOP_SKINS).toHaveLength(24);
  });

  it("prices every skin from its rarity, and dearer as it gets rarer", () => {
    expect(RARITY_STARS.common).toBeLessThan(RARITY_STARS.rare);
    expect(RARITY_STARS.rare).toBeLessThan(RARITY_STARS.epic);
    expect(RARITY_STARS.epic).toBeLessThan(RARITY_STARS.legendary);
    for (const id of SHOP_SKINS) {
      const product = skinProduct(id);
      expect(product).not.toBeNull();
      // The button quotes skinStars and the invoice is priced from the
      // product: if these disagree, a player is shown one number and charged
      // another.
      expect(PRODUCTS[product!].stars).toBe(skinStars(id));
    }
  });

  it("is not selling anything the levels hand out free", () => {
    for (const [id, def] of Object.entries(SKINS)) {
      // A skin draws itself or names a file, never both, and only the ones
      // with a rarity are for sale.
      expect(Boolean(def.image) && Boolean(def.pattern)).toBe(false);
      expect(SHOP_SKINS.includes(id)).toBe(Boolean(def.rarity));
    }
  });

  it("only marks the pole-composed skins polar", () => {
    // A polar preview puts the pole facing the viewer, where every texture
    // column converges — right for the eyes, whose bands ARE latitude rings,
    // and the worst possible view of anything painted flat.
    const polar = Object.entries(SKINS).filter(([, d]) => d.polar);
    expect(polar.map(([id]) => id).sort()).toEqual([
      "legend_byakugan",
      "legend_rinnegan",
      "legend_sage",
      "legend_sharingan_4",
    ]);
    for (const [id, def] of polar) expect(Boolean(def.image), `${id} is painted`).toBe(false);
  });

  it("ships the file every painted skin names", () => {
    for (const id of SHOP_SKINS) {
      const img = SKINS[id].image;
      if (!img) continue;
      expect(existsSync(`public/skins/${img}.jpg`), `${id} master`).toBe(true);
      expect(existsSync(`public/skins/t/${img}.jpg`), `${id} thumb`).toBe(true);
    }
  });
});
