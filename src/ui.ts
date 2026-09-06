// DOM HUD + jump button + booster bar + game-over overlay with level,
// skins, shop and daily tasks (§2: plain HTML/CSS).
import { CONFIG } from "./config.js";
import { BOOSTER_INFO, BOOSTER_ORDER, boosterPrice, type BoosterId } from "./boosters.js";
import { isTouch } from "./input.js";
import { fetchBoard, type BoardRow, type SubmitResult } from "./board.js";
import type { DailyTask } from "./meta.js";
import { SKINS, drawSkin, skinImage, skinThumb, type Rarity } from "./skins.js";
import { backButton } from "./telegram.js";

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
const GIFT_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="3.2" y="10.6" width="17.6" height="9.8" rx="1.6" fill="currentColor" opacity=".5"/>' +
  '<rect x="2.2" y="6.6" width="19.6" height="4.6" rx="1.4" fill="currentColor"/>' +
  '<path d="M12 6.6v13.8" fill="none" stroke="#151d33" stroke-width="2.1"/>' +
  '<path d="M12 6.6C10.4 3.2 6.2 3.4 6.6 5.8 6.9 7.6 10 7 12 6.6zm0 0c1.6-3.4 5.8-3.2 5.4-.8-.3 1.8-3.4 1.2-5.4.8z" ' +
  'fill="currentColor"/></svg>';

const LEVEL_ICON =
  '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M12 3.2 14.7 9l6.3.7-4.7 4.3 1.3 6.2L12 17.1 6.4 20.2l1.3-6.2L3 9.7 9.3 9z" fill="currentColor"/></svg>';

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PREVIEW = 96;
const PREVIEW_BIG = 256; // the sheet shows one ball large, so it gets a real one

function projectBall(src: CanvasImageSource, size: number, polar: boolean): HTMLCanvasElement {
  const TEX = size; // sampling at the output size: no cheaper, and no softer
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const octx = out.getContext("2d");
  const tmp = document.createElement("canvas");
  tmp.width = TEX;
  tmp.height = TEX;
  const tctx = tmp.getContext("2d");
  if (!octx || !tctx) return out;
  tctx.drawImage(src, 0, 0, TEX, TEX);
  const tex = tctx.getImageData(0, 0, TEX, TEX).data;
  const img = octx.createImageData(size, size);
  const R = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - R + 0.5) / R;
      const dy = (y - R + 0.5) / R;
      const r = Math.hypot(dx, dy);
      if (r > 1) continue; // outside the ball stays transparent
      const w = Math.sqrt(1 - r * r); // toward the viewer
      // t is the texture row, u the column. The bottom of the sheet is the pole
      // (Babylon's sphere runs V bottom-up), which is why t counts back from 1.
      let t: number;
      let u: number;
      if (polar) {
        // Pole facing the viewer: every column meets at the centre.
        t = 1 - Math.asin(r) / Math.PI;
        u = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1;
      } else {
        // Equator facing the viewer. A pole-on view puts the ONE point where
        // all the columns converge dead centre, so the worst deformation in the
        // whole mapping lands where the eye goes first. Here the centre sits at
        // sin(theta) = 1, the widest and least squeezed latitude there is, and
        // the visible half spans u 0.25..0.75 — which also hides the seam
        // behind the silhouette instead of running it out of the middle.
        t = 1 - Math.acos(Math.max(-1, Math.min(1, -dy))) / Math.PI;
        u = Math.atan2(dx, w) / (2 * Math.PI) + 0.5;
      }
      const sx = Math.min(TEX - 1, (u * TEX) | 0);
      const sy = Math.min(TEX - 1, (t * TEX) | 0);
      // Brightness falls off toward the rim, or a sphere reads as a sticker.
      const k = 0.55 + 0.45 * w;
      const o = (y * size + x) * 4;
      const p = (sy * TEX + sx) * 4;
      img.data[o] = tex[p] * k;
      img.data[o + 1] = tex[p + 1] * k;
      img.data[o + 2] = tex[p + 2] * k;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// Procedural skins draw themselves; the painted ones have a 128px thumbnail,
