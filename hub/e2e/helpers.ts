import type { Page } from "@playwright/test";

/** The page's own local calendar date, shifted by `offset` days (YYYY-MM-DD). */
export async function pageDate(page: Page, offset = 0): Promise<string> {
  return page.evaluate((off) => {
    const d = new Date();
    d.setDate(d.getDate() + off);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, offset);
}
