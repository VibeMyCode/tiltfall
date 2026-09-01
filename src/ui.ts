// DOM HUD + jump button + booster bar + game-over overlay with level,
// skins, shop and daily tasks (§2: plain HTML/CSS).
import { CONFIG } from "./config";
import { BOOSTER_INFO, BOOSTER_ORDER, boosterPrice, type BoosterId } from "./boosters";
import type { DailyTask } from "./meta";

export interface ShopModel {
  bank: number;
  inventory: Record<BoosterId, number>;
  buy: (id: BoosterId) => void;
}

export interface ResultsModel {
  score: number;
  depth: number;
  broken: number;
  maxCombo: number;
  bestScore: number;
  bestDepth: number;
  newBest: boolean;
  shop: ShopModel;
  // Live getters — the panel re-renders after purchases and must never show
  // a stale snapshot (owner bug: LEVEL stayed at 1 after buying).
  level: {
    current: () => number;
    cost: () => number;
    jumpPower: () => number;
    jumpCdS: () => number;
    shields: () => number;
    buy: () => boolean;
  };
  skins: { unlocked: () => string[]; current: () => string; select: (id: string) => void };
  daily: {
    tasks: (DailyTask & { progress: number; claimed: boolean })[];
    claim: (id: string) => void;
  };
}

export interface UI {
  setHud: (timeS: number, score: number, combo: number, depth: number, shields: number) => void;
  setJump: (readyFrac: number) => void;
  setBoosterBar: (
    inventory: Record<BoosterId, number>,
    armed: Partial<Record<BoosterId, boolean>>,
    runOn: Partial<Record<BoosterId, boolean>>,
  ) => void;
  showResults: (r: ResultsModel) => void;
  hideResults: () => void;
}

export interface UIHandlers {
  onReplay: () => void;
  invert: { get: () => boolean; toggle: () => boolean };
  onActivate: (id: BoosterId) => void;
  onJump: () => void;
}

