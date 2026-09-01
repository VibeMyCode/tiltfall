// DOM HUD + booster bar + results/shop overlay (§2: plain HTML/CSS).
import { CONFIG } from "./config";
import { BOOSTER_INFO, BOOSTER_ORDER, boosterPrice, type BoosterId } from "./boosters";

export interface ShopModel {
  bank: number;
  inventory: Record<BoosterId, number>;
  buy: (id: BoosterId) => void;
}

export interface UI {
  setHud: (timeS: number, score: number, combo: number) => void;
  setBoosterBar: (inventory: Record<BoosterId, number>, timers: Partial<Record<BoosterId, number>>) => void;
  showResults: (r: {
    timeS: number;
    score: number;
    broken: number;
    maxCombo: number;
    bestScore: number;
    bestCombo: number;
    newBest: boolean;
    shop: ShopModel;
  }) => void;
  hideResults: () => void;
}

export function createUI(
  onReplay: () => void,
  invert: { get: () => boolean; toggle: () => boolean },
  onActivate: (id: BoosterId) => void,
): UI {
  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `
    <div class="hud-item" id="hud-time">0.0s</div>
    <div class="hud-item hud-score" id="hud-score">0</div>
    <div class="hud-item hud-combo" id="hud-combo">×1</div>
    <button class="hud-item hud-toggle" id="hud-invert"></button>`;
  document.body.appendChild(hud);
  const invertBtn = hud.querySelector<HTMLButtonElement>("#hud-invert")!;
  const renderInvert = (on: boolean) => (invertBtn.textContent = `Y ${on ? "⇅ INV" : "↓ STD"}`);
  renderInvert(invert.get());
  invertBtn.addEventListener("click", () => renderInvert(invert.toggle()));
  if (CONFIG.targetControl) invertBtn.style.display = "none";

  // Booster bar: owned boosters as icons with counts; tap or keys 1..6.
  const bar = document.createElement("div");
  bar.className = "booster-bar";
  document.body.appendChild(bar);
  let barKey = "";

  window.addEventListener("keydown", (e) => {
    const i = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].indexOf(e.code);
    if (i >= 0) onActivate(BOOSTER_ORDER[i]);
  });

  const results = document.createElement("div");
  results.className = "results hidden";
  results.innerHTML = `
    <div class="results-card">
      <div class="new-best hidden" id="res-newbest">🏆 NEW BEST!</div>
      <h2>DESCENT COMPLETE</h2>
      <div class="results-row"><span>Score</span><b id="res-score">0</b></div>
      <div class="results-row"><span>Time</span><b id="res-time">0.0s</b></div>
      <div class="results-row"><span>Blocks smashed</span><b id="res-broken">0</b></div>
      <div class="results-row"><span>Best combo</span><b id="res-combo">×1</b></div>
      <div class="results-row res-best"><span>Best score / combo</span><b id="res-best">0 / ×1</b></div>
      <div class="shop">
        <div class="shop-head">BOOSTER SHOP <span class="bank" id="shop-bank">0</span></div>
        <div class="shop-grid" id="shop-grid"></div>
      </div>
      <button id="res-replay">DROP AGAIN</button>
    </div>`;
  document.body.appendChild(results);
  results.querySelector<HTMLButtonElement>("#res-replay")!.addEventListener("click", onReplay);

  const el = (id: string) => document.getElementById(id)!;
  let lastCombo = 1;
  let shopModel: ShopModel | null = null;

  function renderShop(): void {
    if (!shopModel) return;
    el("shop-bank").textContent = String(shopModel.bank);
    const grid = el("shop-grid");
    grid.innerHTML = "";
    for (const id of BOOSTER_ORDER) {
      const info = BOOSTER_INFO[id];
      const price = boosterPrice(id);
      const owned = shopModel.inventory[id] ?? 0;
      const btn = document.createElement("button");
      btn.className = "shop-item";
      btn.style.setProperty("--accent", info.color);
      btn.disabled = shopModel.bank < price;
      btn.innerHTML = `<span class="shop-icon">${info.icon}</span><b>${info.name}</b><small>${info.desc}</small><span class="shop-price">${price}</span><span class="shop-owned">×${owned}</span>`;
      btn.addEventListener("click", () => {
        shopModel!.buy(id);
        renderShop();
      });
      grid.appendChild(btn);
    }
  }

  return {
    setHud(timeS, score, combo) {
      el("hud-time").textContent = `${timeS.toFixed(1)}s`;
      el("hud-score").textContent = String(score);
      const comboEl = el("hud-combo");
      comboEl.textContent = `×${combo}`;
      comboEl.classList.toggle("hot", combo >= 4);
      if (combo > lastCombo) {
        comboEl.classList.remove("pop");
        void comboEl.offsetWidth;
        comboEl.classList.add("pop");
      }
      lastCombo = combo;
    },
    setBoosterBar(inventory, timers) {
      const key = JSON.stringify([inventory, timers]);
      if (key === barKey) return;
      barKey = key;
      bar.innerHTML = "";
      BOOSTER_ORDER.forEach((id, i) => {
        const owned = inventory[id] ?? 0;
        const active = (timers[id] ?? 0) > 0;
        if (owned <= 0 && !active) return;
        const info = BOOSTER_INFO[id];
        const btn = document.createElement("button");
        btn.className = `booster${active ? " active" : ""}`;
        btn.style.setProperty("--accent", info.color);
        btn.innerHTML = `<span class="b-icon">${info.icon}</span><span class="b-count">${active ? Math.ceil((timers[id] ?? 0) / 120) + "s" : "×" + owned}</span><span class="b-key">${i + 1}</span>`;
        btn.addEventListener("click", () => onActivate(id));
        bar.appendChild(btn);
      });
    },
    showResults(r) {
      el("res-score").textContent = String(r.score);
      el("res-time").textContent = `${r.timeS.toFixed(1)}s`;
      el("res-broken").textContent = String(r.broken);
      el("res-combo").textContent = `×${r.maxCombo}`;
      el("res-best").textContent = `${r.bestScore} / ×${r.bestCombo}`;
      el("res-newbest").classList.toggle("hidden", !r.newBest);
      shopModel = r.shop;
      renderShop();
      results.classList.remove("hidden");
    },
    hideResults() {
      results.classList.add("hidden");
      shopModel = null;
    },
  };
}
