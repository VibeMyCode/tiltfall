// DOM HUD + Results overlay (§2: UI is plain HTML/CSS, not Babylon GUI).
import { CONFIG } from "./config";
import { CARD_INFO, type CardId } from "./cards";

export interface UI {
  setHud: (timeS: number, score: number, combo: number) => void;
  showResults: (r: { timeS: number; score: number; broken: number; maxCombo: number; parBonus: number }) => void;
  hideResults: () => void;
  showDraft: (offers: CardId[], onPick: (card: CardId) => void) => void;
  isDraftOpen: () => boolean;
  pickDraft: (index: number) => void;
}

export function createUI(onReplay: () => void, invert: { get: () => boolean; toggle: () => boolean }): UI {
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
  if (CONFIG.targetControl) invertBtn.style.display = "none"; // pointing AT a target has no inversion

  const results = document.createElement("div");
  results.className = "results hidden";
  results.innerHTML = `
    <div class="results-card">
      <h2>DESCENT COMPLETE</h2>
      <div class="results-row"><span>Score</span><b id="res-score">0</b></div>
      <div class="results-row"><span>Time</span><b id="res-time">0.0s</b></div>
      <div class="results-row"><span>Blocks smashed</span><b id="res-broken">0</b></div>
      <div class="results-row"><span>Best combo</span><b id="res-combo">×1</b></div>
      <div class="results-row"><span>Par bonus</span><b id="res-par">+0</b></div>
      <button id="res-replay">DROP AGAIN</button>
    </div>`;
  document.body.appendChild(results);
  results.querySelector<HTMLButtonElement>("#res-replay")!.addEventListener("click", onReplay);

  // Draft overlay (§3.4): 3 cards, countdown ring, auto-pick leftmost.
  const draft = document.createElement("div");
  draft.className = "draft hidden";
  draft.innerHTML = `<div class="draft-timer"><div class="draft-ring" id="draft-ring"></div></div><div class="draft-cards" id="draft-cards"></div>`;
  document.body.appendChild(draft);
  let draftOffers: CardId[] = [];
  let draftPickCb: ((c: CardId) => void) | null = null;
  let draftTimer = 0;
  let draftRaf = 0;

  function closeDraft(card: CardId): void {
    if (!draftPickCb) return;
    const cb = draftPickCb;
    draftPickCb = null;
    clearTimeout(draftTimer);
    cancelAnimationFrame(draftRaf);
    draft.classList.add("hidden");
    cb(card);
  }

  window.addEventListener("keydown", (e) => {
    if (!draftPickCb) return;
    const i = ["Digit1", "Digit2", "Digit3"].indexOf(e.code);
    if (i >= 0 && draftOffers[i]) closeDraft(draftOffers[i]);
  });

  const el = (id: string) => document.getElementById(id)!;
  let lastCombo = 1;
  return {
    setHud(timeS, score, combo) {
      el("hud-time").textContent = `${timeS.toFixed(1)}s`;
      el("hud-score").textContent = String(score);
      const comboEl = el("hud-combo");
      comboEl.textContent = `×${combo}`;
      comboEl.classList.toggle("hot", combo >= 4);
      if (combo > lastCombo) {
        comboEl.classList.remove("pop");
        void comboEl.offsetWidth; // restart the CSS animation
        comboEl.classList.add("pop");
      }
      lastCombo = combo;
    },
    showResults(r) {
      el("res-score").textContent = String(r.score);
      el("res-time").textContent = `${r.timeS.toFixed(1)}s`;
      el("res-broken").textContent = String(r.broken);
      el("res-combo").textContent = `×${r.maxCombo}`;
      el("res-par").textContent = `+${r.parBonus}`;
      results.classList.remove("hidden");
    },
    hideResults() {
      results.classList.add("hidden");
    },
    showDraft(offers, onPick) {
      draftOffers = offers;
      draftPickCb = onPick;
      const box = el("draft-cards");
      box.innerHTML = "";
      offers.forEach((id, i) => {
        const info = CARD_INFO[id];
        const btn = document.createElement("button");
        btn.className = "card";
        btn.style.setProperty("--accent", info.color);
        btn.innerHTML = `<span class="card-key">${i + 1}</span><b>${info.name}</b><small>${info.desc}</small>`;
        btn.addEventListener("click", () => closeDraft(id));
        box.appendChild(btn);
      });
      draft.classList.remove("hidden");
      const t0 = performance.now();
      const total = CONFIG.draftSeconds * 1000;
      const ring = el("draft-ring");
      const tickRing = () => {
        const k = Math.min(1, (performance.now() - t0) / total);
        ring.style.setProperty("--p", String(1 - k));
        if (draftPickCb) draftRaf = requestAnimationFrame(tickRing);
      };
      tickRing();
      draftTimer = window.setTimeout(() => closeDraft(offers[0]), total);
    },
    isDraftOpen: () => draftPickCb !== null,
    pickDraft(index) {
      if (draftPickCb && draftOffers[index]) closeDraft(draftOffers[index]);
    },
  };
}
