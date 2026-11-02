import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* Desktop Home's "Goals this month" column (2026-11-02: "when you size it, it sits too closely
   to Today"): at least 32px clear of the Today column at every desktop width, and below Today
   (never squashed) under 1000px. All data is fictional. */

async function seedGoals(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page, 0);
  const items = [
    { id: "t1", kind: "task", title: "Sketch the pretend lighthouse", links: [], areaId: "art", priority: 2, status: "open", createdAt: today, touchedAt: today, pinnedDate: today },
    { id: "t2", kind: "task", title: "A fictional long title for a to-do that goes on and on so it has to wrap somewhere", links: [], areaId: "content", priority: 2, status: "open", createdAt: today, touchedAt: today, due: today },
  ];
  const goals = [
    { id: "g1", title: "Post twice a week (pretend)", areaId: "content", kind: "practice", monthlyTarget: 8, milestones: [], createdAt: today },
    { id: "g3", title: "Learn pretend watercolour", areaId: "art", kind: "practice", monthlyTarget: 4, milestones: [], createdAt: today },
  ];
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
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Goals this month" }).getByRole("link", { name: "Learn pretend watercolour" })).toBeVisible();
}

async function boxes(page: Page) {
  return page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const strips = [...document.querySelectorAll(".home-centre .strip")].map((e) => e.getBoundingClientRect().right);
    return {
      centre: r(".home-centre"),
      goals: r(".home-goals"),
      stripsRight: Math.max(...strips),
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

for (const width of [1440, 1280, 1100, 1000]) {
  test(`at ${width}px the goals column sits beside Today with at least 32px clear`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedGoals(page);
    const b = await boxes(page);
    expect(b.goals.top).toBeLessThan(b.centre.top + 1); // beside, not below
    expect(b.goals.left - b.stripsRight).toBeGreaterThanOrEqual(32);
    expect(b.goals.left - b.centre.right).toBeGreaterThanOrEqual(32);
    expect(b.sideways).toBe(false);
  });
}

for (const width of [990, 900, 760]) {
  test(`at ${width}px the goals column wraps below Today (never squashed against it)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedGoals(page);
    const b = await boxes(page);
    expect(b.goals.top).toBeGreaterThanOrEqual(b.centre.bottom + 32 - 1);
    await expect(page.getByRole("heading", { name: "Goals this month" })).toBeVisible();
    expect(b.sideways).toBe(false);
  });
}
