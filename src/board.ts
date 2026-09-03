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

// `proof` is a thunk so the encoding cost is paid only when the server asks.
export async function submitRun(report: RunReport, proof: () => RunProof): Promise<SubmitResult | null> {
  let res = await post(report);
  if (res?.needProof) res = await post({ ...report, proof: proof() });
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
