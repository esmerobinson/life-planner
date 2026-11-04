import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Finding and removing repeating items, in a real browser at computer and phone width.
   FICTIONAL data only. Set SHOTS_DIR to save screenshots. */

async function shoot(page: Page, name: string, fullPage = false) {
  const dir = process.env.SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
}

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Pretend habits in Mind, Body and Art, a repeating line left in the Inbox by an older import, and a one-off. */
async function seed(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const made = await pageDate(page, -10);
  const ago = await pageDate(page, -2);
  await page.evaluate(
    async ({ made, ago }) => {
      const at = (path: string): Promise<any> => import(/* @vite-ignore */ path); // the app's own module (dev server)
      const repo = await at("/src/data/repo.ts");
      const t = { kind: "task", priority: 2 };
      await repo.createItem({ ...t, title: "Pretend stretch", areaId: "body", recur: ["mon", "wed", "fri"], doneDates: [ago] }, made);
      await repo.createItem({ ...t, title: "Pretend breathing", areaId: "mind", recur: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] }, made);
      await repo.createItem({ ...t, title: "Pretend sketch", areaId: "art", recur: ["sun"] }, made);
      await repo.createItem(
        { ...t, title: "Water the pretend herbs", areaId: "inbox", recur: ["sat"], source: { kind: "backlog", key: "backlog:water the pretend herbs" } },
        made,
      );
      await repo.createItem({ ...t, title: "Pretend one-off", areaId: "body" }, made);
    },
    { made, ago },
  );
}

for (const width of [1280, 390]) {
  test.describe(`repeating items at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 900 } });

    test("the panel says what repeats and where; Stop repeating keeps a one-off, Undo and Repeat again bring it back", async ({ page }) => {
      await seed(page);
      await page.goto("/area/body");
      await page.getByRole("button", { name: "Pretend stretch", exact: true }).click();
      const panel = page.getByRole("complementary", { name: "Pretend stretch" });
      await expect(panel.getByText("Repeats Mondays, Wednesdays and Fridays · in Body")).toBeVisible();
      await expect(panel.getByRole("link", { name: "Body" })).toHaveAttribute("href", "/area/body");
      await shoot(page, `panel-${width}`);

      await panel.getByRole("button", { name: "Stop repeating" }).click();
      await expect(panel.getByText("Used to repeat Mondays, Wednesdays and Fridays")).toBeVisible();
      await expect(page.getByText("Stopped repeating: Pretend stretch")).toBeVisible();
      await shoot(page, `panel-stopped-${width}`);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(panel.getByText("Repeats Mondays, Wednesdays and Fridays · in Body")).toBeVisible();

      // Stop, then Repeat again.
      await panel.getByRole("button", { name: "Stop repeating" }).click();
      await panel.getByRole("button", { name: "Repeat again" }).click();
      await expect(panel.getByText("Repeats Mondays, Wednesdays and Fridays · in Body")).toBeVisible();

      // Stopped for good: the strip leaves Habits and is an ordinary to-do in Body, history kept.
      await panel.getByRole("button", { name: "Stop repeating" }).click();
      const data = await page.evaluate(async () => {
        const repo = await import(/* @vite-ignore */ "/src/data/repo.ts" as string);
        const all = await repo.listItems();
        const it = all.find((i: { title: string }) => i.title === "Pretend stretch");
        return { recur: it.recur, status: it.status, areaId: it.areaId, doneDates: it.doneDates.length };
      });
      expect(data).toEqual({ recur: undefined, status: "open", areaId: "body", doneDates: 1 });
      await expect(page.getByRole("region", { name: "Habits" })).toHaveCount(0);
      await expect(page.getByRole("list", { name: "To-dos" })).toContainText("Pretend stretch");
      await noSideways(page);
    });

    test("ticking a repeating item only completes today", async ({ page }) => {
      await seed(page);
      await page.goto("/area/body");
      await page.getByRole("checkbox", { name: "Mark done: Pretend stretch" }).check();
      await expect(page.getByRole("checkbox", { name: "Done: Pretend stretch" })).toBeChecked();
      await page.getByRole("button", { name: "Pretend stretch", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "Pretend stretch" }).getByText(/^Repeats Mondays/)).toBeVisible();
    });

    test("Delete moves it to the Bin with Undo", async ({ page }) => {
      await seed(page);
      await page.goto("/area/art");
      await page.getByRole("button", { name: "Pretend sketch", exact: true }).click();
      const panel = page.getByRole("complementary", { name: "Pretend sketch" });
      await panel.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByText("Moved to the Bin: Pretend sketch")).toBeVisible();
      await expect(page.getByRole("button", { name: "Pretend sketch", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByRole("button", { name: "Pretend sketch", exact: true })).toBeVisible();
    });

    test("the Repeating page lists everything by area, Mind first; stop one, delete one", async ({ page }) => {
      await seed(page);
      // The way there: the footer links (the sidebar's, or the bottom of the phone's Home).
      await page.goto("/");
      await page.getByRole("link", { name: "Repeating" }).click();
      await expect(page).toHaveURL(/\/repeating$/);
      await expect(page.getByRole("heading", { level: 1, name: "Repeating" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Mind", "Art", "Body", "Inbox"]);
      await expect(page.getByText("Pretend one-off")).toHaveCount(0);
      const stretch = page.getByRole("listitem").filter({ hasText: "Pretend stretch" });
      await expect(stretch).toContainText("Mondays, Wednesdays and Fridays");
      await shoot(page, `repeating-${width}`, true);
      await noSideways(page);

      await page.getByRole("button", { name: "Stop repeating: Pretend stretch" }).click();
      await expect(page.locator(".strip-title", { hasText: "Pretend stretch" })).toHaveCount(0);
      await expect(page.getByText("Stopped repeating: Pretend stretch")).toBeVisible();
      await page.getByRole("button", { name: "Delete: Water the pretend herbs" }).click();
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Mind", "Art"]);
      await shoot(page, `repeating-after-${width}`, true);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Mind", "Art", "Inbox"]);

      // The old Inbox line opens in the panel with its area linking to the Inbox.
      await page.getByRole("button", { name: "Water the pretend herbs", exact: true }).click();
      const panel = page.getByRole("complementary", { name: "Water the pretend herbs" });
      await expect(panel.getByText("Repeats Saturdays · in Inbox")).toBeVisible();
      await expect(panel.getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/inbox");
    });

    test("an area's Habits box ends with Manage repeats", async ({ page }) => {
      await seed(page);
      await page.goto("/area/mind");
      const box = page.getByRole("region", { name: "Habits" });
      const link = box.getByRole("link", { name: "Manage repeats" });
      await link.scrollIntoViewIfNeeded();
      await shoot(page, `habits-box-${width}`);
      await link.click();
      await expect(page).toHaveURL(/\/repeating$/);
      await expect(page.getByRole("heading", { level: 1, name: "Repeating" })).toBeVisible();
    });
  });
}
