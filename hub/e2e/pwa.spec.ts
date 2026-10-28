import { expect, test } from "@playwright/test";

// Runs against `vite preview` (the production build, where the service worker is on).
test.use({ baseURL: "http://127.0.0.1:4173" });

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
