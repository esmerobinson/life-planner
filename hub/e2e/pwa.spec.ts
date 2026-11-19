import { expect, test } from "@playwright/test";

// Runs against `vite preview` (the production build, where the service worker is on).
test.use({ baseURL: `http://127.0.0.1:${process.env.E2E_PREVIEW_PORT ?? 4173}` });

test("installable: manifest, service worker, works offline, data survives", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error("service worker not active");
  });
  // The first load must be controlled before it can serve offline.
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole("navigation").first()).toBeVisible();

  // Add a to-do while online.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByLabel("Title").fill("Offline survivor task");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("link", { name: /^Inbox/ }).click();
  await expect(page.getByText("Offline survivor task").first()).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("Offline survivor task").first()).toBeVisible();

  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText("Offline survivor task").first()).toBeVisible();
});

// Esme's Rio is its own lazily loaded chunk (App.tsx): the service worker must store it with the
// app shell, so the game opens offline too once the app has been opened online.
test("offline: the game (its own chunk) opens after the first visit, with none of the app's files failing", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error("service worker not active");
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole("navigation").first()).toBeVisible();

  // The game's chunk is in the precache (and so is every image it draws).
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  expect(cached.some((u) => /^\/assets\/FarmPage-[\w-]+\.js$/.test(u))).toBe(true);
  expect(cached.some((u) => /^\/assets\/map-base-day-[\w-]+\.png$/.test(u))).toBe(true);

  const failed: string[] = [];
  // The app's own files only (the game's weather lookup goes to another site, and offline it fails as it should).
  page.on("requestfailed", (r) => {
    if (new URL(r.url()).origin === new URL(page.url()).origin) failed.push(r.url());
  });
  await context.setOffline(true);
  // A fresh start offline, straight onto the game, then from the app's own link.
  await page.goto("/farm");
  await expect(page.getByRole("heading", { level: 1, name: "Esme's Rio" })).toBeAttached({ timeout: 15_000 });
  await expect(page.locator(".rio-map-layer > canvas")).toBeVisible();
  await expect(page.getByText("This page hit a problem")).toHaveCount(0);
  await page.goto("/inbox");
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await page.getByRole("link", { name: /Esme's Rio/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Esme's Rio" })).toBeAttached();
  expect(failed).toEqual([]);
  await context.setOffline(false);
});

test.describe("a game chunk that fails to load", () => {
  // No service worker, so the request for the chunk can be made to fail (as offline before it was
  // ever stored, or an old page asking for a file a new deploy replaced).
  test.use({ serviceWorkers: "block" });

  test("reloads once (the chunk guard), then shows the page's problem note: never a reload loop", async ({ page }) => {
    test.setTimeout(60_000);
    let asked = 0;
    await page.route(/\/assets\/FarmPage-[\w-]+\.js$/, (route) => {
      asked++;
      return route.abort("internetdisconnected");
    });
    let loads = 0;
    page.on("load", () => loads++);
    await page.goto("/farm");
    await expect(page.getByText("This page hit a problem. Everything you wrote is saved.")).toBeVisible({ timeout: 20_000 });
    // Once more after the one reload, then left to fail: no more loads for a good while.
    await expect.poll(() => loads).toBe(2);
    await page.waitForTimeout(4_000);
    expect(loads).toBe(2);
    expect(asked).toBe(2);
    // The rest of the app is still there.
    await page.goto("/inbox");
    await expect(page.getByRole("navigation").first()).toBeVisible();
  });
});
