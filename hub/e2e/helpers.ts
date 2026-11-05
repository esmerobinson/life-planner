import type { Locator, Page } from "@playwright/test";

/**
 * Opens one exercise card (by its line, "Day 2 · …") from "See all chapters": the chapter map
 * pop-up, every chapter of the current book opened. Returns the pop-up.
 */
export async function openCardInMap(page: Page, tab: Locator, line: string): Promise<Locator> {
  await tab.getByRole("button", { name: "See all chapters" }).click();
  const map = page.getByRole("dialog", { name: "Your workbooks" });
  const closed = map.locator('button.wb-ch-toggle[aria-expanded="false"]');
  while ((await closed.count()) > 0) await closed.first().click();
  await map.locator("button.wb-card-link", { hasText: line }).first().click();
  return map;
}

/** The page's own local calendar date, shifted by `offset` days (YYYY-MM-DD). */
export async function pageDate(page: Page, offset = 0): Promise<string> {
  return page.evaluate((off) => {
    const d = new Date();
    d.setDate(d.getDate() + off);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, offset);
}