export function createUI(h: UIHandlers): UI {
  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `
    <div class="hud-item" id="hud-time">0.0s</div>
    <div class="hud-item hud-score" id="hud-score">0</div>
    <div class="hud-item hud-combo" id="hud-combo">×1</div>
    <div class="hud-item hud-depth" id="hud-depth">◈ 0</div>
    <div class="hud-item hud-shield hidden" id="hud-shield">⛨ 0</div>
    <button class="hud-item hud-toggle" id="hud-invert"></button>`;
  document.body.appendChild(hud);
  const invertBtn = hud.querySelector<HTMLButtonElement>("#hud-invert")!;
  const renderInvert = (on: boolean) => (invertBtn.textContent = `Y ${on ? "⇅ INV" : "↓ STD"}`);
  renderInvert(h.invert.get());
  invertBtn.addEventListener("click", () => renderInvert(h.invert.toggle()));
  if (CONFIG.targetControl) invertBtn.style.display = "none";

  const bar = document.createElement("div");
  bar.className = "booster-bar";
  document.body.appendChild(bar);
  let barKey = "";

  // JUMP button (owner design): thumb-reachable; Space on desktop.
  const jumpBtn = document.createElement("button");
  jumpBtn.className = "jump-btn";
  jumpBtn.innerHTML = `<span class="jump-fill" id="jump-fill"></span><span class="jump-label">JUMP</span>`;
  document.body.appendChild(jumpBtn);
  jumpBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    h.onJump();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      h.onJump();
    }
    const i = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].indexOf(e.code);
    if (i >= 0) h.onActivate(BOOSTER_ORDER[i]);
  });

  const results = document.createElement("div");
  results.className = "results hidden";
  results.innerHTML = `
    <div class="results-card">
      <div class="results-scroll">
        <div class="new-best hidden" id="res-newbest">🏆 NEW BEST!</div>
        <h2 id="res-title">GAME OVER</h2>
        <div class="hero-score" id="res-score">0</div>
        <div class="hero-sub">BEST <b id="res-best">0</b></div>
        <div class="chip-row">
          <span class="chip">◈ <b id="res-depth">0</b><i>depth</i></span>
          <span class="chip">▦ <b id="res-broken">0</b><i>blocks</i></span>
          <span class="chip">× <b id="res-combo">1</b><i>combo</i></span>
        </div>
        <div class="bank-line">BANK <b class="bank" id="shop-bank">0</b></div>
        <div class="level-box" id="level-box"></div>
        <div class="skin-row" id="skin-row"></div>
        <div class="section" id="shop-section">
          <div class="section-head">BOOSTERS</div>
          <div class="shop-grid" id="shop-grid"></div>
        </div>
        <div class="section daily" id="daily-box"></div>
      </div>
      <button id="res-replay">DROP AGAIN</button>
    </div>`;
  document.body.appendChild(results);
  results.querySelector<HTMLButtonElement>("#res-replay")!.addEventListener("click", h.onReplay);

  const el = (id: string) => document.getElementById(id)!;
  let lastCombo = 1;
  let model: ResultsModel | null = null;

  function renderPanels(): void {
    if (!model) return;
    const m = model;
    el("shop-bank").textContent = String(m.shop.bank);

    // Level panel — live values, never a stale snapshot.
    const lvl = m.level.current();
    const cost = m.level.cost();
    const shields = m.level.shields();
    const lb = el("level-box");
    lb.innerHTML = `
      <div class="lvl-head">
        <span class="lvl-name">LEVEL <b>${lvl}</b></span>
        <span class="lvl-stats"><i>jump</i><b>${m.level.jumpPower()}</b><i>reload</i><b>${m.level.jumpCdS().toFixed(1)}s</b>${shields ? `<i>shields</i><b>${shields}</b>` : ""}</span>
      </div>
      <button id="lvl-buy" ${m.shop.bank < cost ? "disabled" : ""}>LEVEL UP — ${cost}</button>`;
    lb.querySelector<HTMLButtonElement>("#lvl-buy")!.addEventListener("click", () => {
      if (m.level.buy()) renderPanels();
    });

    // Skins.
    const sr = el("skin-row");
    sr.innerHTML = "";
    for (const id of m.skins.unlocked()) {
      const b = document.createElement("button");
      b.className = `skin skin-${id}${id === m.skins.current() ? " sel" : ""}`;
      b.title = id;
      b.addEventListener("click", () => {
        m.skins.select(id);
        renderPanels();
      });
      sr.appendChild(b);
    }

    // Shop.
    const grid = el("shop-grid");
    grid.innerHTML = "";
    for (const id of BOOSTER_ORDER) {
      const info = BOOSTER_INFO[id];
      const price = boosterPrice(id);
      const owned = m.shop.inventory[id] ?? 0;
      const btn = document.createElement("button");
      btn.className = "shop-item";
      btn.style.setProperty("--accent", info.color);
      btn.disabled = m.shop.bank < price;
      btn.title = info.desc; // hover tooltip — no card scroll from long texts
      btn.innerHTML = `<span class="shop-icon">${info.svg}</span><b>${info.name}</b><span class="shop-price">${price}</span><span class="shop-owned">×${owned}</span>`;
      btn.addEventListener("click", () => {
        m.shop.buy(id);
        renderPanels();
      });
      grid.appendChild(btn);
    }

    // Daily tasks.
    const db = el("daily-box");
    const rows = m.daily.tasks
      .map((t) => {
        const done = t.progress >= t.goal;
        const btn = t.claimed
          ? `<span class="task-done">✓</span>`
          : done
            ? `<button class="task-claim" data-id="${t.id}">+${CONFIG.dailyRewardEach}</button>`
            : `<span class="task-progress">${Math.min(t.progress, t.goal)}/${t.goal}</span>`;
        return `<div class="task${t.claimed ? " claimed" : ""}"><span>${t.text}</span>${btn}</div>`;
      })
      .join("");
    db.innerHTML = `<div class="section-head">DAILY TASKS</div>${rows}`;
    db.querySelectorAll<HTMLButtonElement>(".task-claim").forEach((b) =>
      b.addEventListener("click", () => {
        m.daily.claim(b.dataset.id!);
        renderPanels();
      }),
    );
  }

  return {
    setHud(timeS, score, combo, depth, shields) {
      el("hud-time").textContent = `${timeS.toFixed(1)}s`;
      el("hud-score").textContent = String(score);
      el("hud-depth").textContent = `◈ ${depth}`;
      const sh = el("hud-shield");
      sh.textContent = `⛨ ${shields}`;
      sh.classList.toggle("hidden", shields <= 0);
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
    setJump(readyFrac) {
      el("jump-fill").style.setProperty("--f", String(readyFrac));
      jumpBtn.classList.toggle("ready", readyFrac >= 1);
    },
    setBoosterBar(inventory, armed, runOn) {
      const key = JSON.stringify([inventory, armed, runOn]);
      if (key === barKey) return;
      barKey = key;
      bar.innerHTML = "";
      BOOSTER_ORDER.forEach((id, i) => {
        const owned = inventory[id] ?? 0;
        const state = armed[id] ? "ARMED" : runOn[id] ? "ON" : "";
        if (owned <= 0 && !state) return;
        const info = BOOSTER_INFO[id];
        const btn = document.createElement("button");
        btn.className = `booster${state ? " active" : ""}`;
        btn.style.setProperty("--accent", info.color);
        btn.innerHTML = `<span class="b-icon">${info.svg}</span><span class="b-count">${state || "×" + owned}</span><span class="b-key">${i + 1}</span>`;
        btn.addEventListener("click", () => h.onActivate(id));
        bar.appendChild(btn);
      });
    },
    showResults(r) {
      model = r;
      el("res-score").textContent = String(r.score);
      el("res-depth").textContent = String(r.depth);
      el("res-broken").textContent = String(r.broken);
      el("res-combo").textContent = String(r.maxCombo);
      el("res-best").textContent = `${r.bestScore} · depth ${r.bestDepth}`;
      el("res-newbest").classList.toggle("hidden", !r.newBest);
      renderPanels();
      document.body.classList.add("gameover"); // hides jump/booster bar
      results.classList.remove("hidden");
    },
    hideResults() {
      results.classList.add("hidden");
      document.body.classList.remove("gameover");
      model = null;
    },
  };
}
