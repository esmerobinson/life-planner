import { expect, test, type Page } from "@playwright/test";

/* "Today's routine" on Home (Esme approved, 17 Nov 2026), in a real browser at the Mac's 1280
   and the phone's 390: under the goals (the phone has no goals column: under Today), the next
   step highlighted, a linked step and its habit ticking each other, the 3am day, and an edit
   round trip. All data is fictional. */

type Row = Record<string, unknown>;
const DAY = "2026-11-17";
const NEXT = "2026-11-18";

async function seed(page: Page, stores: Record<string, Row[]>) {
  await page.evaluate(async (s) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(Object.keys(s), "readwrite");
      for (const [name, rows] of Object.entries(s)) for (const r of rows) tx.objectStore(name).put(r);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, stores);
}

/** Home at a fixed time on DAY, with a pretend goal on Home and two pretend habits. */
async function open(page: Page, width: number, time = `${DAY}T10:00:00`) {
  await page.clock.setFixedTime(new Date(time));
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Today's routine" })).toBeVisible();
  const every = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const habit = (id: string, title: string): Row => ({
    id, kind: "task", title, links: [], areaId: "mind", priority: 2, status: "open", createdAt: "2026-11-01", touchedAt: "2026-11-01", recur: every,
  });
  await seed(page, {
    items: [habit("h-vit", "Vitamins (pretend)"), habit("h-plan", "Plan my day (pretend)")],
    goals: [{ id: "g1", title: "Learn pretend watercolour", areaId: "art", kind: "practice", monthlyTarget: 4, milestones: [], createdAt: "2026-11-01", onHome: true }],
  });
  await page.reload();
  await expect(page.getByText("0 of 10 today")).toBeVisible();
}

/** The routine's own ticks stored on this device (the count on screen shows a tap at once). */
const storedTicks = (page: Page) =>
  page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: { id: string; done: boolean }[] = await new Promise((res) => {
      const g = db.transaction("prefs").objectStore("prefs").getAll();
      g.onsuccess = () => res(g.result);
    });
    db.close();
    return rows.filter((r) => r.id.startsWith("routine-tick:") && r.done).length;
  });

const routine = (page: Page) => page.getByRole("region", { name: "Today's routine" });
const next = (page: Page) => routine(page).locator('[aria-current="step"]');

