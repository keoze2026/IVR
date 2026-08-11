import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * In dev, Vite serves the SPA and forwards /bff to the BFF process.
 * In prod the BFF serves the built assets itself, so there is no proxy and
 * no second origin — see server/index.ts.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/bff": {
        target: process.env.BFF_ORIGIN ?? "http://localhost:8787",
        changeOrigin: true,
      },
      /*
       * The live KPI socket connects to `window.location.host`, which in dev
       * is this server. Without this entry the handshake hits Vite, which has
       * no such route, and every campaign falls back to REST polling with no
       * error a developer would notice.
       *
       * It goes straight to Django rather than through the BFF: the token is
       * in the query string and Channels authenticates it there, so the BFF
       * has nothing to add. In production nginx already routes /ws/ to the
       * Channels upstream.
       */
      "/ws": {
        target: process.env.IVR_API_BASE ?? "http://localhost:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    /*
     * No sourcemaps in production.
     *
     * They ship the original TypeScript — every comment, every note about
     * which upstream checks exist and where they are enforced. That is a map
     * of the system handed to anyone who opens devtools. Set VITE_SOURCEMAP=1
     * locally when you need to debug a built bundle.
     */
    sourcemap: process.env.VITE_SOURCEMAP === "1",
  },
});
