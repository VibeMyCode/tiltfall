// Ball skins — procedural, code-drawn. Shared by the renderer (as a
// DynamicTexture on the ball) and by the UI (as swatch previews), so the
// menu always shows the REAL pattern (owner: swatches were flat colors).

export interface SkinDef {
  name: string;
  rgb: [number, number, number];
  emissive: number;
  pattern?: (ctx: CanvasRenderingContext2D, s: number) => void;
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
