// DOM HUD + Results overlay (§2: UI is plain HTML/CSS, not Babylon GUI).
export interface UI {
  setHud: (timeS: number, score: number, combo: number) => void;
  showResults: (r: { timeS: number; score: number; broken: number; maxCombo: number }) => void;
  hideResults: () => void;
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

  const results = document.createElement("div");
  results.className = "results hidden";
  results.innerHTML = `
    <div class="results-card">
      <h2>DESCENT COMPLETE</h2>
      <div class="results-row"><span>Score</span><b id="res-score">0</b></div>
      <div class="results-row"><span>Time</span><b id="res-time">0.0s</b></div>
      <div class="results-row"><span>Blocks smashed</span><b id="res-broken">0</b></div>
      <div class="results-row"><span>Best combo</span><b id="res-combo">×1</b></div>
      <button id="res-replay">DROP AGAIN</button>
    </div>`;
  document.body.appendChild(results);
  results.querySelector<HTMLButtonElement>("#res-replay")!.addEventListener("click", onReplay);

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
      results.classList.remove("hidden");
    },
    hideResults() {
      results.classList.add("hidden");
    },
  };
}
