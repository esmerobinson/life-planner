import { defineConfig } from "@playwright/test";

// Ports can be overridden when another checkout already serves 5173/4173 on this machine
// (otherwise the dev server there would be reused and the wrong code tested):
//   E2E_DEV_PORT=5183 E2E_PREVIEW_PORT=4183 npx playwright test
const devPort = Number(process.env.E2E_DEV_PORT ?? 5173);
const previewPort = Number(process.env.E2E_PREVIEW_PORT ?? 4173);

// Real-browser tests on the installed Chrome (no browser download). Each test gets a
// fresh browser context, so its IndexedDB is empty and never touches real data.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${devPort}`,
    channel: "chrome",
  },
  webServer: [
    {
      command: devPort === 5173 ? "npm run dev" : `npx vite --port ${devPort}`,
      url: `http://127.0.0.1:${devPort}`,
      reuseExistingServer: true,
    },
    {
      // Production build, for the service worker (it is off in the dev server).
      command: previewPort === 4173 ? "npm run build && npm run preview" : `npm run build && npx vite preview --port ${previewPort}`,
      url: `http://127.0.0.1:${previewPort}`,
      // Never reuse: a leftover preview could serve a stale dist/ and skip the build.
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
