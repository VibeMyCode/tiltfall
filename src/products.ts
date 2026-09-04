// What can be bought for Telegram Stars, as plain data shared by the client and
// the server. The client shows it; the server prices the invoice from THIS
// table and never from the request, so a forged price is not a thing that can
// be sent.
//
// Prices are in Stars. At the current rate 100 Stars is about $1.33, so a Star
// is roughly 1.3 cents, and the ladder below is set for a game nobody has heard
// of yet: the first purchase has to be small enough not to be a decision.
export type ProductId =
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
  needsChoice?: "booster";
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
  daily_reroll: { id: "daily_reroll", stars: 10, title: "New daily tasks", desc: "Reroll today's tasks" },
};

// The nth continue inside a single run, capped at the top rung.
export const revivePrice = (n: number): Product =>
  n <= 1 ? PRODUCTS.revive1 : n === 2 ? PRODUCTS.revive2 : PRODUCTS.revive3;
