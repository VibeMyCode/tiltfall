// Telegram Mini App integration — optional by design: outside Telegram every
// function no-ops and the game behaves exactly as before.
interface TgHaptic {
  impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred: (type: "error" | "success" | "warning") => void;
}
interface TgCloud {
  getItem: (k: string, cb: (err: unknown, v?: string) => void) => void;
  setItem: (k: string, v: string, cb?: (err: unknown, ok?: boolean) => void) => void;
}
interface TgWebApp {
  initData?: string;
  ready: () => void;
  expand: () => void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  enableClosingConfirmation?: () => void;
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string, opts?: { try_instant_view?: boolean }) => void;
  openInvoice?: (url: string, cb: (status: "paid" | "cancelled" | "failed" | "pending") => void) => void;
  shareMessage?: (id: string, cb?: (ok: boolean) => void) => void;
  initDataUnsafe?: { user?: { id: number; first_name?: string; username?: string } };
  HapticFeedback?: TgHaptic;
  CloudStorage?: TgCloud;
  viewportStableHeight?: number;
  platform?: string;
  version?: string;
}

const tg = (): TgWebApp | undefined => (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;

// The SDK also loads in a plain browser (a v6.0 stub with empty initData) —
// only a real client fills initData, and only there may we call its methods.
export const inTelegram = (): boolean => Boolean(tg()?.initData);

// Every Telegram method is optional AND can throw on older clients
// ("WebAppMethodUnsupported"), so each call is individually guarded.
function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // unsupported on this client version — ignore
  }
}

export function initTelegram(): void {
  const app = tg();
  if (!app || !inTelegram()) return;
  attempt(() => app.ready());
  attempt(() => app.expand());
  attempt(() => app.requestFullscreen?.()); // newer clients: true fullscreen
  attempt(() => app.disableVerticalSwipes?.()); // dragging must not close the app
  attempt(() => app.setHeaderColor?.("#0b1020"));
  attempt(() => app.setBackgroundColor?.("#0b1020"));
  document.body.classList.add("in-telegram");
}

// The signed blob the server checks to learn who is submitting. Only a real
// Telegram client fills it, so outside Telegram there is nobody to identify
// and the leaderboard simply stays read-only.
export const initDataRaw = (): string | null => tg()?.initData || null;

// Opens a Stars invoice and resolves once Telegram says what happened. Only
// "paid" is a yes; "pending" is not, because a purchase that has not completed
// must not hand anything over.
export function payWithStars(link: string): Promise<boolean> {
  const app = tg();
  if (!app?.openInvoice) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    // A closed WebView or a client that never calls back must not leave the
    // player staring at a dead button.
    setTimeout(() => finish(false), 120_000);
    attempt(() => app.openInvoice!(link, (status) => finish(status === "paid")));
  });
}

export function playerName(): string | null {
  const u = tg()?.initDataUnsafe?.user;
  return u ? (u.first_name ?? u.username ?? null) : null;
}

// Haptics: the phone should FEEL the smashes (Telegram-only bonus).
export const haptic = {
  hit: () => attempt(() => tg()?.HapticFeedback?.impactOccurred("light")),
  boom: () => attempt(() => tg()?.HapticFeedback?.impactOccurred("heavy")),
  death: () => attempt(() => tg()?.HapticFeedback?.notificationOccurred("error")),
  win: () => attempt(() => tg()?.HapticFeedback?.notificationOccurred("success")),
};

// CloudStorage mirrors progress across the player's devices; localStorage
// stays the source of truth so the game works outside Telegram too.
// Telegram accepts only A-Z, a-z, 0-9, _ and - in a CloudStorage key. Our keys
// are named "tf.bank" and friends, so EVERY write was rejected — and setItem
// reports through its callback rather than by throwing, so attempt() never saw
// it and the failure was completely silent. Nothing was ever stored in the
// cloud, which is why syncing between devices never worked.
export const cloudKey = (k: string): string => k.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);

// Last error Telegram reported, so a failure is diagnosable instead of silent.
// Exposed through __tf.cloud().
let cloudErr: string | null = null;
export const cloudError = (): string | null => cloudErr;

export function cloudSave(key: string, value: string): void {
  if (!inTelegram()) return; // the browser stub logs an error for every call
  attempt(() =>
    tg()?.CloudStorage?.setItem(cloudKey(key), value, (err) => {
      if (err) cloudErr = `setItem ${cloudKey(key)}: ${String(err)}`;
    }),
  );
}

export function cloudLoad(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cs = inTelegram() ? tg()?.CloudStorage : undefined;
    if (!cs) {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (v: string | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    setTimeout(() => finish(null), 1500); // never block boot on the network
    cs.getItem(cloudKey(key), (err, v) => {
      if (err) cloudErr = `getItem ${cloudKey(key)}: ${String(err)}`;
      finish(err ? null : (v ?? null));
    });
  });
}

const brag = (score: number, depth: number) => `TILTFALL: ${score} points, depth ${depth}.\nBeat me!`;

// Share into a Telegram chat — the link is the Mini App, so a tap lands the
// reader in the game rather than in a chat with the bot.
export function shareTelegram(score: number, depth: number, appUrl: string): void {
  const app = tg();
  const url = `https://t.me/share/url?url=${encodeURIComponent(appUrl)}&text=${encodeURIComponent(brag(score, depth))}`;
  if (app?.openTelegramLink) app.openTelegramLink(url);
  else window.open(url, "_blank");
}

// Share to X. The intent opens the composer already filled in — the reader
// only has to press Post.
//
// One link, the Mini App. A browser link was offered alongside it and the post
// came out nonsense: X appends `url` AFTER the text, so the label written for
// the web link ended up sitting above BOTH, and the link that actually matters
// read as an afterthought under a heading meant for the other one.
//
// Inside Telegram the intent has to be handed to openLink, or it would try to
// open inside the Mini App itself.
export function shareX(score: number, depth: number, appUrl: string): void {
  const url =
    `https://x.com/intent/post?text=${encodeURIComponent(brag(score, depth))}` +
    `&url=${encodeURIComponent(appUrl)}`;
  const app = tg();
  if (inTelegram() && app?.openLink) app.openLink(url);
  else window.open(url, "_blank", "noopener");
}
