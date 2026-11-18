import { expect, test, type Page } from "@playwright/test";

/* Small fixes 3 (Esme's list, 2026-11-18), at phone and desktop widths. FICTIONAL to-dos only.
   1. Today stops refilling: a to-do removed from Today is not replaced, and stays off after a
      reload (the day's picks are kept in a synced row; the next day starts fresh).
   2. Date added: a to-do's side panel says "Added" and the day.
   (3. The workbook bars' card wording is checked in journal-v3.spec.ts at both widths.)
   Set SHOTS_DIR to save screenshots. */

async function shoot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/** Six open to-dos (two priority 1, four priority 2), more than Today's four places. */
async function sixToDos(page: Page): Promise<void> {
  // Made away from Home, so Home first works out Today with all six there.
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" }).first()).toBeVisible();
  await page.evaluate(async () => {
    const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
    const repo = await at("/src/data/repo.ts");
    const { todayISO } = await at("/src/domain/dates.ts");
    const today = todayISO();
    for (const [title, priority] of [
      ["Pretend p1 water the fern", 1], ["Pretend p1 post the letter", 1],
      ["Pretend p2 tidy the shed", 2], ["Pretend p2 oil the gate", 2], ["Pretend p2 mend the kite", 2], ["Pretend p2 sort the buttons", 2],
    ] as const) {
      await repo.createItem({ kind: "task", title, areaId: "writing", priority }, today);
    }
  });
  await page.goto("/");
}

const todayList = (page: Page) => page.getByRole("list", { name: "Today", exact: true });

async function titles(page: Page): Promise<string[]> {
  const labels = await todayList(page).getByRole("checkbox").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return labels.map((l) => l.replace(/^Mark done: /, ""));
}

for (const width of [390, 1280]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("Remove from today: nothing replaces it, and it stays off after a reload", async ({ page }) => {
      await sixToDos(page);
      await expect(todayList(page).getByRole("listitem")).toHaveCount(4);
      const before = await titles(page);
      for (const [k, gone] of before.slice(0, 2).entries()) {
        await page.getByRole("button", { name: `Move to: ${gone}` }).click();
        await page.getByRole("button", { name: "Remove from today" }).click();
        await expect(todayList(page).getByRole("listitem")).toHaveCount(3 - k);
        expect(await titles(page)).toEqual(before.slice(k + 1));
      }
      await shoot(page, `small3-today-removed-${width}`);
      await page.reload();
      await expect(todayList(page).getByRole("listitem")).toHaveCount(2);
      expect(await titles(page)).toEqual(before.slice(2));
      // Nothing the list didn't show crept into the Done or due dropdowns either.
      await expect(page.getByText("Done today")).toHaveCount(0);
    });

    test("ticking one off: nothing takes its place", async ({ page }) => {
      await sixToDos(page);
      await expect(todayList(page).getByRole("listitem")).toHaveCount(4);
      const before = await titles(page);
      await page.getByRole("checkbox", { name: `Mark done: ${before[0]}` }).click();
      await expect(todayList(page).getByRole("listitem")).toHaveCount(3);
      expect(await titles(page)).toEqual(before.slice(1));
      await page.reload();
      await expect(todayList(page).getByRole("listitem")).toHaveCount(3);
    });

    test("a to-do's side panel says when it was added", async ({ page }) => {
      await sixToDos(page);
      await expect(todayList(page).getByRole("listitem")).toHaveCount(4);
      const first = (await titles(page))[0]!;
      await todayList(page).getByRole("button", { name: first, exact: true }).click();
      const panel = page.getByRole("complementary", { name: first });
      await expect(panel).toBeVisible();
      const day = await page.evaluate(async () => {
        const at = (path: string): Promise<any> => import(/* @vite-ignore */ path);
        const { todayISO } = await at("/src/domain/dates.ts");
        const { shortDate } = await at("/src/domain/display.ts");
        return shortDate(todayISO(), todayISO());
      });
      await expect(panel.locator(".peek-key", { hasText: /^Added$/ })).toBeVisible();
      await expect(panel.getByText(day, { exact: true })).toBeVisible();
      await shoot(page, `small3-date-added-${width}`);
    });
  });
}
