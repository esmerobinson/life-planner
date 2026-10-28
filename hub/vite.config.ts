/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      // Production builds only: the dev server keeps behaving exactly as before.
      devOptions: { enabled: false },
      // The manifest is a hand-written file, public/manifest.webmanifest (linked from
      // index.html). The plugin would otherwise inject a default theme_color and
      // background_color, and colours are Esme's call. Icons there are magenta
      // placeholders from scripts/make-icons.mjs.
      manifest: false,
      workbox: {
        // App shell only: html, js, css, icons, manifest. No runtime caching rules,
        // so user data (IndexedDB) and other origins are never touched.
        globPatterns: ["**/*.{html,js,css,png,svg,webmanifest}"],
        globIgnores: ["**/*.json"],
        navigateFallback: "index.html",
        // Icons and the manifest are files, never answered with the app page.
        navigateFallbackDenylist: [/^\/icons\//, /\.webmanifest$/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // Fixed address: browser storage belongs to the origin, so the port must never move.
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    exclude: [...configDefaults.exclude, "e2e/**", "e2e-sync/**"],
    // The plugin's virtual module only exists inside a Vite build; tests use a stub.
    alias: {
      "virtual:pwa-register/react": fileURLToPath(new URL("./src/test/pwa-register-stub.ts", import.meta.url)),
    },
  },
});
