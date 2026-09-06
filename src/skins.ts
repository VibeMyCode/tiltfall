// Ball skins — procedural, code-drawn. Shared by the renderer (as a
// DynamicTexture on the ball) and by the UI (as swatch previews), so the
// menu always shows the REAL pattern (owner: swatches were flat colors).

export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface SkinDef {
  name: string;
  rgb: [number, number, number];
  emissive: number;
  // Procedural skins draw themselves; shop skins name a file in public/skins.
  // A skin has one or the other, never both.
  pattern?: (ctx: CanvasRenderingContext2D, s: number) => void;
  image?: string;
  rarity?: Rarity; // absent on the procedural skins, which levels hand out
  // Composed AROUND THE POLE rather than across the sheet — the eyes, whose
  // bands are latitude rings. Those want the pole facing the viewer; every
  // other texture wants the equator, where it is least deformed.
  polar?: boolean;
}

// Price is a property of the RARITY, not of the skin. Twenty rows each
// carrying their own number is twenty chances for one of them to drift.
export const RARITY_STARS: Record<Rarity, number> = { common: 25, rare: 60, epic: 120, legendary: 250 };

export const SKINS: Record<string, SkinDef> = {
  core: { name: "CORE", rgb: [0.35, 0.9, 1.0], emissive: 0.35 },
  ember: {
    name: "EMBER",
    rgb: [1, 1, 1],
    emissive: 0.55,
    pattern: (ctx, s) => {
      ctx.fillStyle = "#3a1206";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 26; i++) {
        ctx.strokeStyle = ["#ff7a18", "#ffd23f", "#ff3d00"][i % 3];
        ctx.lineWidth = (2 + Math.random() * 5) * (s / 256);
        ctx.beginPath();
        let x = Math.random() * s;
        let y = Math.random() * s;
        ctx.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += (Math.random() - 0.5) * s * 0.35;
          y += (Math.random() - 0.5) * s * 0.35;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
  },
  prism: {
    name: "PRISM",
    rgb: [1, 1, 1],
    emissive: 0.55,
    pattern: (ctx, s) => {
      const colors = ["#ff5f8f", "#ffb347", "#ffe08a", "#7dffb3", "#59c4ff", "#b48cff"];
      for (let i = 0; i < 24; i++) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.save();
        ctx.translate(s / 2, s / 2);
        ctx.rotate((i * Math.PI) / 12);
        ctx.fillRect(-s * 0.75, -s * 0.032, s * 1.5, s * 0.064);
        ctx.restore();
      }
    },
  },
  galaxy: {
    name: "GALAXY",
    rgb: [1, 1, 1],
    emissive: 0.62,
    pattern: (ctx, s) => {
      ctx.fillStyle = "#150f38";
      ctx.fillRect(0, 0, s, s);
      // A bright nebula sweep so the skin reads even on a small ball.
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = ["#5b3bd6", "#8b5cff", "#3a6bff"][i % 3];
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.ellipse(Math.random() * s, Math.random() * s, s * 0.22, s * 0.09, Math.random() * 3, 0, 6.3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Big readable stars (owner: previous ones were invisible).
      for (let i = 0; i < 46; i++) {
        const r = (i % 6 === 0 ? 5 : 2.4) * (s / 256);
        ctx.fillStyle = ["#ffffff", "#ffe9ff", "#bcd8ff"][i % 3];
        const x = Math.random() * s;
        const y = Math.random() * s;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.3);
        ctx.fill();
        if (i % 6 === 0) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.4 * (s / 256);
          ctx.beginPath();
          ctx.moveTo(x - r * 2.6, y);
          ctx.lineTo(x + r * 2.6, y);
          ctx.moveTo(x, y - r * 2.6);
          ctx.lineTo(x, y + r * 2.6);
          ctx.stroke();
        }
      }
    },
  },
  aurora: {
    name: "AURORA",
    rgb: [1, 1, 1],
    emissive: 0.6,
    pattern: (ctx, s) => {
      for (let y = 0; y < s; y += Math.max(1, s / 64)) {
        const t = y / s;
        ctx.fillStyle = `hsl(${150 + Math.sin(t * 9.4) * 40}, 90%, ${38 + Math.sin(t * 15.7) * 14}%)`;
        ctx.fillRect(0, y, s, Math.max(1, s / 64));
      }
    },
  },
  checker: {
    name: "CHECKER",
    rgb: [1, 1, 1],
    emissive: 0.5,
    pattern: (ctx, s) => {
      const n = 8;
      const c = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          ctx.fillStyle = (x + y) % 2 ? "#0d1b2e" : "#59ffd0";
          ctx.fillRect(x * c, y * c, c, c);
        }
    },
  },
  magma: {
    name: "MAGMA",
    rgb: [1, 1, 1],
    emissive: 0.62,
    pattern: (ctx, s) => {
      ctx.fillStyle = "#140404";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 220; i++) {
        const r = (4 + Math.random() * 26) * (s / 256);
        ctx.fillStyle = ["#ff2d00", "#ff7a18", "#ffc400"][i % 3];
        ctx.globalAlpha = 0.25 + Math.random() * 0.6;
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s, r, 0, 6.3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
};

// Paint a skin into any 2D context (ball texture or menu swatch).
// --- SHOP SKINS -----------------------------------------------------------
// Painted textures rather than procedural patterns, bought with Stars. Their
// rgb stays white so the image carries the colour, and emissive is low: these
// are far brighter than the procedural set, and the glow layer would bloom a
// saturated texture into a white ball.
// Eye skins share a frame. Babylon's sphere runs V bottom-up, so the BOTTOM
// edge of the canvas is the pole; pole() flips the canvas so a pattern can be
// written pupil-first, and ring() lays down one latitude band. The camera sits
// 34 degrees off the pole, so an eye has to be wide to still fill the disc.
const pole = (ctx: CanvasRenderingContext2D, s: number): void => {
  ctx.translate(0, s);
  ctx.scale(1, -1);
};
const ring = (ctx: CanvasRenderingContext2D, s: number, v0: number, v1: number, c: string): void => {
  ctx.fillStyle = c;
  ctx.fillRect(0, v0 * s, s, (v1 - v0) * s);
};

const SHOP: Record<string, SkinDef> = {
  com_beach_ball: { name: "BEACH BALL", rgb: [1, 1, 1], emissive: 0.15, image: "com-beach-ball", rarity: "common" },
  com_cherry_stripes: { name: "CHERRY STRIPES", rgb: [1, 1, 1], emissive: 0.15, image: "com-cherry-stripes", rarity: "common" },
  com_lime_zigzag: { name: "LIME ZIGZAG", rgb: [1, 1, 1], emissive: 0.15, image: "com-lime-zigzag", rarity: "common" },
  com_pink_clouds: { name: "PINK CLOUDS", rgb: [1, 1, 1], emissive: 0.15, image: "com-pink-clouds", rarity: "common" },
  com_polka_dots: { name: "POLKA DOTS", rgb: [1, 1, 1], emissive: 0.15, image: "com-polka-dots", rarity: "common" },
  rar_blobs_magenta: { name: "BLOBS MAGENTA", rgb: [1, 1, 1], emissive: 0.15, image: "rar-blobs-magenta", rarity: "rare" },
  rar_checkers: { name: "CHECKERS", rgb: [1, 1, 1], emissive: 0.15, image: "rar-checkers", rarity: "rare" },
  rar_eyes: { name: "EYES", rgb: [1, 1, 1], emissive: 0.15, image: "rar-eyes", rarity: "rare" },
  rar_tiger: { name: "TIGER", rgb: [1, 1, 1], emissive: 0.15, image: "rar-tiger", rarity: "rare" },
  rar_watermelon: { name: "WATERMELON", rgb: [1, 1, 1], emissive: 0.15, image: "rar-watermelon", rarity: "rare" },
  epic_circuit_traces: { name: "CIRCUIT TRACES", rgb: [1, 1, 1], emissive: 0.15, image: "epic-circuit-traces", rarity: "epic" },
  epic_galaxy_swirl: { name: "GALAXY SWIRL", rgb: [1, 1, 1], emissive: 0.15, image: "epic-galaxy-swirl", rarity: "epic" },
  epic_molten_cracks: { name: "MOLTEN CRACKS", rgb: [1, 1, 1], emissive: 0.15, image: "epic-molten-cracks", rarity: "epic" },
  epic_plasma_arc: { name: "PLASMA ARC", rgb: [1, 1, 1], emissive: 0.15, image: "epic-plasma-arc", rarity: "epic" },
  epic_rainbow: { name: "RAINBOW", rgb: [1, 1, 1], emissive: 0.15, image: "epic-rainbow", rarity: "epic" },
  legend_aurora_ribbons: { name: "AURORA RIBBONS", rgb: [1, 1, 1], emissive: 0.15, image: "legend-aurora-ribbons", rarity: "legendary" },
  legend_crystal_facets: { name: "CRYSTAL FACETS", rgb: [1, 1, 1], emissive: 0.15, image: "legend-crystal-facets", rarity: "legendary" },
  legend_dark_eye: { name: "DARK EYE", rgb: [1, 1, 1], emissive: 0.15, image: "legend-dark-eye", rarity: "legendary" },
  legend_liquid_gold: { name: "LIQUID GOLD", rgb: [1, 1, 1], emissive: 0.15, image: "legend-liquid-gold", rarity: "legendary" },
  legend_living_eye: { name: "LIVING EYE", rgb: [1, 1, 1], emissive: 0.15, image: "legend-living-eye", rarity: "legendary" },
  // --- eyes ------------------------------------------------------------------
  // Drawn rather than painted: an eye is four flat bands and a few marks, and
  // a generator asked for one keeps producing a tiling stripe pattern, which
  // wraps into a dartboard.
  legend_sharingan_4: {
    polar: true,
    name: "SHARINGAN",
    rgb: [1, 1, 1],
    emissive: 0.15,
    rarity: "legendary",
    pattern: (ctx, s) => {
      pole(ctx, s);
      ring(ctx, s, 0, 0.13, "#150609"); // pupil
      ring(ctx, s, 0.13, 0.42, "#d0121b"); // iris
      ring(ctx, s, 0.42, 0.47, "#12060a"); // rim
      ring(ctx, s, 0.47, 1, "#8f1420"); // the far side
      // A ring this far down the sphere is 1.5x longer than it is tall, so a
      // tomoe is squashed sideways in the texture to come out round on the ball.
      const r = s * 0.075;
      ctx.fillStyle = "#0d0405";
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(((i + 0.5) / 3) * s, 0.27 * s);
        ctx.scale(0.67, 1);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(r * 0.2, -r * 0.95);
        ctx.quadraticCurveTo(r * 3.4, -r * 1.1, r * 3.3, r * 1.1);
        ctx.quadraticCurveTo(r * 1.6, r * 0.1, r * 0.95, r * 0.35);
        ctx.fill();
        ctx.restore();
      }
    },
  },
  legend_rinnegan: {
    polar: true,
    name: "RINNEGAN",
    rgb: [1, 1, 1],
    emissive: 0.15,
    rarity: "legendary",
    // The easiest of the four: its ripples ARE rings around the pole, so they
    // are literally the bands of the unwrap, and it survives the roll intact.
    pattern: (ctx, s) => {
      pole(ctx, s);
      ring(ctx, s, 0, 0.08, "#2b1f45");
      for (let i = 0; i < 7; i++) {
        ring(ctx, s, 0.08 + i * 0.09, 0.08 + (i + 1) * 0.09, i % 2 ? "#7a5fc0" : "#cdb9f2");
      }
      ring(ctx, s, 0.71, 1, "#8f74cc");
    },
  },
  legend_byakugan: {
    polar: true,
    name: "BYAKUGAN",
    rgb: [1, 1, 1],
    emissive: 0.15,
    rarity: "legendary",
    // Pupil-less by design, so it is a pale ball with veins instead. Veins run
    // outward from the pole, which in the unwrap means straight down.
    pattern: (ctx, s) => {
      pole(ctx, s);
      ring(ctx, s, 0, 1, "#efeaf7");
      ring(ctx, s, 0, 0.16, "#ded4ee");
      ctx.strokeStyle = "#a893c6";
      ctx.lineWidth = s * 0.014;
      for (let i = 0; i < 14; i++) {
        const x = ((i + 0.5) / 14) * s;
        const wob = (i % 2 ? 1 : -1) * s * 0.03;
        ctx.beginPath();
        ctx.moveTo(x, 0.2 * s);
        ctx.quadraticCurveTo(x + wob, 0.42 * s, x, 0.62 * s);
        ctx.stroke();
      }
    },
  },
  legend_sage: {
    polar: true,
    name: "SAGE",
    rgb: [1, 1, 1],
    emissive: 0.15,
    rarity: "legendary",
    // A toad's horizontal bar pupil cannot survive this projection — anything
    // centred on the pole comes out as a ring — so it is a ring pupil instead.
    pattern: (ctx, s) => {
      pole(ctx, s);
      ring(ctx, s, 0, 0.07, "#f7d774");
      ring(ctx, s, 0.07, 0.17, "#1a0f06"); // the bar pupil, as a ring
      ring(ctx, s, 0.17, 0.46, "#f2a616"); // amber iris
      ring(ctx, s, 0.46, 0.52, "#8a3d06"); // rim
      ring(ctx, s, 0.52, 1, "#c4721a"); // the far side
    },
  },
};

