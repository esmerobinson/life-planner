import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The phone takes a new version by itself (native/pwaUpdate.ts), against two real production
// builds: "old" is open, then "new" is deployed (the server below starts serving it), the way
// Cloudflare Pages swaps a deployment under a home-screen app that stays alive.

const root = fileURLToPath(new URL("..", import.meta.url));
const dirs = { old: resolve(root, "dist-e2e-old"), new: resolve(root, "dist-e2e-new") };
type Build = keyof typeof dirs;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

let deployed: Build = "old";
let server: Server;
let base = "";

/** A static host like Pages: files as they are, unknown app paths answered with index.html. */
function serve(): Promise<void> {
  server = createServer((req, res) => {
    const dir = dirs[deployed];
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^(\.\.[/\\])+/, "");
    let file = join(dir, path);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) {
      if (extname(path)) {
        res.writeHead(404).end();
        return;
      }
      file = join(dir, "index.html");
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=0, must-revalidate",
    });
    res.end(readFileSync(file));
  });
  return new Promise((r) =>
    server.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      r();
    }),
  );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  // Two production builds that differ only in their build id (so in their files and sw.js).
  const build = (name: Build) =>
    promisify(execFile)("npx", ["vite", "build", "--outDir", dirs[name], "--emptyOutDir", "--logLevel", "error"], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production", ESMEWORLD_BUILD: `e2e-${name}` },
    });
  await build("old");
  await build("new");
  await serve();
});

test.afterAll(async () => {
  await new Promise((r) => server?.close(r));
});

test.beforeEach(() => {
  deployed = "old";
});

const build = (page: Page) => page.locator("html");

/** The old build open, its service worker in control (as on her phone). */
async function openOldBuild(page: Page) {
  await page.goto(`${base}/`);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-old");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-old");
  // Gone after any reload: shows the page was (or was not) reloaded.
  await page.evaluate(() => ((window as unknown as { __oldPage: boolean }).__oldPage = true));
}

/** Leaving the app and coming back (an iPhone home-screen app that stayed alive). */
async function leaveAndComeBack(page: Page) {
  await page.evaluate(() => {
    const set = (s: string) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    set("hidden");
    set("visible");
    delete (document as unknown as { visibilityState?: string }).visibilityState;
  });
}

const oldPageStillOpen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __oldPage?: boolean }).__oldPage === true);
const newVersionWaiting = (page: Page) =>
  page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);

test("an old build is open, a new one is deployed: coming back to the app, it updates by itself", async ({ page }) => {
  test.setTimeout(60_000);
  await openOldBuild(page);
  deployed = "new";
  await leaveAndComeBack(page);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-new", { timeout: 20_000 });
  expect(await oldPageStillOpen(page)).toBe(false);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // No tap needed, so no note.
  await expect(page.getByText("A new version is ready.")).toHaveCount(0);
  await expect(page.getByRole("navigation").first()).toBeVisible();
});

test("typing in the quick box: it waits, then updates once she stops, and the text survives", async ({ page }) => {
  test.setTimeout(120_000);
  await openOldBuild(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const box = page.getByRole("textbox", { name: "What's on your mind?" });
  await expect(box).toBeFocused();
  await box.pressSequentially("Pretend half a thought");

  deployed = "new";
  await leaveAndComeBack(page); // (looks for the new version at once)
  await expect.poll(() => newVersionWaiting(page), { timeout: 20_000 }).toBe(true);
  // Through at least one retry (10 s): still the old page, the sheet open, every letter there.
  await page.waitForTimeout(12_000);
  expect(await oldPageStillOpen(page)).toBe(true);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-old");
  await box.pressSequentially(", still typing");
  await expect(box).toHaveValue("Pretend half a thought, still typing");

  // She closes the sheet (the box keeps its text) and leaves the phone alone: after 30 s
  // untouched it updates by itself.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add" })).toHaveCount(0);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-new", { timeout: 60_000 });
  expect(await oldPageStillOpen(page)).toBe(false);
  await expect(page.getByText("A new version is ready.")).toHaveCount(0);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "What's on your mind?" })).toHaveValue("Pretend half a thought, still typing");
});
