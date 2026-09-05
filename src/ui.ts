// DOM HUD + jump button + booster bar + game-over overlay with level,
// skins, shop and daily tasks (§2: plain HTML/CSS).
import { CONFIG } from "./config.js";
import { BOOSTER_INFO, BOOSTER_ORDER, boosterPrice, type BoosterId } from "./boosters.js";
import { isTouch } from "./input.js";
import { fetchBoard, type BoardRow, type SubmitResult } from "./board.js";
import type { DailyTask } from "./meta.js";
import { SKINS, drawSkin, skinThumb, type Rarity } from "./skins.js";

export interface ShopModel {
  bank: number;
  inventory: Record<BoosterId, number>;
  unlockLevel: (id: BoosterId) => number;
  unlocked: (id: BoosterId) => boolean;
  buy: (id: BoosterId) => void;
  // Opening a booster ahead of the level that grants it. Null where there is
  // nobody to charge.
  unlockStars: number | null;
  buyUnlock: (id: BoosterId) => Promise<boolean>;
}

// A skin is a sphere unwrap, so showing it flat is showing the wrong thing —
// the menu had a ball with rings on it looking like purple stripes. This
// projects it the way the camera does: a pixel at radius r on the disc lies
// asin(r) down from the pole, and the pole is the BOTTOM of the texture.
const GIFT_GLYPH = "\u{1F381}";
const PREVIEW = 96;
const TEX = 128;

