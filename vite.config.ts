import { defineConfig } from "vite";

export default defineConfig({
  // Relative base: the build runs on a domain root (Netlify, Telegram Mini App)
  // AND under a subpath (itch.io serves HTML games at /<user>/<game>/).
  base: "./",
  server: { host: true, port: 5173 },
});
