// node scripts/pixdiff.mjs <dirA> <dirB> [--tol 8]
// Compares same-named PNGs from two perf-harness runs pixel by pixel. Decoding
// happens in a headless page (no image library in the tree). Where pixels
// differ beyond the tolerance, <dirB>/<name>.diff.png marks them in red.
import { chromium } from "playwright-core";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: node scripts/pixdiff.mjs <dirA> <dirB> [--tol N]");
  process.exit(2);
}
const ti = process.argv.indexOf("--tol");
const tol = ti >= 0 ? Number(process.argv[ti + 1]) : 8;
const inB = new Set(readdirSync(b));
const names = readdirSync(a).filter((n) => n.endsWith(".png") && !n.endsWith(".diff.png") && inB.has(n));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");
for (const n of names) {
  const da = "data:image/png;base64," + readFileSync(join(a, n)).toString("base64");
  const db = "data:image/png;base64," + readFileSync(join(b, n)).toString("base64");
  const r = await page.evaluate(
    async ([da, db, tol]) => {
      const load = (src) =>
        new Promise((res) => {
          const i = new Image();
          i.onload = () => res(i);
          i.src = src;
        });
      const [ia, ib] = await Promise.all([load(da), load(db)]);
      const c = document.getElementById("c");
      c.width = ia.width;
      c.height = ia.height;
      const g = c.getContext("2d");
      g.drawImage(ia, 0, 0);
      const A = g.getImageData(0, 0, c.width, c.height).data;
      g.drawImage(ib, 0, 0);
      const B = g.getImageData(0, 0, c.width, c.height).data;
      let diff = 0;
      let over = 0;
      let maxd = 0;
      const out = g.createImageData(c.width, c.height);
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
        if (d > 0) diff++;
        if (d > tol) over++;
        if (d > maxd) maxd = d;
        out.data[i] = d > tol ? 255 : A[i] >> 2;
        out.data[i + 1] = d > tol ? 0 : A[i + 1] >> 2;
        out.data[i + 2] = d > tol ? 0 : A[i + 2] >> 2;
        out.data[i + 3] = 255;
      }
      g.putImageData(out, 0, 0);
      return { px: A.length / 4, diff, over, maxd, img: over ? c.toDataURL("image/png") : null };
    },
    [da, db, tol],
  );
  console.log(
    `${n}: ${r.diff} px differ (${((100 * r.diff) / r.px).toFixed(2)}%), ${r.over} over tol ${tol} (${((100 * r.over) / r.px).toFixed(3)}%), max delta ${r.maxd}`,
  );
  if (r.img) writeFileSync(join(b, n.replace(".png", ".diff.png")), Buffer.from(r.img.split(",")[1], "base64"));
}
await browser.close();