function projectBall(src: CanvasImageSource): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = PREVIEW;
  out.height = PREVIEW;
  const octx = out.getContext("2d");
  const tmp = document.createElement("canvas");
  tmp.width = TEX;
  tmp.height = TEX;
  const tctx = tmp.getContext("2d");
  if (!octx || !tctx) return out;
  tctx.drawImage(src, 0, 0, TEX, TEX);
  const tex = tctx.getImageData(0, 0, TEX, TEX).data;
  const img = octx.createImageData(PREVIEW, PREVIEW);
  const R = PREVIEW / 2;
  for (let y = 0; y < PREVIEW; y++) {
    for (let x = 0; x < PREVIEW; x++) {
      const dx = (x - R + 0.5) / R;
      const dy = (y - R + 0.5) / R;
      const r = Math.hypot(dx, dy);
      if (r > 1) continue; // outside the ball stays transparent
      const sx = Math.min(TEX - 1, (((Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1) * TEX) | 0);
      const sy = Math.min(TEX - 1, ((1 - Math.asin(r) / Math.PI) * TEX) | 0);
      // Brightness falls off toward the rim, or a sphere reads as a sticker.
      const k = 0.55 + 0.45 * Math.sqrt(1 - r * r);
      const o = (y * PREVIEW + x) * 4;
      const t = (sy * TEX + sx) * 4;
      img.data[o] = tex[t] * k;
      img.data[o + 1] = tex[t + 1] * k;
      img.data[o + 2] = tex[t + 2] * k;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// Procedural skins draw themselves; the painted ones have a 128px thumbnail,
// which is what those were generated for. The painted ones arrive late, so the
// swatch is a host element the projection drops into once the file has decoded.
function skinSwatch(id: string): HTMLElement {
  const host = document.createElement("span");
  host.className = "swatch";
  const url = skinThumb(id);
  if (!url) {
    const cv = document.createElement("canvas");
    cv.width = TEX;
    cv.height = TEX;
    const ctx = cv.getContext("2d");
    if (ctx) drawSkin(ctx, id, TEX);
    host.appendChild(projectBall(cv));
    return host;
  }
  const img = new Image();
  img.src = url;
  void img
    .decode()
    .then(() => host.appendChild(projectBall(img)))
    .catch(() => {});
  return host;
}

export interface SkinOffer {
  id: string;
  name: string;
  rarity: Rarity;
  stars: number;
  owned: boolean;
}

export interface ResultsModel {
  score: number;
  depth: number;
  broken: number;
  maxCombo: number;
  bestScore: number;
  bestDepth: number;
  newBest: boolean;
  share: { telegram: (() => void) | null; x: () => void };
  shop: ShopModel;
  // Live getters — the panel re-renders after purchases and must never show
  // a stale snapshot (owner bug: LEVEL stayed at 1 after buying).
  level: {
    current: () => number;
    cost: () => number;
    nextText: () => string;
    buy: () => boolean;
  };
  skins: {
    unlocked: () => string[];
    current: () => string;
    select: (id: string) => void;
    forSale: () => SkinOffer[];
    buyable: boolean; // false outside Telegram, where there is nobody to charge
    buy: (id: string) => Promise<boolean>;
    gift: (id: string) => Promise<boolean>;
  };
  // Bought for somebody else and not yet handed over. A share cancelled once
  // must not lose the purchase, so the link stays available here.
  gifts: { unsent: () => { code: string; name: string }[]; share: (code: string) => void };
  daily: {
    // A getter, not a snapshot — claiming must refresh the rows (owner bug:
    // the +90 button stayed after claiming).
    rerollStars: number | null;
    reroll: () => Promise<boolean>;
    tasks: () => (DailyTask & { progress: number; claimed: boolean })[];
    claim: (id: string) => void;
  };
}

export interface UI {
  setHud: (timeS: number, score: number, combo: number, depth: number, shields: number) => void;
  setJump: (charges: number, maxCharges: number, cooldownS: number) => void;
  setBoosterBar: (
    inventory: Record<BoosterId, number>,
    armed: Partial<Record<BoosterId, boolean>>,
    runOn: Partial<Record<BoosterId, boolean>>,
  ) => void;
  showBiome: (name: string) => void;
  showResults: (r: ResultsModel) => void;
  hideResults: () => void;
  setRank: (r: SubmitResult | null) => void;
  showTitle: () => void;
  showMenu: (r: ResultsModel) => void;
  // The offer to carry on, shown at the moment of death rather than on the
  // results card: it converts on the freshness of the loss, and a paid button
  // living permanently in the menu reads as nagging.
  askRevive: (o: ReviveOffer) => void;
}

export interface ReviveOffer {
  stars: number;
  score: number;
  depth: number;
  buy: () => Promise<boolean>;
  decline: () => void;
}

export interface UIHandlers {
  onReplay: () => void;
  onReset: () => void; // wipe all progress and start over
  invert: { get: () => boolean; toggle: () => boolean };
  onActivate: (id: BoosterId) => void;
  onJump: () => void;
  onStart: () => void; // title screen → first run (also unlocks audio)
  onShop: () => void; // title screen → the shop, before any run
  onHome: () => void; // leave the results card and go back to the title screen
  mute: { get: () => boolean; toggle: () => boolean };
  best: () => { score: number; depth: number };
  // Who you are and what you have carried in — read once when the title screen
  // is built, which is the only time it is shown.
  account: () => { name: string | null; level: number; bank: number; skin: string };
}

// Same drawing language as the booster icons: 24-box, currentColor, so it
// inherits the button's colour instead of being a coloured sticker.
const TG_ICON =
  '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M21 4.5 2.8 11.2c-.9.3-.9 1.1 0 1.4l4.6 1.4 1.7 5.2c.2.6.6.7 1.1.3l2.6-2.1 4.5 3.3c.8.5 1.4.2 1.6-.8L22 5.7c.2-1-.4-1.5-1-1.2z" fill="currentColor"/>' +
  '<path d="M8 13.4 17.5 7 10 14l-.4 3.5z" fill="#0b1020" opacity=".35"/></svg>';

const X_ICON =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.1L4.7 21H1.5l7.5-8.6L1.2 3h6.6l4.5 5.6zM16.4 19.2h1.8L7.7 4.7H5.8z" fill="currentColor"/></svg>';

const SHOP_ICON =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M4.2 8h15.6l-1.3 11.2a1.6 1.6 0 0 1-1.6 1.4H7.1a1.6 1.6 0 0 1-1.6-1.4z" fill="currentColor" opacity=".55"/>' +
  '<path d="M8.6 10V7.2a3.4 3.4 0 0 1 6.8 0V10" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/></svg>';

const HOME_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

const BOARD_ICON =
  '<svg class="ico" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="3.5" y="12.5" width="5" height="8" rx="1.3" fill="currentColor" opacity="0.55"/>' +
  '<rect x="9.5" y="6.5" width="5" height="14" rx="1.3" fill="currentColor"/>' +
  '<rect x="15.5" y="15" width="5" height="5.5" rx="1.3" fill="currentColor" opacity="0.55"/>' +
  "</svg>";

export function createUI(h: UIHandlers): UI {
  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `
    <div class="hud-item" id="hud-time">0.0s</div>
    <div class="hud-item hud-score" id="hud-score">0</div>
    <div class="hud-item hud-combo" id="hud-combo">×1</div>
    <div class="hud-item hud-depth" id="hud-depth">◈ 0</div>
    <div class="hud-item hud-jump" id="hud-jump">⤒</div>
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
  const narrow = () => window.innerWidth < 560;
  // Icon-only on phones: a wide label pushed the HUD onto a second row and
  // the wrapped chip hid behind the booster bar (owner screenshot).
  const renderMute = (m: boolean) =>
    (muteBtn.textContent = narrow() ? (m ? "♪̸" : "♪") : m ? "♪ OFF" : "♪ ON");
  renderMute(h.mute.get());
  muteBtn.addEventListener("click", () => renderMute(h.mute.toggle()));

  // TITLE screen: first thing the player sees; its button also unlocks audio.
  const title = document.createElement("div");
  title.className = "title";
  title.innerHTML = `
    <div class="title-card">
      <h1>TILTFALL</h1>
      <p class="tagline">Steer the falling ball. Smash everything. Dodge the mines.</p>
      <div class="account" id="title-account"></div>
      <button id="title-play">PLAY</button>
      <button id="title-shop" class="title-board">${SHOP_ICON}<span>SHOP &amp; LEVEL</span></button>
      <button id="title-board" class="title-board">${BOARD_ICON}<span>LEADERBOARD</span></button>
      <div class="title-hint" id="title-hint"></div>
    </div>`;
  document.body.appendChild(title);
  document.body.classList.add("titlescreen");
  const coarse = window.matchMedia?.("(pointer: coarse)").matches === true;
  title.querySelector<HTMLElement>("#title-hint")!.innerHTML = coarse
    ? "drag anywhere to steer · <b>double tap</b> to jump · tap a booster to use it"
    : "drag or <b>WASD</b> to steer · <b>SPACE</b> to jump · <b>1-6</b> activate boosters";
  // The account card: whichever device you sign in from, this is what you are
  // carrying. Outside Telegram there is no account to name, so it says so
  // rather than inventing one.
  // Re-rendered every time the title screen is shown, not just at boot: coming
  // back from a run, the level, bank and best have all moved.
  function renderAccount(): void {
    const a = h.account();
    const b = h.best();
    const acc = title.querySelector<HTMLElement>("#title-account")!;
    acc.innerHTML =
      `<div class="acc-head"><span class="acc-ball" id="acc-ball"></span>` +
      `<span class="acc-name">${a.name ? a.name.replace(/[<>&"]/g, "").slice(0, 24) : "LOCAL PLAY"}</span></div>` +
      `<div class="acc-row">` +
      `<button class="acc-cell" id="acc-level" title="Tap to reveal reset"><i>level</i><b>${a.level}</b></button>` +
      `<span class="acc-cell"><i>bank</i><b>${a.bank}</b></span>` +
      `<span class="acc-cell"><i>best</i><b>${b.score}</b></span>` +
      `<span class="acc-cell"><i>depth</i><b>${b.depth}</b></span>` +
      `</div>` +
      `<button class="reset-link hidden" id="acc-reset">RESET PROGRESS</button>`;
    // The ball you are wearing, on the card you look at before every run —
    // otherwise a bought skin is invisible until the run starts.
    acc.querySelector<HTMLElement>("#acc-ball")!.appendChild(skinSwatch(a.skin));
    // Same rule as on the results card: a level number reveals the reset.
    const accReset = acc.querySelector<HTMLButtonElement>("#acc-reset")!;
    acc.querySelector<HTMLButtonElement>("#acc-level")!.addEventListener("click", () => {
      accReset.classList.toggle("hidden");
    });
    accReset.addEventListener("click", () => {
      if (confirm("Erase level, bank, boosters, skins and best score, and start over?")) h.onReset();
    });
  }
  renderAccount();
  function startGame(): void {
    title.classList.add("gone");
    document.body.classList.remove("titlescreen");
    h.onStart();
  }
  title.querySelector<HTMLButtonElement>("#title-play")!.addEventListener("click", startGame);

  const bar = document.createElement("div");
  bar.className = "booster-bar";
  document.body.appendChild(bar);
  let barKey = "";

  // No jump button anywhere (owner): Space on desktop, double tap on touch.
  // The HUD chip below is the only jump readout, and it already shows charges
  // and the reload countdown.
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      h.onJump();
    }
    const i = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].indexOf(e.code);
    if (i >= 0) h.onActivate(BOOSTER_ORDER[i]);
  });

  // Biome banner: a brief title card when the tower changes its skin.
  const biomeBanner = document.createElement("div");
  biomeBanner.className = "biome-banner";
  document.body.appendChild(biomeBanner);

  const results = document.createElement("div");
  results.className = "results hidden";
  results.innerHTML = `
    <div class="results-card">
      <div class="results-scroll">
        <div class="new-best hidden" id="res-newbest">NEW BEST</div>
        <h2 id="res-title">GAME OVER</h2>
        <div class="hero-score" id="res-score">0</div>
        <div class="hero-sub">BEST <b id="res-best">0</b></div>
        <div class="chip-row">
          <span class="chip">◈ <b id="res-depth">0</b><i>depth</i></span>
          <span class="chip">▦ <b id="res-broken">0</b><i>blocks</i></span>
          <span class="chip">× <b id="res-combo">1</b><i>combo</i></span>
        </div>
        <button class="board-open" id="res-board">${BOARD_ICON}<span>LEADERBOARD</span></button>
        <div class="bank-line">BANK <b class="bank" id="shop-bank">0</b></div>
        <div class="level-box" id="level-box"></div>
        <div class="skin-row" id="skin-row"></div>
        <div class="section" id="skins-section">
          <div class="section-head">SKINS</div>
          <div class="skin-grid" id="skin-grid"></div>
        </div>
        <div class="section daily hidden" id="gift-box"></div>
        <div class="section" id="shop-section">
          <div class="section-head">BOOSTERS</div>
          <div class="shop-grid" id="shop-grid"></div>
        </div>
        <div class="section daily" id="daily-box"></div>
      </div>
      <div class="results-actions">
        <button id="res-home" class="act-home" aria-label="Back to title">${HOME_ICON}</button>
        <button id="res-share">SHARE</button>
        <button id="res-replay">DROP AGAIN</button>
      </div>
    </div>`;
  document.body.appendChild(results);

  // Shown over the tower, before the results card, so the offer lands while the
  // run just lost is still on screen. No timer: pressure would buy a few more
  // percent and cost more than that.
  const revive = document.createElement("div");
  revive.className = "revive-ask hidden";
  revive.innerHTML = `
    <div class="revive-card">
      <div class="revive-lost">YOU REACHED <b id="revive-depth">0</b> DEEP FOR <b id="revive-score">0</b></div>
      <button class="revive" id="revive-buy"></button>
      <button class="revive-no" id="revive-no">GAME OVER</button>
    </div>`;
  document.body.appendChild(revive);
  const reviveBuy = revive.querySelector<HTMLButtonElement>("#revive-buy")!;
  let offer: ReviveOffer | null = null;
  const closeRevive = (): void => {
    revive.classList.add("hidden");
    reviveBuy.disabled = false;
  };
  reviveBuy.addEventListener("click", () => {
    if (!offer || reviveBuy.disabled) return;
    // Locked while Telegram has the invoice open: a second tap buys twice.
    reviveBuy.disabled = true;
    void offer.buy().then((paid) => {
      if (paid) closeRevive();
      else reviveBuy.disabled = false;
    });
  });
  revive.querySelector<HTMLButtonElement>("#revive-no")!.addEventListener("click", () => {
    const declined = offer;
    closeRevive();
    declined?.decline();
  });


  // The board lives in its own overlay rather than inline: on the results card
  // it only added scroll height and still ended up below the fold.
  const boardView = document.createElement("div");
  boardView.className = "board-overlay hidden";
  boardView.innerHTML = `
    <div class="board-card">
      <div class="board-head"><span>LEADERBOARD</span><span class="bd-stat" id="bd-stat"></span><button id="board-close" aria-label="Close">✕</button></div>
      <div class="board-body" id="board-box"></div>
    </div>`;
  document.body.appendChild(boardView);
  const openBoard = (): void => {
    boardView.classList.remove("hidden");
    void renderBoard();
  };
  const closeBoard = (): void => boardView.classList.add("hidden");
  boardView.querySelector<HTMLButtonElement>("#board-close")!.addEventListener("click", closeBoard);
  // Tapping the backdrop closes it — on a phone the ✕ is a long reach.
  boardView.addEventListener("click", (e) => {
    if (e.target === boardView) closeBoard();
  });
  title.querySelector<HTMLButtonElement>("#title-board")!.addEventListener("click", openBoard);
  title.querySelector<HTMLButtonElement>("#title-shop")!.addEventListener("click", h.onShop);

  // The same card serves as the shop before a run, so the primary action is
  // whichever one makes sense: start the game, or drop again.
  let menuMode = false;
  const replayBtn = results.querySelector<HTMLButtonElement>("#res-replay")!;
  replayBtn.addEventListener("click", () => (menuMode ? startGame() : h.onReplay()));
  results.querySelector<HTMLButtonElement>("#res-board")!.addEventListener("click", openBoard);
  results.querySelector<HTMLButtonElement>("#res-home")!.addEventListener("click", h.onHome);
  // SHARE opens a picker rather than committing to one destination, because
  // where a result is worth posting is the player's call, not ours.
  const sharePick = document.createElement("div");
  sharePick.className = "board-overlay hidden";
  sharePick.innerHTML = `
    <div class="board-card share-card">
      <div class="board-head"><span>SHARE RESULT</span><button id="share-close" aria-label="Close">✕</button></div>
      <div class="share-body">
        <button class="share-opt" id="share-tg">${TG_ICON}<span>Telegram</span></button>
        <button class="share-opt" id="share-x">${X_ICON}<span>X</span></button>
      </div>
    </div>`;
  document.body.appendChild(sharePick);
  const closeShare = (): void => sharePick.classList.add("hidden");
  sharePick.querySelector<HTMLButtonElement>("#share-close")!.addEventListener("click", closeShare);
  sharePick.addEventListener("click", (e) => {
    if (e.target === sharePick) closeShare();
  });
  const tgOpt = sharePick.querySelector<HTMLButtonElement>("#share-tg")!;
  tgOpt.addEventListener("click", () => {
    closeShare();
    model?.share?.telegram?.();
  });
  sharePick.querySelector<HTMLButtonElement>("#share-x")!.addEventListener("click", () => {
    closeShare();
    model?.share?.x();
  });

  const shareBtn = results.querySelector<HTMLButtonElement>("#res-share")!;
  shareBtn.addEventListener("click", () => {
    // Telegram is only offered where it can work; X always can.
    tgOpt.classList.toggle("hidden", !model?.share?.telegram);
    sharePick.classList.remove("hidden");
  });

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
    // Empty means the perk table is exhausted: no NEXT line, and no upgrade
    // button either, because past the last row a level buys nothing at all.
    const next = m.level.nextText();
    const lb = el("level-box");
    lb.innerHTML = `
      <div class="lvl-head">
        <button class="lvl-name" id="lvl-tap" title="Tap to reveal reset">LEVEL <b>${lvl}</b></button>
        <button class="reset-link hidden" id="res-reset">RESET</button>
        ${next ? `<span class="lvl-next"><span>NEXT</span> ${next}</span>` : `<span class="lvl-max">MAX LEVEL</span>`}
      </div>
      ${next ? `<button id="lvl-buy" ${m.shop.bank < cost ? "disabled" : ""}>LEVEL UP — ${cost}</button>` : ""}`;
    lb.querySelector<HTMLButtonElement>("#lvl-buy")?.addEventListener("click", () => {
      if (m.level.buy()) renderPanels();
    });
    // Erasing everything is wanted about once in a lifetime, so it is not on
    // screen until asked for: tapping the level number reveals it, and it costs
    // no layout while hidden. Re-rendering the panel hides it again.
    const reset = lb.querySelector<HTMLButtonElement>("#res-reset")!;
    lb.querySelector<HTMLButtonElement>("#lvl-tap")!.addEventListener("click", () => {
      reset.classList.toggle("hidden");
    });
    reset.addEventListener("click", () => {
      if (confirm("Erase level, bank, boosters, skins and best score, and start over?")) h.onReset();
    });

    // Skins.
    // Skin swatches paint the REAL procedural pattern (owner: the menu was
    // showing flat colors while the ball had a pattern).
    const sr = el("skin-row");
    sr.innerHTML = "";
    let worn: HTMLElement | null = null;
    for (const id of m.skins.unlocked()) {
      const b = document.createElement("button");
      b.className = `skin${id === m.skins.current() ? " sel" : ""}`;
      b.title = SKINS[id]?.name ?? id;
      b.appendChild(skinSwatch(id));
      b.addEventListener("click", () => {
        m.skins.select(id);
        renderPanels();
      });
      sr.appendChild(b);
      if (id === m.skins.current()) worn = b;
    }
    // A collection outgrows the row, so the row scrolls — and the one being
    // worn has to be the one you are looking at when it opens. Set directly
    // rather than with scrollIntoView, which does nothing while the card is
    // still hidden, and which would drag the card itself up and down.
    if (worn) sr.scrollLeft = worn.offsetLeft - (sr.clientWidth - worn.offsetWidth) / 2;

    // Skins for sale.
    const sg = el("skin-grid");
    sg.innerHTML = "";
    for (const o of m.skins.forSale()) {
      const card = document.createElement("div");
      card.className = `skin-card ${o.rarity}${o.id === m.skins.current() ? " sel" : ""}`;
      card.appendChild(skinSwatch(o.id));
      const cap = document.createElement("span");
      cap.textContent = o.name;
      // Owned means the button wears it; unowned means it buys it. Outside
      // Telegram there is nobody to charge, so an unowned one is just shown.
      const act = document.createElement("button");
      act.className = "skin-act";
      act.textContent = o.owned ? (o.id === m.skins.current() ? "WORN" : "WEAR") : `${o.stars} ★`;
      act.disabled = !o.owned && !m.skins.buyable;
      act.addEventListener("click", () => {
        if (o.owned) {
          m.skins.select(o.id);
          renderPanels();
          return;
        }
        act.disabled = true;
        void m.skins.buy(o.id).then((ok) => {
          if (ok) renderPanels();
          else act.disabled = false;
        });
      });
      card.append(cap, act);
      // Gifting one you already own is most of the point, so the corner button
      // is on every card rather than only on the ones you have not bought.
      if (m.skins.buyable) {
        const gift = document.createElement("button");
        gift.className = "skin-gift";
        gift.title = `Gift ${o.name} — ${o.stars} ★`;
        gift.textContent = GIFT_GLYPH;
        gift.addEventListener("click", () => {
          gift.disabled = true;
          void m.skins.gift(o.id).then(() => {
            gift.disabled = false;
            renderPanels();
          });
        });
        card.appendChild(gift);
      }
      sg.appendChild(card);
    }

    // Gifts bought and not yet sent. Hidden entirely when there are none —
    // which is almost always — rather than sitting there as an empty heading.
    const gb = el("gift-box");
    const unsent = m.gifts.unsent();
    gb.classList.toggle("hidden", unsent.length === 0);
    gb.innerHTML = unsent.length ? `<div class="section-head">GIFTS TO SEND</div>` : "";
    for (const g of unsent) {
      const row = document.createElement("button");
      row.className = "gift-row";
      row.innerHTML = `<span>${GIFT_GLYPH} ${g.name}</span><b>SEND</b>`;
      row.addEventListener("click", () => m.gifts.share(g.code));
      gb.appendChild(row);
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
      // A locked booster is still a button where Stars can open it — otherwise
      // the shop shows you a thing you want and no way to want it.
      const stars = unlocked ? null : m.shop.unlockStars;
      btn.disabled = unlocked ? m.shop.bank < price : stars === null;
      btn.title = unlocked
        ? info.desc
        : stars === null
          ? `Unlocks at level ${m.shop.unlockLevel(id)}`
          : `${info.desc} — open it now for ${stars} Stars`;
      btn.innerHTML = unlocked
        ? `<span class="shop-icon">${info.svg}</span><b>${info.name}</b><span class="shop-price">${price}</span><span class="shop-owned">×${owned}</span>`
        : `<span class="shop-icon">${info.svg}</span><b>${info.name}</b><span class="shop-lock">LVL ${m.shop.unlockLevel(id)}</span>${
            stars === null ? "" : `<span class="shop-stars">${stars} ★</span>`
          }`;
      btn.addEventListener("click", () => {
        if (unlocked) {
          m.shop.buy(id);
          renderPanels();
          return;
        }
        if (stars === null || btn.disabled) return;
        btn.disabled = true; // one invoice at a time
        void m.shop.buyUnlock(id).then((ok) => {
          if (ok) renderPanels();
          else btn.disabled = false;
        });
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
    // Rerolling replaces the set and the progress with it, so it is offered in
    // the heading rather than under the rows a player is about to lose.
    const reroll =
      m.daily.rerollStars === null
        ? ""
        : `<button class="task-reroll" id="daily-reroll">NEW TASKS ${m.daily.rerollStars} ★</button>`;
    db.innerHTML = `<div class="section-head">DAILY TASKS${reroll}</div>${rows}`;
    db.querySelectorAll<HTMLButtonElement>(".task-claim").forEach((b) =>
      b.addEventListener("click", () => {
        m.daily.claim(b.dataset.id!);
        renderPanels();
      }),
    );
    const rr = db.querySelector<HTMLButtonElement>("#daily-reroll");
    rr?.addEventListener("click", () => {
      if (rr.disabled) return;
      rr.disabled = true; // one invoice at a time
      void m.daily.reroll().then((ok) => {
        if (ok) renderPanels();
        else rr.disabled = false;
      });
    });
  }

  // --- leaderboard ---------------------------------------------------------
  let myRank: SubmitResult | null = null;

  // Patterned skins carry rgb [1,1,1] — their colour lives in the pattern — so
  // a plain swatch made every one of them white. Draw the real skin once per
  // id and reuse the data URL down the whole list.
  const dotCache = new Map<string, string>();
  const skinDot = (id: string): string => {
    let url = dotCache.get(id);
    if (url === undefined) {
      const c = document.createElement("canvas");
      c.width = c.height = 28;
      const ctx = c.getContext("2d");
      if (ctx && SKINS[id]) {
        drawSkin(ctx, id, 28);
        url = c.toDataURL();
      } else {
        url = "";
      }
      dotCache.set(id, url);
    }
    const style = url ? `background-image:url(${url})` : "background:#4a5a7d";
    return `<i class="bd-dot" style="${style}"></i>`;
  };

  const paintRank = (): void => {
    const line = document.getElementById("bd-me");
    if (!line) return;
    line.classList.toggle("hidden", !myRank);
    if (!myRank) return;
    const place = myRank.rank ? `#${myRank.rank}` : "unranked";
    line.innerHTML = `YOU <b>${place}</b> · best <b>${myRank.best}</b> · total <b>${myRank.total}</b>`;
  };

  // Names come from other people's Telegram profiles, so they are stripped
  // before they ever reach innerHTML.
  const safe = (t: string): string => t.replace(/[<>&"]/g, "").slice(0, 24);

  const boardRow = (r: BoardRow, i: number): string =>
    `<div class="bd-row"><span class="bd-rank">${i + 1}</span>${skinDot(r.skin)}` +
    `<span class="bd-name">${safe(r.name)}</span>` +
    `<span class="bd-lvl">L${r.level}</span><b class="bd-best">${r.best}</b>` +
    `<span class="bd-total">${r.total}</span><span class="bd-runs">${r.runs}</span></div>`;

  async function renderBoard(): Promise<void> {
    const box = document.getElementById("board-box");
    if (!box) return;
    box.innerHTML = `<div class="bd-wait">loading…</div>`;
    const b = await fetchBoard();
    if (!box.isConnected) return;
    if (!b) {
      box.innerHTML = ""; // offline, or no board deployed — not worth an error
      return;
    }
    const stat = document.getElementById("bd-stat");
    if (stat) stat.textContent = `${b.players} players · ${b.runs} runs`;
    box.innerHTML =
      `<div class="bd-me hidden" id="bd-me"></div>` +
      (b.rows.length
        ? `<div class="bd-row bd-head"><span class="bd-rank">#</span><i class="bd-dot"></i>` +
          `<span class="bd-name">player</span><span class="bd-lvl">lvl</span>` +
          `<b class="bd-best">best</b><span class="bd-total">total</span>` +
          `<span class="bd-runs">runs</span></div>` +
          b.rows.map(boardRow).join("")
        : `<div class="bd-wait">nobody has ranked yet — be first</div>`);
    paintRank();
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
    setJump(charges, maxCharges, cooldownS) {
      const chip = el("hud-jump");
      const ready = charges > 0;
      chip.textContent = ready ? (maxCharges > 1 ? `⤒ ${charges}` : "⤒") : `⤒ ${cooldownS.toFixed(1)}s`;
      chip.classList.toggle("ready", ready);
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
        btn.innerHTML = `<span class="b-icon">${info.svg}</span><span class="b-count">${state || "×" + owned}</span>${isTouch() ? "" : `<span class="b-key">${i + 1}</span>`}`;
        btn.addEventListener("click", () => h.onActivate(id));
        bar.appendChild(btn);
      });
    },
    showBiome(name) {
      biomeBanner.textContent = name;
      biomeBanner.classList.remove("show");
      void biomeBanner.offsetWidth; // restart the animation
      biomeBanner.classList.add("show");
    },
    // Opened from the title screen: everything the results card carries EXCEPT
    // the run that did not happen — level, skins, shop, daily tasks.
    askRevive(o) {
      offer = o;
      el("revive-depth").textContent = String(o.depth);
      el("revive-score").textContent = String(o.score);
      reviveBuy.innerHTML = `CONTINUE RUN <b>${o.stars} ★</b>`;
      revive.classList.remove("hidden");
    },
    showMenu(r) {
      model = r;
      menuMode = true;
      replayBtn.textContent = "PLAY";
      // The title has to step aside, or the two cards stack and neither reads.
      // The back arrow brings it back through onHome -> showTitle.
      title.classList.add("gone");
      document.body.classList.remove("titlescreen");
      document.body.classList.add("menu-mode", "gameover");
      // Shown BEFORE it is filled: renderPanels measures the skin row to scroll
      // the worn one into the middle, and a hidden element measures zero.
      // Nothing paints between these two statements, so there is no flash.
      results.classList.remove("hidden");
      renderPanels();
    },
    showTitle() {
      renderAccount();
      title.classList.remove("gone");
      document.body.classList.add("titlescreen");
    },
    setRank(sub) {
      myRank = sub;
      paintRank();
    },
    showResults(r) {
      menuMode = false;
      replayBtn.textContent = "DROP AGAIN";
      document.body.classList.remove("menu-mode");
      model = r;
      el("res-score").textContent = String(r.score);
      el("res-depth").textContent = String(r.depth);
      el("res-broken").textContent = String(r.broken);
      el("res-combo").textContent = String(r.maxCombo);
      el("res-best").textContent = `${r.bestScore} · depth ${r.bestDepth}`;
      el("res-newbest").classList.toggle("hidden", !r.newBest);

      document.body.classList.add("gameover"); // hides jump/booster bar
      results.classList.remove("hidden"); // before renderPanels — see showMenu
      renderPanels();
    },
    hideResults() {
      closeRevive();
      closeBoard();
      closeShare();
      menuMode = false;
      document.body.classList.remove("menu-mode");
      results.classList.add("hidden");
      document.body.classList.remove("gameover");
      model = null;
    },
  };
}
