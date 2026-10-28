import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

// EXPECTED TO FAIL today: the sidebar is a fixed 220px wide, so the page overflows a phone.
// Marked fixme until the phone design round with Esme; measured overflow is in the task report.
const PAGES = [
  ["Home", "/"],
  ["Today", "/today"],
  ["Goals", "/goals"],
  ["Inbox", "/inbox"],
  ["Backup", "/backup"],
] as const;

for (const [name, path] of PAGES) {
  test.fixme(`${name} does not scroll sideways at phone width`, async ({ page }) => {
    await page.goto(path);
    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
  });
}
