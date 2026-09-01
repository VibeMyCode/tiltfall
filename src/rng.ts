// Seeded randomness (§5.4): the sim and levelgen draw ONLY from these streams.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a — string → uint32 (share codes, date seeds, stream names).
export function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Named stream: adding a draw in one stream never shifts another (§5.4).
export function stream(name: string, seed: number): () => number {
  return mulberry32(hash(name) ^ seed);
}

// Daily seed from a UTC date string "YYYY-MM-DD" (injected, never from Date).
export function dateSeed(dateStr: string): number {
  return hash(dateStr.replace(/-/g, ""));
}
