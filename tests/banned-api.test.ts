// §5.4: deterministic modules must never touch wall-clock, unseeded
// randomness, or transcendental Math (implementation-approximated per
// ECMA-262 — results differ across JS engines).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DETERMINISTIC_FILES = ["sim.ts", "levelgen.ts", "rng.ts", "config.ts"];
const BANNED =
  /Math\.random|Date\.|performance\.now|Math\.(sin|cos|tan|atan2?|asin|acos|pow|exp|log2?|log10|cbrt|sinh|cosh|tanh)\b/;

describe("banned APIs stay out of deterministic modules", () => {
  for (const file of DETERMINISTIC_FILES) {
    it(file, () => {
      const src = readFileSync(join(__dirname, "..", "src", file), "utf8");
      const lines = src.split("\n");
      const hits = lines
        .map((line, i) => ({ line: line.replace(/\/\/.*$/, ""), i })) // comments may NAME banned APIs
        .filter(({ line }) => BANNED.test(line))
        .map(({ line, i }) => `${file}:${i + 1}: ${line.trim()}`);
      expect(hits).toEqual([]);
    });
  }
});
