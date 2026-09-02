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
export function cloudSave(key: string, value: string): void {
  if (!inTelegram()) return; // the browser stub logs an error for every call
  attempt(() => tg()?.CloudStorage?.setItem(key, value));
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
    cs.getItem(key, (err, v) => finish(err ? null : (v ?? null)));
  });
}

// Share a result into a chat (uses the bot's deep link).
export function shareScore(score: number, depth: number, botUrl: string): void {
  const app = tg();
  const text = encodeURIComponent(`TILTFALL: ${score} points, depth ${depth}. Beat me!`);
  const url = `https://t.me/share/url?url=${encodeURIComponent(botUrl)}&text=${text}`;
  if (app?.openTelegramLink) app.openTelegramLink(url);
  else window.open(url, "_blank");
}
