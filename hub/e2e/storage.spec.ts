import { expect, test } from "@playwright/test";

type Counter = { __persistCalls: number };

test("persistent storage is requested once on load", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Counter).__persistCalls = 0;
    navigator.storage.persist = async () => {
      (window as unknown as Counter).__persistCalls++;
      return true;
    };
  });
  await page.goto("/backup");
  await expect(page.getByText("Your browser has agreed to keep this data.")).toBeVisible();
  // The dev server runs React StrictMode, which mounts effects twice on purpose, so a
  // single request from the app shows as 1 or 2 calls here (never more, never zero).
  const calls = await page.evaluate(() => (window as unknown as Counter).__persistCalls);
  expect(calls).toBeGreaterThanOrEqual(1);
  expect(calls).toBeLessThanOrEqual(2);
});
