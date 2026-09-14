// Client half of the leaderboard. Holds the two-phase submit so neither the
// game loop nor the UI has to know about it.
//
// Phase one posts the score alone. Only if the server says the run would rank
// does phase two build and upload the proof — which is the whole point: the
// proof is tens of kilobytes, and most runs never need one.
import type { RunProof } from "./replay.js";

const API = "/api/board";

export interface BoardRow {
  uid: string;
  name: string;
  level: number;
  skin: string;
  best: number;
  total: number;
  runs: number;
  depth: number;
}

export interface Board {
  rows: BoardRow[];
  players: number;
  runs: number;
}

export interface SubmitResult {
  verified: boolean;
  best: number;
  total: number;
  rank: number | null;
}

export interface RunReport {
  initData: string;
  score: number;
  depth: number;
  level: number;
  skin: string;
  env?: string; // client + CloudStorage health, see telegram.ts clientEnv
}

// Every call is best-effort: a leaderboard that is down must never be able to
// interrupt a run or block the results card.
async function post(body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function fetchBoard(): Promise<Board | null> {
  try {
    const r = await fetch(API);
    if (!r.ok) return null;
    return (await r.json()) as Board;
  } catch {
    return null;
  }
}

// A thunk, so the encoding cost is paid only when the server asks — and an
// array, because a run continued with Stars is several segments and the server
// recounts every one of them.
export async function submitRun(report: RunReport, proofs: () => RunProof[]): Promise<SubmitResult | null> {
  let res = await post(report);
  if (res?.needProof) res = await post({ ...report, proofs: proofs() });
  if (!res || !res.ok) return null;
  return {
    verified: Boolean(res.verified),
    best: Number(res.best ?? 0),
    total: Number(res.total ?? 0),
    rank: res.rank === null || res.rank === undefined ? null : Number(res.rank),
  };
}

// Called when the player erases their progress: without it the board would go
// on ranking a score they no longer have. Bounded so a dead network cannot
// hold the wipe hostage.
export async function resetBoard(initData: string): Promise<void> {
  try {
    await Promise.race([
      fetch(API, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData }),
      }),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    // offline, or outside Telegram — the local wipe still goes ahead
  }
}

// --- attribution ------------------------------------------------------------
// Which link this open came from. In Telegram the deep-link payload wins
// (startapp=ads1 -> "ads1"; r_/g_ carry ids, so they collapse to "r"/"g") and a
// bare open is "tg". On the web ?src= wins, then the referrer host, else "web".
// ponytail: counts opens, not people — PFADD the uid if uniques start to matter.
export function sourceTag(startParam: string | null, search: string, referrer: string, telegram: boolean): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, 32);
  if (telegram) return startParam ? clean(startParam.replace(/^([gr])_.*/, "$1")) : "tg";
  const src = new URLSearchParams(search).get("src");
  if (src) return clean(src);
  try {
    if (referrer) return clean(new URL(referrer).hostname);
  } catch {
    // malformed referrer — fall through to the bare tag
  }
  return "web";
}

export function trackOpen(tag: string): void {
  void post({ hit: tag });
}

// Asks the bot to prepare the share card (photo, caption, PLAY button with this
// player's invite link) and returns its id for WebApp.shareMessage.
export async function prepareShare(initData: string, score: number, depth: number): Promise<string | null> {
  const r = await post({ initData, share: { score, depth } });
  return r?.ok && typeof r.id === "string" ? r.id : null;
}

// --- referrals --------------------------------------------------------------
// The Telegram boot call: names who invited this player (from startapp=r_<uid>,
// honoured once per account) and collects what earlier invitees have earned.
// Coins are client-side like every other coin, so the server only says how many.
export interface BootResult {
  welcome: number; // this open was a first visit via an invite link
  paid: number; // invitees who finished a first run since the last boot
  invited: number; // lifetime count, for the account card
}

export async function bootTelegram(initData: string, ref?: string): Promise<BootResult | null> {
  const r = await post({ initData, boot: true, ref });
  if (!r?.ok) return null;
  return { welcome: Number(r.welcome ?? 0), paid: Number(r.paid ?? 0), invited: Number(r.invited ?? 0) };
}
