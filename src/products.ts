// What can be bought for Telegram Stars, as plain data shared by the client and
// the server. The client shows it; the server prices the invoice from THIS
// table and never from the request, so a forged price is not a thing that can
// be sent.
//
// Prices are in Stars. At the current rate 100 Stars is about $1.33, so a Star
// is roughly 1.3 cents, and the ladder below is set for a game nobody has heard
// of yet: the first purchase has to be small enough not to be a decision.
import { RARITY_STARS, SKINS } from "./skins.js";

export type ProductId =
  | "skin_common"
  | "skin_rare"
  | "skin_epic"
  | "skin_legendary"
  | "revive1"
  | "revive2"
  | "revive3"
  | "booster_once"
  | "booster_unlock"
  | "daily_reroll";

export interface Product {
  id: ProductId;
  stars: number;
  title: string;
  desc: string;
  // A payload the buyer chooses (which booster, which skin). Validated by the
  // server against what the product allows — never trusted as given.
  needsChoice?: "booster" | "skin";
}

export const PRODUCTS: Record<ProductId, Product> = {
  // Reviving gets dearer each time inside one run. That is fairer than a flat
  // price, and it is also what stops a place on the leaderboard from simply
  // being for sale: the third revive costs four times the first.
  revive1: { id: "revive1", stars: 30, title: "Continue", desc: "Carry on from where you died" },
  revive2: { id: "revive2", stars: 60, title: "Continue", desc: "Second continue this run" },
  revive3: { id: "revive3", stars: 120, title: "Continue", desc: "Third continue and beyond" },

  booster_once: {
    id: "booster_once",
    stars: 25,
    title: "One booster",
    desc: "A single use of a booster you have already unlocked",
    needsChoice: "booster",
  },
  booster_unlock: {
    id: "booster_unlock",
    stars: 200,
    title: "Unlock a booster",
    desc: "Open a booster now instead of levelling to it",
    needsChoice: "booster",
  },
  // One product per rarity rather than one per skin: the price lives in the
  // catalogue, and the server checks that the chosen skin's rarity matches the
  // product bought — otherwise a legendary could be had at the common price.
  skin_common: { id: "skin_common", stars: RARITY_STARS.common, title: "Skin", desc: "A common ball skin", needsChoice: "skin" },
  skin_rare: { id: "skin_rare", stars: RARITY_STARS.rare, title: "Skin", desc: "A rare ball skin", needsChoice: "skin" },
  skin_epic: { id: "skin_epic", stars: RARITY_STARS.epic, title: "Skin", desc: "An epic ball skin", needsChoice: "skin" },
  skin_legendary: { id: "skin_legendary", stars: RARITY_STARS.legendary, title: "Skin", desc: "A legendary ball skin", needsChoice: "skin" },

  daily_reroll: { id: "daily_reroll", stars: 10, title: "New daily tasks", desc: "Reroll today's tasks" },
};

// The nth continue inside a single run, capped at the top rung. One function,
// used by the button that shows the price AND by the server that charges it —
// two copies of this ladder would eventually quote different numbers.
/** Which product buys this skin, or null for one that is not for sale. */
export const skinProduct = (id: string): ProductId | null => {
  const r = SKINS[id]?.rarity;
  return r ? (`skin_${r}` as ProductId) : null;
};

export const revivePrice = (n: number): Product =>
  n <= 1 ? PRODUCTS.revive1 : n === 2 ? PRODUCTS.revive2 : PRODUCTS.revive3;

export const reviveProduct = (n: number): ProductId => revivePrice(n).id;
