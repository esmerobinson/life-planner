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
// Cloudflare Pages swaps a deployment under a home-screen app that stays alive. Fix round 1: and
// it never reloads over anything edited on the page (each such test also shows that the update
// does go through once the edit is over, so a "no reload" is never just a broken update).

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

/** Gone after any reload: shows whether the page was reloaded. */
const markPage = (page: Page) => page.evaluate(() => ((window as unknown as { __oldPage: boolean }).__oldPage = true));
const oldPageStillOpen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __oldPage?: boolean }).__oldPage === true);
const newVersionWaiting = (page: Page) =>
  page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);

/** The old build open at `path`, its service worker in control (as on her phone). */
async function openOldBuild(page: Page, path = "/") {
  await page.goto(`${base}/`);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-old");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto(`${base}${path}`);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-old");
  await markPage(page);
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

/** Deploys the new build; she leaves and comes back (it is found), then leaves and comes back again
 *  with it waiting: the moment it would switch at once. */
async function deployAndReturn(page: Page) {
  deployed = "new";
  await leaveAndComeBack(page);
  await expect.poll(async () => (await newVersionWaiting(page)) || !(await oldPageStillOpen(page)), { timeout: 20_000 }).toBe(true);
  if (await oldPageStillOpen(page)) await leaveAndComeBack(page);
}

/** Still the old page after the moments it would have switched. */
async function expectNoReload(page: Page) {
  await page.waitForTimeout(4_000);
  expect(await oldPageStillOpen(page)).toBe(true);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-old");
}

/** Once nothing is held: it does update (on the next return). */
async function expectUpdatesOnReturn(page: Page) {
  await leaveAndComeBack(page);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-new", { timeout: 15_000 });
  expect(await oldPageStillOpen(page)).toBe(false);
}

/** Raw rows into IndexedDB (a fresh context per test, so nothing real is touched). */
async function seed(page: Page, items: object[], goals: object[]) {
  await page.evaluate(
    async ([is, gs]) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open("life-hub");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction(["items", "goals"], "readwrite");
        for (const r of is) tx.objectStore("items").put(r);
        for (const g of gs) tx.objectStore("goals").put(g);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    [items, goals] as const,
  );
}
const TODAY = new Date().toISOString().slice(0, 10);
const task = { id: "t1", kind: "task", title: "Pretend send chapter", links: [], areaId: "writing", priority: 2, status: "open", createdAt: TODAY, touchedAt: TODAY };
const goal = { id: "g1", title: "Pretend calm", areaId: "mind", kind: "practice", milestones: [], createdAt: TODAY };

test("an old build is open, a new one is deployed: coming back to the app, it updates by itself", async ({ page }) => {
  test.setTimeout(60_000);
  await openOldBuild(page);
  await deployAndReturn(page);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-new", { timeout: 15_000 });
  expect(await oldPageStillOpen(page)).toBe(false);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByText("A new version is ready.")).toHaveCount(0); // no tap needed
  await expect(page.getByRole("navigation").first()).toBeVisible();
});

test("a new build is waiting when she opens the app: it is taken before anything is drawn (no flash)", async ({ page, context }) => {
  test.setTimeout(60_000);
  await openOldBuild(page);
  // She leaves; the new build is found and installed meanwhile.
  deployed = "new";
  await leaveAndComeBack(page);
  await expect.poll(async () => (await newVersionWaiting(page)) || !(await oldPageStillOpen(page)), { timeout: 20_000 }).toBe(true);
  test.skip(!(await oldPageStillOpen(page)), "took it on that return already (covered above)");
  await page.close();
  // Opening the app again: which build ever drew anything?
  const again = await context.newPage();
  await again.addInitScript(() => {
    const drawn: string[] = [];
    (window as unknown as { __drawn: string[] }).__drawn = drawn;
    new MutationObserver(() => {
      const root = document.getElementById("root");
      const b = document.documentElement.dataset.build ?? "";
      if (root?.childElementCount && !drawn.includes(b)) drawn.push(b);
    }).observe(document, { childList: true, subtree: true });
    try {
      const all = JSON.parse(sessionStorage.getItem("e2e.drawn") ?? "[]") as string[];
      addEventListener("pagehide", () => sessionStorage.setItem("e2e.drawn", JSON.stringify([...all, ...drawn])));
      (window as unknown as { __before: string[] }).__before = all;
    } catch {
      // ignore
    }
  });
  await again.goto(`${base}/`);
  await expect(build(again)).toHaveAttribute("data-build", "e2e-new", { timeout: 20_000 });
  await expect(again.getByRole("navigation").first()).toBeVisible();
  const drawn = await again.evaluate(() => [
    ...(window as unknown as { __before: string[] }).__before,
    ...(window as unknown as { __drawn: string[] }).__drawn,
  ]);
  expect(drawn).toEqual(["e2e-new"]); // the old build was never drawn
  await expect(again.getByText("A new version is ready.")).toHaveCount(0);
});

test("typing in the quick box: it waits, then updates once she stops, and the text survives", async ({ page }) => {
  test.setTimeout(120_000);
  await openOldBuild(page);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const box = page.getByRole("textbox", { name: "What's on your mind?" });
  await expect(box).toBeFocused();
  await box.pressSequentially("Pretend half a thought");
  await deployAndReturn(page);
  // Through at least one retry (10 s): still the old page, the sheet open, every letter there.
  await page.waitForTimeout(12_000);
  expect(await oldPageStillOpen(page)).toBe(true);
  await box.pressSequentially(", still typing");
  await expect(box).toHaveValue("Pretend half a thought, still typing");
  // She closes the sheet (the box keeps its text on the device) and leaves the phone alone:
  // after 30 s untouched it updates by itself.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add" })).toHaveCount(0);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-new", { timeout: 60_000 });
  expect(await oldPageStillOpen(page)).toBe(false);
  await expect(page.getByText("A new version is ready.")).toHaveCount(0);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "What's on your mind?" })).toHaveValue("Pretend half a thought, still typing");
});

