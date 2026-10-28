import { defineConfig } from "@playwright/test";

// OPT-IN end-to-end check against the REAL sync server code, run locally:
//   npm run e2e:sync
// Needs `npm install` in ../sync (wrangler). Starts `wrangler dev --local` from an empty temp
// directory with an explicit --config (see e2e-sync/server.mjs) and the hub's production
// build on 127.0.0.1:4173 (an origin the server's CORS allows). Nothing is deployed and no
// Cloudflare account is used. The normal `npx playwright test` never runs these.
const syncPort = Number(process.env.E2E_SYNC_PORT ?? 8790);

export default defineConfig({
  testDir: "./e2e-sync",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    // Page requests must reach the network directly (routes are used to watch them).
    serviceWorkers: "block",
  },
  webServer: [
    {
      command: "node e2e-sync/server.mjs",
      url: `http://127.0.0.1:${syncPort}/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run build && npx vite preview --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
