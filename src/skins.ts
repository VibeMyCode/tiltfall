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
  rarity?: Rarity;
  stars?: number; // absent on the procedural skins, which levels hand out
}

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
const SHOP: Record<string, SkinDef> = {
  com_beach_ball: { name: "BEACH BALL", rgb: [1, 1, 1], emissive: 0.15, image: "com-beach-ball", rarity: "common", stars: 25 },
  com_cherry_stripes: { name: "CHERRY STRIPES", rgb: [1, 1, 1], emissive: 0.15, image: "com-cherry-stripes", rarity: "common", stars: 25 },
  com_lime_zigzag: { name: "LIME ZIGZAG", rgb: [1, 1, 1], emissive: 0.15, image: "com-lime-zigzag", rarity: "common", stars: 25 },
  com_pink_clouds: { name: "PINK CLOUDS", rgb: [1, 1, 1], emissive: 0.15, image: "com-pink-clouds", rarity: "common", stars: 25 },
  com_polka_dots: { name: "POLKA DOTS", rgb: [1, 1, 1], emissive: 0.15, image: "com-polka-dots", rarity: "common", stars: 25 },
  epic_circuit_traces: { name: "CIRCUIT TRACES", rgb: [1, 1, 1], emissive: 0.15, image: "epic-circuit-traces", rarity: "epic", stars: 120 },
  epic_galaxy_swirl: { name: "GALAXY SWIRL", rgb: [1, 1, 1], emissive: 0.15, image: "epic-galaxy-swirl", rarity: "epic", stars: 120 },
  epic_molten_cracks: { name: "MOLTEN CRACKS", rgb: [1, 1, 1], emissive: 0.15, image: "epic-molten-cracks", rarity: "epic", stars: 120 },
  epic_plasma_arc: { name: "PLASMA ARC", rgb: [1, 1, 1], emissive: 0.15, image: "epic-plasma-arc", rarity: "epic", stars: 120 },
  epic_rainbow: { name: "RAINBOW", rgb: [1, 1, 1], emissive: 0.15, image: "epic-rainbow", rarity: "epic", stars: 120 },
  legend_aurora_ribbons: { name: "AURORA RIBBONS", rgb: [1, 1, 1], emissive: 0.15, image: "legend-aurora-ribbons", rarity: "legendary", stars: 250 },
  legend_byakugan: { name: "BYAKUGAN", rgb: [1, 1, 1], emissive: 0.15, image: "legend-byakugan", rarity: "legendary", stars: 250 },
  legend_crystal_facets: { name: "CRYSTAL FACETS", rgb: [1, 1, 1], emissive: 0.15, image: "legend-crystal-facets", rarity: "legendary", stars: 250 },
  legend_dark_eye: { name: "DARK EYE", rgb: [1, 1, 1], emissive: 0.15, image: "legend-dark-eye", rarity: "legendary", stars: 250 },
  legend_liquid_gold: { name: "LIQUID GOLD", rgb: [1, 1, 1], emissive: 0.15, image: "legend-liquid-gold", rarity: "legendary", stars: 250 },
  legend_living_eye: { name: "LIVING EYE", rgb: [1, 1, 1], emissive: 0.15, image: "legend-living-eye", rarity: "legendary", stars: 250 },
  legend_rinnegan: { name: "RINNEGAN", rgb: [1, 1, 1], emissive: 0.15, image: "legend-rinnegan", rarity: "legendary", stars: 250 },
  legend_sage: { name: "SAGE", rgb: [1, 1, 1], emissive: 0.15, image: "legend-sage", rarity: "legendary", stars: 250 },
  legend_sharingan_4: { name: "SHARINGAN 4", rgb: [1, 1, 1], emissive: 0.15, image: "legend-sharingan-4", rarity: "legendary", stars: 250 },
  rar_blobs_magenta: { name: "BLOBS MAGENTA", rgb: [1, 1, 1], emissive: 0.15, image: "rar-blobs-magenta", rarity: "rare", stars: 60 },
  rar_checkers: { name: "CHECKERS", rgb: [1, 1, 1], emissive: 0.15, image: "rar-checkers", rarity: "rare", stars: 60 },
  rar_eyes: { name: "EYES", rgb: [1, 1, 1], emissive: 0.15, image: "rar-eyes", rarity: "rare", stars: 60 },
  rar_tiger: { name: "TIGER", rgb: [1, 1, 1], emissive: 0.15, image: "rar-tiger", rarity: "rare", stars: 60 },
  rar_watermelon: { name: "WATERMELON", rgb: [1, 1, 1], emissive: 0.15, image: "rar-watermelon", rarity: "rare", stars: 60 },
};

// One table for the game to look up, two sources: levels grant the procedural
// ones, Stars buy the painted ones.
Object.assign(SKINS, SHOP);

export const SHOP_SKINS: string[] = Object.keys(SHOP);
export const skinImage = (id: string): string | null =>
  SKINS[id]?.image ? `/skins/${SKINS[id].image}.jpg` : null;
export const skinThumb = (id: string): string | null =>
  SKINS[id]?.image ? `/skins/t/${SKINS[id].image}.jpg` : null;

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
