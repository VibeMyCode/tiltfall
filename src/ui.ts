// DOM HUD + jump button + booster bar + game-over overlay with level,
// skins, shop and daily tasks (§2: plain HTML/CSS).
import { CONFIG } from "./config";
import { BOOSTER_INFO, BOOSTER_ORDER, boosterPrice, type BoosterId } from "./boosters";
import type { DailyTask } from "./meta";
import { SKINS, drawSkin } from "./skins";

export interface ShopModel {
  bank: number;
  inventory: Record<BoosterId, number>;
  unlockLevel: (id: BoosterId) => number;
  unlocked: (id: BoosterId) => boolean;
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
    jumpMul: () => number; // jump strength relative to level 1 (owner)
    jumpCdS: () => number;
    shields: () => number;
    jumpCharges: () => number;
    nextText: () => string;
    buy: () => boolean;
  };
  skins: { unlocked: () => string[]; current: () => string; select: (id: string) => void };
  daily: {
    // A getter, not a snapshot — claiming must refresh the rows (owner bug:
    // the +90 button stayed after claiming).
    tasks: () => (DailyTask & { progress: number; claimed: boolean })[];
    claim: (id: string) => void;
  };
}

export interface UI {
  setHud: (timeS: number, score: number, combo: number, depth: number, shields: number) => void;
  setJump: (readyFrac: number, charges: number, maxCharges: number) => void;
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
  onStart: () => void; // title screen → first run (also unlocks audio)
  mute: { get: () => boolean; toggle: () => boolean };
  best: () => { score: number; depth: number };
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
    <button class="hud-item hud-toggle" id="hud-invert"></button>
    <button class="hud-item hud-toggle" id="hud-mute"></button>`;
  document.body.appendChild(hud);
  const invertBtn = hud.querySelector<HTMLButtonElement>("#hud-invert")!;
  const renderInvert = (on: boolean) => (invertBtn.textContent = `Y ${on ? "⇅ INV" : "↓ STD"}`);
  renderInvert(h.invert.get());
  invertBtn.addEventListener("click", () => renderInvert(h.invert.toggle()));
  if (CONFIG.targetControl) invertBtn.style.display = "none";
  const muteBtn = hud.querySelector<HTMLButtonElement>("#hud-mute")!;
  const renderMute = (m: boolean) => (muteBtn.textContent = m ? "♪ OFF" : "♪ ON");
  renderMute(h.mute.get());
  muteBtn.addEventListener("click", () => renderMute(h.mute.toggle()));

  // TITLE screen: first thing the player sees; its button also unlocks audio.
  const title = document.createElement("div");
  title.className = "title";
  title.innerHTML = `
    <div class="title-card">
      <h1>TILTFALL</h1>
      <p class="tagline">Steer the falling ball. Smash everything. Dodge the mines.</p>
      <div class="title-best hidden" id="title-best"></div>
      <button id="title-play">PLAY</button>
      <div class="title-hint">drag anywhere to steer · <b>SPACE</b> or the button to jump · numbers activate boosters</div>
    </div>`;
  document.body.appendChild(title);
  document.body.classList.add("titlescreen");
  const b = h.best();
  if (b.score > 0) {
    const tb = title.querySelector<HTMLElement>("#title-best")!;
    tb.textContent = `BEST ${b.score} · depth ${b.depth}`;
    tb.classList.remove("hidden");
  }
  title.querySelector<HTMLButtonElement>("#title-play")!.addEventListener("click", () => {
    title.classList.add("gone");
    document.body.classList.remove("titlescreen");
    h.onStart();
  });

  const bar = document.createElement("div");
  bar.className = "booster-bar";
  document.body.appendChild(bar);
  let barKey = "";

  // JUMP button (owner design): thumb-reachable; Space on desktop.
  const jumpBtn = document.createElement("button");
  jumpBtn.className = "jump-btn";
  jumpBtn.innerHTML = `<span class="jump-fill" id="jump-fill"></span><span class="jump-label">JUMP</span><span class="jump-charges hidden" id="jump-charges">1</span>`;
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
    const charges = m.level.jumpCharges();
    const lb = el("level-box");
    lb.innerHTML = `
      <div class="lvl-head">
        <span class="lvl-name">LEVEL <b>${lvl}</b></span>
        <span class="lvl-stats"><i>jump</i><b>×${m.level.jumpMul().toFixed(2)}</b><i>reload</i><b>${m.level.jumpCdS().toFixed(1)}s</b>${charges > 1 ? `<i>charges</i><b>${charges}</b>` : ""}${shields ? `<i>shields</i><b>${shields}</b>` : ""}</span>
      </div>
      <div class="lvl-next"><span>NEXT</span> ${m.level.nextText()}</div>
      <button id="lvl-buy" ${m.shop.bank < cost ? "disabled" : ""}>LEVEL UP — ${cost}</button>`;
    lb.querySelector<HTMLButtonElement>("#lvl-buy")!.addEventListener("click", () => {
      if (m.level.buy()) renderPanels();
    });

    // Skins.
    // Skin swatches paint the REAL procedural pattern (owner: the menu was
    // showing flat colors while the ball had a pattern).
    const sr = el("skin-row");
    sr.innerHTML = "";
    for (const id of m.skins.unlocked()) {
      const b = document.createElement("button");
      b.className = `skin${id === m.skins.current() ? " sel" : ""}`;
      b.title = SKINS[id]?.name ?? id;
      const cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 64;
      const ctx = cv.getContext("2d");
      if (ctx) drawSkin(ctx, id, 64);
      b.appendChild(cv);
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
      const unlocked = m.shop.unlocked(id);
      const btn = document.createElement("button");
      btn.className = `shop-item${unlocked ? "" : " locked"}`;
      btn.style.setProperty("--accent", info.color);
      btn.disabled = !unlocked || m.shop.bank < price;
      btn.title = unlocked ? info.desc : `Unlocks at level ${m.shop.unlockLevel(id)}`;
      btn.innerHTML = unlocked
        ? `<span class="shop-icon">${info.svg}</span><b>${info.name}</b><span class="shop-price">${price}</span><span class="shop-owned">×${owned}</span>`
        : `<span class="shop-icon">${info.svg}</span><b>${info.name}</b><span class="shop-lock">LVL ${m.shop.unlockLevel(id)}</span>`;
      btn.addEventListener("click", () => {
        m.shop.buy(id);
        renderPanels();
      });
      grid.appendChild(btn);
    }

    // Daily tasks.
    const db = el("daily-box");
    const rows = m.daily
      .tasks()
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
    setJump(readyFrac, charges, maxCharges) {
      el("jump-fill").style.setProperty("--f", String(readyFrac));
      jumpBtn.classList.toggle("ready", charges > 0);
      const badge = el("jump-charges");
      badge.textContent = String(charges);
      badge.classList.toggle("hidden", maxCharges <= 1);
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
