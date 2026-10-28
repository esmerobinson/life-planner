import { defineConfig } from "@playwright/test";

// Real-browser tests on the installed Chrome (no browser download). Each test gets a
// fresh browser context, so its IndexedDB is empty and never touches real data.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: "chrome",
  },
  webServer: [
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
    },
    {
      // Production build, for the service worker (it is off in the dev server).
      command: "npm run build && npm run preview",
      url: "http://127.0.0.1:4173",
      // Never reuse: a leftover preview could serve a stale dist/ and skip the build.
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
