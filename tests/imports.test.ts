// Vercel transpiles the API function file by file instead of bundling it, and
// Node's ESM loader does not guess extensions. An extensionless relative import
// anywhere in the graph the function reaches therefore crashes it on import —
// which is exactly how the leaderboard shipped returning 500 to every request
// while every local test stayed green, because the local dev server resolves through a
// bundler and hides it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SHIPPED = ["src", "api"];

function relativeImports(dir: string): string[] {
  const bad: string[] = [];
  for (const f of readdirSync(join(__dirname, "..", dir))) {
    if (!f.endsWith(".ts")) continue;
    const src = readFileSync(join(__dirname, "..", dir, f), "utf8");
    for (const m of src.matchAll(/from\s+"(\.\.?\/[^"]+)"/g)) {
      const spec = m[1];
      const tail = spec.slice(spec.lastIndexOf("/") + 1);
      if (!tail.includes(".")) bad.push(`${dir}/${f}: ${spec}`);
    }
  }
  return bad;
}

describe("shipped modules", () => {
  it("give every relative import an explicit extension", () => {
    expect(SHIPPED.flatMap(relativeImports)).toEqual([]);
  });
});