// One table for the game to look up, two sources: levels grant the procedural
// ones, Stars buy the painted ones.
Object.assign(SKINS, SHOP);

export const SHOP_SKINS: string[] = Object.keys(SHOP);
/** What a shop skin costs in Stars, or null for one levels hand out free. */
export const skinStars = (id: string): number | null => {
  const r = SKINS[id]?.rarity;
  return r ? RARITY_STARS[r] : null;
};

// "./" on itch (subpath), "/" on a domain root. Guarded: this module is also
// bundled into the Netlify functions through products.ts, and there is no
// import.meta.env in Node — the bare read crashed every function on import
// and took the bot down with them.
const base = import.meta.env?.BASE_URL ?? "/";

export const skinImage = (id: string): string | null =>
  SKINS[id]?.image ? `${base}skins/${SKINS[id].image}.jpg` : null;
export const skinThumb = (id: string): string | null =>
  SKINS[id]?.image ? `${base}skins/t/${SKINS[id].image}.jpg` : null;

export function drawSkin(ctx: CanvasRenderingContext2D, id: string, size: number): void {
  const def = SKINS[id] ?? SKINS.core;
  if (def.pattern) {
    def.pattern(ctx, size);
    return;
  }
  const [r, g, b] = def.rgb;
  ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  ctx.fillRect(0, 0, size, size);
}