test("text in the Inbox box, the keyboard put away: no reload, the text survives; a new page lets it update", async ({ page }) => {
  test.setTimeout(90_000);
  await openOldBuild(page, "/inbox");
  const box = page.getByRole("textbox", { name: "Add to inbox" });
  await box.fill("Pretend thought for the inbox");
  await box.blur(); // the iOS keyboard's Done
  await deployAndReturn(page);
  await expectNoReload(page);
  await expect(box).toHaveValue("Pretend thought for the inbox");
  // She goes to another page (which drops the box, as it always has): now it updates.
  await page.getByRole("link", { name: /^Home$|^Today$/ }).first().click();
  await expectUpdatesOnReturn(page);
});

test("a to-do in Edit mode with a changed priority: no reload, the change survives; Done lets it update", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`${base}/`);
  await seed(page, [task], []);
  await openOldBuild(page, "/area/writing?open=t1");
  const panel = page.getByRole("complementary", { name: "Pretend send chapter" });
  await panel.getByRole("button", { name: "Edit" }).click();
  await panel.getByLabel("Priority").selectOption("1");
  await panel.getByLabel("Priority").blur();
  await deployAndReturn(page);
  await expectNoReload(page);
  await expect(panel.getByLabel("Priority")).toHaveValue("1");
  await panel.getByRole("button", { name: "Done" }).click();
  await page.getByRole("link", { name: /^Home$|^Today$/ }).first().click(); // (the change was on this page)
  await expectUpdatesOnReturn(page);
});

test("a goal in Edit mode, nothing changed yet: no reload; Cancel lets it update", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`${base}/`);
  await seed(page, [], [goal]);
  await openOldBuild(page, "/goals?open=g1");
  const panel = page.getByRole("complementary", { name: "Pretend calm" });
  await panel.getByRole("button", { name: "Edit" }).click();
  await deployAndReturn(page);
  await expectNoReload(page);
  await expect(panel.getByRole("button", { name: "Cancel" })).toBeVisible();
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expectUpdatesOnReturn(page);
});

test("the Sync page's address, typed in: no reload, the text survives", async ({ page }) => {
  test.setTimeout(90_000);
  await openOldBuild(page, "/sync");
  const field = page.getByLabel("Sync address");
  await field.fill("https://pretend.example");
  await field.blur();
  await deployAndReturn(page);
  await expectNoReload(page);
  await expect(field).toHaveValue("https://pretend.example");
});

test("a select changed in the new-goal form (no text typed): no reload, the choice survives", async ({ page }) => {
  test.setTimeout(90_000);
  await openOldBuild(page, "/goals");
  const form = page.locator("form").filter({ has: page.getByText("Goal title") });
  const area = form.getByLabel("Area");
  const other = await area.evaluate((s: HTMLSelectElement) => [...s.options].find((o) => !o.selected)!.value);
  await area.selectOption(other);
  await area.blur();
  await deployAndReturn(page);
  await expectNoReload(page);
  await expect(area).toHaveValue(other);
});

test("she starts typing after it decided to switch (a page the worker does not control yet): no reload", async ({ page }) => {
  test.setTimeout(120_000);
  // The first open after Add to Home Screen: the page is not controlled by any worker.
  await page.goto(`${base}/inbox`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
  await markPage(page);
  await page.evaluate(async () => {
    (window as unknown as { __firstWorker: unknown }).__firstWorker = (await navigator.serviceWorker.getRegistration())?.active;
  });
  deployed = "new";
  await leaveAndComeBack(page);
  // It decides: the new worker is told to take over and becomes the active one.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return !!reg?.active && reg.active !== (window as unknown as { __firstWorker: unknown }).__firstWorker;
        }),
      { timeout: 60_000 },
    )
    .toBe(true);
  expect(await oldPageStillOpen(page)).toBe(true);
  // Now she types, the keyboard goes away, and she leaves and comes back.
  const box = page.getByRole("textbox", { name: "Add to inbox" });
  await box.fill("Pretend typed during takeover");
  await box.blur();
  await leaveAndComeBack(page);
  await page.waitForTimeout(12_000);
  expect(await oldPageStillOpen(page)).toBe(true);
  await expect(box).toHaveValue("Pretend typed during takeover");
});

test("two tabs: one updates by itself; the other, with text typed, waits and keeps it", async ({ page, context }) => {
  test.setTimeout(90_000);
  await openOldBuild(page);
  const other = await context.newPage();
  await other.goto(`${base}/inbox`);
  await expect.poll(() => other.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await markPage(other);
  const box = other.getByRole("textbox", { name: "Add to inbox" });
  await box.fill("Pretend second-tab words");
  await box.blur();

  await deployAndReturn(page);
  await expect(build(page)).toHaveAttribute("data-build", "e2e-new", { timeout: 15_000 });
  // The new version now controls both tabs; the other one must not reload over her words.
  await other.waitForTimeout(12_000);
  expect(await oldPageStillOpen(other)).toBe(true);
  await expect(box).toHaveValue("Pretend second-tab words");
});