for (const width of [1280, 390]) {
  test.describe(`at ${width}px`, () => {
    test("the routine sits under the goals (under Today on the phone), compact, the next step highlighted", async ({ page }) => {
      await open(page, width);
      const r = await routine(page).boundingBox();
      if (width === 1280) {
        const goals = page.getByRole("complementary", { name: "Goals this month" });
        await expect(goals.getByRole("region", { name: "Today's routine" })).toBeVisible();
        const card = await goals.locator(".goal-mini").last().boundingBox();
        expect(r!.y).toBeGreaterThan(card!.y + card!.height);
      } else {
        const today = await page.locator(".today-panel").boundingBox();
        expect(r!.y).toBeGreaterThanOrEqual(today!.y + today!.height);
      }
      await expect(next(page)).toContainText("Up between 8 and 9am");
      await expect(next(page)).toContainText("Minimum: out of bed in that window, even after a bad night");
      await expect(routine(page).getByRole("list", { name: "Next steps" }).getByRole("listitem")).toHaveCount(3);
      await expect(routine(page).getByText("More steps (7)")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

      await routine(page).getByRole("checkbox", { name: "Mark done: Up between 8 and 9am" }).click();
      await expect(page.locator('[data-testid="tick-sparkle"]')).toHaveCount(1);
      await expect(routine(page).getByText("1 of 10 today")).toBeVisible();
      await expect(next(page)).toContainText("5-minute meditation");
      await expect(routine(page).getByText("Done (1)")).toBeVisible();
    });

    test("a linked step and its habit tick each other (one tick, same history)", async ({ page }) => {
      await open(page, width);
      await routine(page).getByText("More steps (7)").click();
      const step = routine(page).getByRole("listitem").filter({ hasText: "Vitamins with morning tea" });
      await expect(step).toContainText("Linked to: Vitamins (pretend)");
      // Ticking the step ticks the habit on Today.
      await step.getByRole("checkbox").click();
      await expect(page.getByRole("checkbox", { name: "Done: Vitamins (pretend)" })).toBeChecked();
      await expect(routine(page).getByText("1 of 10 today")).toBeVisible();
      // Unticking the habit on Today unticks the step.
      await page.getByRole("checkbox", { name: "Done: Vitamins (pretend)" }).click();
      await expect(routine(page).getByText("0 of 10 today")).toBeVisible();
      // Ticking the habit on Today ticks the step.
      await page.getByRole("checkbox", { name: "Mark done: Vitamins (pretend)" }).click();
      await expect(routine(page).getByText("1 of 10 today")).toBeVisible();
      await routine(page).getByText("Done (1)").click();
      await expect(routine(page).getByRole("checkbox", { name: "Done: Vitamins with morning tea" })).toBeChecked();
    });

    test("ticks stay until 3am, then the list starts fresh", async ({ page }) => {
      await open(page, width, `${DAY}T23:30:00`);
      await routine(page).getByRole("checkbox", { name: "Mark done: Up between 8 and 9am" }).click();
      await expect(routine(page).getByText("1 of 10 today")).toBeVisible();
      await expect.poll(() => storedTicks(page)).toBe(1); // saved before the reload
      await page.clock.setFixedTime(new Date(`${NEXT}T02:30:00`));
      await page.reload();
      await expect(routine(page).getByText("1 of 10 today")).toBeVisible();
      await page.clock.setFixedTime(new Date(`${NEXT}T03:30:00`));
      await page.reload();
      await expect(routine(page).getByText("0 of 10 today")).toBeVisible();
      await expect(next(page)).toContainText("Up between 8 and 9am");
    });

    test("Edit routine: rename, minimum, unlink, reorder, add, remove; kept after a reload", async ({ page }) => {
      await open(page, width);
      await routine(page).getByRole("button", { name: "Edit routine" }).click();
      const sheet = page.getByRole("dialog", { name: "Edit routine" });
      const step = (n: number) => sheet.getByRole("listitem").nth(n);
      await expect(sheet.getByRole("listitem")).toHaveCount(10);
      await step(1).getByRole("textbox", { name: "Step" }).fill("Sit quietly (pretend)");
      await step(1).getByRole("textbox", { name: "Minimum" }).fill("one breath");
      await step(1).getByRole("textbox", { name: "Minimum" }).press("Enter");
      await expect(step(3).getByRole("combobox", { name: "Linked habit" })).toHaveValue("h-vit");
      await step(3).getByRole("combobox", { name: "Linked habit" }).selectOption({ label: "Not linked" });
      await step(1).getByRole("button", { name: "Move up: Sit quietly (pretend)" }).click();
      await expect(step(0).getByRole("textbox", { name: "Step" })).toHaveValue("Sit quietly (pretend)");
      await step(9).getByRole("button", { name: "Remove: Bed" }).click();
      await expect(sheet.getByRole("listitem")).toHaveCount(9);
      await sheet.getByRole("textbox", { name: "A new step" }).fill("Stretch (pretend)");
      await sheet.getByRole("button", { name: "Add", exact: true }).click();
      await expect(sheet.getByRole("listitem")).toHaveCount(10);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await sheet.getByRole("button", { name: "Done" }).click();
      await expect(sheet).toHaveCount(0);

      await page.reload();
      await expect(next(page)).toContainText("Sit quietly (pretend)");
      await expect(next(page)).toContainText("Minimum: one breath");
      await routine(page).getByText("More steps (7)").click();
      await expect(routine(page).getByText("Stretch (pretend)")).toBeVisible();
      await expect(routine(page).getByText("Bed", { exact: true })).toHaveCount(0);
      await expect(routine(page).getByText("Linked to: Vitamins (pretend)")).toHaveCount(0);
    });
  });
}