// which is what those were generated for. The painted ones arrive late, so the
// swatch is a host element the projection drops into once the file has decoded.
function skinSwatch(id: string, big = false): HTMLElement {
  const size = big ? PREVIEW_BIG : PREVIEW;
  const polar = SKINS[id]?.polar === true;
  const host = document.createElement("span");
  host.className = "swatch";
  // The grid uses the 128px thumbnails; the sheet, which shows one ball at
  // four times that, pulls the full-size master instead of upscaling a thumb.
  const url = big ? skinImage(id) : skinThumb(id);
  if (!url) {
    const cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d");
    if (ctx) drawSkin(ctx, id, size);
    host.appendChild(projectBall(cv, size, polar));
    return host;
  }
  const img = new Image();
  img.src = url;
  void img
    .decode()
    .then(() => host.appendChild(projectBall(img, size, polar)))
    .catch(() => {});
  return host;
}

export interface SkinOffer {
  id: string;
  name: string;
  // Null for the skins levels hand out: those are not for sale at any price.
  rarity: Rarity | null;
  stars: number;
  owned: boolean;
  // The level that grants it, for a free skin not reached yet. The store shows
  // the whole catalogue, so a locked one says what it is waiting for.
  needsLevel: number | null;
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
  // Why the last purchase did not go through, or null. Read only after a buy
  // has come back false.
  payError: () => string | null;
  skins: {
    current: () => string;
    select: (id: string) => void;
    catalogue: () => SkinOffer[];
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
  showStore: (r: ResultsModel) => void;
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
  onStore: () => void;
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
      <button id="title-store" class="title-board">${SHOP_ICON}<span>SKIN STORE</span></button>
      <button id="title-shop" class="title-board">${LEVEL_ICON}<span>BOOSTERS &amp; LEVEL</span></button>
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
        <button class="store-row" id="res-store">
          <span class="store-row-ball" id="res-store-ball"></span>
          <span class="store-row-text"><i>ball</i><b id="res-store-name">CORE</b></span>
          <span class="store-row-go">STORE ${CHEVRON}</span>
        </button>
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
  // Bound late: the store is built further down, after el() exists.
  title.querySelector<HTMLButtonElement>("#title-store")!.addEventListener("click", h.onStore);

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

  // --- the store -------------------------------------------------------------
  // Its own screen rather than a section of the pause card: twenty-four balls
  // inline made a wall of ~100x80 cards whose only hit area was a 12px price
  // line, so a tap landed about one time in five.
  const storeView = document.createElement("div");
  storeView.className = "store-overlay hidden";
  storeView.innerHTML = `
    <div class="store-card">
      <div class="store-head">
        <button id="store-back" aria-label="Back">${HOME_ICON}</button>
        <span class="store-title">STORE</span>
        <span class="store-worn"><span class="store-worn-ball" id="store-worn-ball"></span></span>
      </div>
      <div class="store-filters" id="store-filters"></div>
      <div class="store-body">
        <div class="store-grid" id="store-grid"></div>
        <div class="gift-box hidden" id="gift-box"></div>
      </div>
    </div>
    <div class="sheet hidden" id="skin-sheet">
      <div class="sheet-card">
        <div class="sheet-grab"></div>
        <div class="sheet-ball" id="sheet-ball"></div>
        <div class="sheet-name" id="sheet-name"></div>
        <div class="sheet-sub" id="sheet-sub"></div>
        <button class="sheet-main" id="sheet-main"></button>
        <button class="sheet-gift" id="sheet-gift">${GIFT_ICON}<span id="sheet-gift-label"></span></button>
        <p class="sheet-note" id="sheet-note"></p>
      </div>
    </div>`;
  document.body.appendChild(storeView);

  type Filter = "all" | "owned" | Rarity;
  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "ALL" },
    { id: "owned", label: "MINE" },
    { id: "common", label: "COMMON" },
    { id: "rare", label: "RARE" },
    { id: "epic", label: "EPIC" },
    { id: "legendary", label: "LEGEND" },
  ];
  let filter: Filter = "all";
  let sheetSkin: SkinOffer | null = null;

  const closeSheet = (): void => {
    sheetSkin = null;
    el("skin-sheet").classList.add("hidden");
  };

  function openSheet(o: SkinOffer): void {
    sheetSkin = o;
    const ball = el("sheet-ball");
    ball.innerHTML = "";
    ball.appendChild(skinSwatch(o.id, true));
    el("sheet-name").textContent = o.name;
    el("sheet-sub").textContent = o.rarity
      ? `${o.rarity.toUpperCase()} · ${o.stars} ★`
      : o.needsLevel
        ? `UNLOCKS AT LEVEL ${o.needsLevel}`
        : "FREE · EARNED BY LEVEL";

    const worn = o.id === model?.skins.current();
    const main = el("sheet-main") as HTMLButtonElement;
    main.className = `sheet-main ${o.rarity ?? "free"}`;
    // EQUIPPED, not WORN: "worn" reads as worn-out to most players.
    main.textContent = worn ? "EQUIPPED" : o.owned ? "EQUIP" : o.needsLevel ? `LEVEL ${o.needsLevel}` : `BUY · ${o.stars} ★`;
    main.disabled = worn || (!o.owned && (o.needsLevel !== null || !model?.skins.buyable));

    // Gifting one you already own is most of the point, so this stays offered
    // for owned skins too. Free skins cannot be gifted: there is nothing to buy.
    const gift = el("sheet-gift") as HTMLButtonElement;
    const giftable = o.rarity !== null && model?.skins.buyable === true;
    gift.classList.toggle("hidden", !giftable);
    el("sheet-gift-label").textContent = `GIFT IT · ${o.stars} ★`;
    gift.disabled = false;
    // Telegram has no recipient picker for this, so the ordering is spelled out
    // BEFORE any money moves — otherwise the buyer taps GIFT expecting to
    // choose a friend and finds they have bought it for themselves.
    // A dead BUY button with no reason given reads as a broken game.
    el("sheet-note").textContent = giftable
      ? "A gift is paid for first. Telegram then opens your chat list so you can send it — the link works once, for whoever opens it."
      : o.needsLevel
        ? `Reach level ${o.needsLevel} and this one is yours.`
        : o.owned || model?.skins.buyable
          ? ""
          : "Skins are bought with Telegram Stars — open TILTFALL inside Telegram to buy one.";
    el("skin-sheet").classList.remove("hidden");
  }

  function renderStore(): void {
    if (!model) return;
    const m = model;
    const wb = el("store-worn-ball");
    wb.innerHTML = "";
    wb.appendChild(skinSwatch(m.skins.current()));

    const fb = el("store-filters");
    fb.innerHTML = "";
    for (const f of FILTERS) {
      const chip = document.createElement("button");
      chip.className = `chip${f.id === filter ? " on" : ""}`;
      chip.textContent = f.label;
      chip.addEventListener("click", () => {
        filter = f.id;
        renderStore();
      });
      fb.appendChild(chip);
    }

    const grid = el("store-grid");
    grid.innerHTML = "";
    const shown = m.skins
      .catalogue()
      .filter((o) => (filter === "all" ? true : filter === "owned" ? o.owned : o.rarity === filter));
    for (const o of shown) {
      const worn = o.id === m.skins.current();
      // The WHOLE card is the button. Anything else and the ball — the one
      // thing a player aims at — is dead to the touch.
      const card = document.createElement("button");
      card.className = `sk ${o.rarity ?? "free"}${worn ? " sel" : ""}${o.needsLevel ? " locked" : ""}`;
      card.appendChild(skinSwatch(o.id));
      const name = document.createElement("span");
      name.className = "sk-name";
      name.textContent = o.name;
      const tag = document.createElement("b");
      tag.textContent = worn ? "EQUIPPED" : o.owned ? "EQUIP" : o.needsLevel ? `LVL ${o.needsLevel}` : `${o.stars} ★`;
      card.append(name, tag);
      card.addEventListener("click", () => openSheet(o));
      grid.appendChild(card);
    }
    if (!shown.length) {
      grid.innerHTML = '<p class="store-empty">Nothing here yet.</p>';
    }

    // Gifts bought and not yet handed over. A share sheet dismissed by accident
    // must not lose a 250-Star purchase, so the link stays here.
    const gb = el("gift-box");
    const unsent = m.gifts.unsent();
    gb.classList.toggle("hidden", unsent.length === 0);
    gb.innerHTML = unsent.length ? `<div class="section-head">GIFTS TO SEND</div>` : "";
    for (const g of unsent) {
      const row = document.createElement("button");
      row.className = "gift-row";
      row.innerHTML = `<span>${GIFT_ICON} ${g.name}</span><b>SEND</b>`;
      row.addEventListener("click", () => m.gifts.share(g.code));
      gb.appendChild(row);
    }
  }

  // Reachable from the title, where no run has happened and there is no model
  // yet, so the caller hands one in.
  const openStore = (r?: ResultsModel): void => {
    if (r) model = r;
    storeView.classList.remove("hidden");
    renderStore();
    // The store fills the screen, so in Telegram its header sits under the
    // client's own controls; the native back arrow is always reachable. It
    // peels one layer at a time: the sheet first, then the store.
    backButton(() => (sheetSkin ? closeSheet() : closeStore()));
  };
  const closeStore = (): void => {
    closeSheet();
    storeView.classList.add("hidden");
    backButton(null);
  };
  storeView.querySelector<HTMLButtonElement>("#store-back")!.addEventListener("click", closeStore);
  // The sheet's backdrop is the store behind it; tapping it closes the sheet
  // only, which is what a bottom sheet is expected to do.
  el("skin-sheet").addEventListener("click", (e) => {
    if (e.target === el("skin-sheet")) closeSheet();
  });

  el("sheet-main").addEventListener("click", () => {
    const o = sheetSkin;
    if (!o || !model) return;
    if (o.owned) {
      model.skins.select(o.id);
      closeSheet();
      renderStore();
      renderPanels();
      return;
    }
    const btn = el("sheet-main") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "…";
    void model.skins.buy(o.id).then((ok) => {
      if (!ok) {
        // Put the price back AND say what went wrong: a button that resets
        // itself in silence is indistinguishable from a button that is dead.
        openSheet(o);
        const why = model?.payError();
        if (why) el("sheet-note").textContent = why;
        return;
      }
      closeSheet();
      renderStore();
      renderPanels();
    });
  });

  el("sheet-gift").addEventListener("click", () => {
    const o = sheetSkin;
    if (!o || !model) return;
    const btn = el("sheet-gift") as HTMLButtonElement;
    btn.disabled = true;
    void model.skins.gift(o.id).then((ok) => {
      btn.disabled = false;
      if (!ok) {
        const why = model?.payError();
        if (why) el("sheet-note").textContent = why;
        return;
      }
      // Silent success reads as a failure, and the share sheet may have been
      // dismissed — so say where the gift went.
      el("sheet-note").textContent = "Bought. Pick the friend in Telegram — or send it later from GIFTS TO SEND below the store.";
      renderStore();
      renderPanels();
    });
  });


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
    // Skins live in their own screen now: twenty-four balls inside the pause
    // card were a wall of tiny targets, and this row is the way in.
    const wornBall = el("res-store-ball");
    wornBall.innerHTML = "";
    wornBall.appendChild(skinSwatch(m.skins.current()));
    el("res-store-name").textContent = SKINS[m.skins.current()]?.name ?? "";
    (el("res-store") as HTMLButtonElement).onclick = () => openStore();

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

  // The HUD is fed every frame. Writing a text node the browser already shows
  // still dirties layout, so each chip is touched only when its text changes.
  const hudTime = el("hud-time");
  const hudScore = el("hud-score");
  const hudDepth = el("hud-depth");
  const hudShield = el("hud-shield");
  const hudCombo = el("hud-combo");
  const hudJump = el("hud-jump");
  const setText = (node: HTMLElement, text: string): boolean => {
    if (node.textContent === text) return false;
    node.textContent = text;
    return true;
  };

  return {
    setHud(timeS, score, combo, depth, shields) {
      setText(hudTime, `${timeS.toFixed(1)}s`);
      setText(hudScore, String(score));
      setText(hudDepth, `◈ ${depth}`);
      setText(hudShield, `⛨ ${shields}`);
      // Class toggles are not gated on the text: a toggle that changes nothing
      // is free, and the initial markup already carries the first text.
      hudShield.classList.toggle("hidden", shields <= 0);
      setText(hudCombo, `×${combo}`);
      hudCombo.classList.toggle("hot", combo >= 4);
      if (combo > lastCombo) {
        hudCombo.classList.remove("pop");
        void hudCombo.offsetWidth;
        hudCombo.classList.add("pop");
      }
      lastCombo = combo;
    },
    setJump(charges, maxCharges, cooldownS) {
      const ready = charges > 0;
      setText(hudJump, ready ? (maxCharges > 1 ? `⤒ ${charges}` : "⤒") : `⤒ ${cooldownS.toFixed(1)}s`);
      hudJump.classList.toggle("ready", ready);
    },
    setBoosterBar(inventory, armed, runOn) {
      let key = "";
      for (const id of BOOSTER_ORDER) key += `${inventory[id] ?? 0}${armed[id] ? "a" : ""}${runOn[id] ? "r" : ""},`;
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
    showStore(r) {
      openStore(r);
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
