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

// Every source file an API handler reaches through relative imports. The
// functions are bundled for Node, so anything in this graph that only exists
// in a Vite browser build (import.meta.env, window, document) crashes the
// function on import — which is exactly how a one-line itch.io tweak in
// skins.ts took the bot webhook and the payments down while the tests stayed green.
function apiGraph(): string[] {
  const root = join(__dirname, "..");
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(join(root, file), "utf8");
    for (const m of src.matchAll(/from\s+"(\.\.?\/[^"]+)"/g)) {
      const target = join(file, "..", m[1].replace(/\.js$/, ".ts")).replace(/\\/g, "/");
      walk(target);
    }
  };
  for (const f of readdirSync(join(root, "api"))) if (f.endsWith(".ts")) walk(`api/${f}`);
  return [...seen];
}

describe("shipped modules", () => {
  it("give every relative import an explicit extension", () => {
    expect(SHIPPED.flatMap(relativeImports)).toEqual([]);
  });

  it("keep browser-only globals out of everything the API reaches", () => {
    const hits: string[] = [];
    for (const file of apiGraph()) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      // Comments may name them; code may not. import.meta.env behind ?. is
      // the sanctioned form — it reads as undefined in Node instead of throwing.
      const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/import\.meta\.env(?!\?)/.test(code)) hits.push(`${file}: import.meta.env without ?.`);
      if (/\b(window|document|localStorage)\./.test(code)) hits.push(`${file}: browser global`);
    }
    expect(hits).toEqual([]);
  });
});
