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
