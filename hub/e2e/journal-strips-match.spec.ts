import { expect, test, type Locator, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

/* The Journal rows look exactly like task strips (Esme, 2026-11-02: "green journal pages
   should look exactly like the other items appear elsewhere"): same height for the same
   content, padding, radius, tick box size and place, title and small-line type, and the gap
   between strips. Only the mint, the read-only ✓ and the streak differ. Fictional data only. */

async function seedTasks(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page, 0);
  const task = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, kind: "task", title, links: [], areaId: "art", priority: 2, status: "open", createdAt: today, touchedAt: today, ...extra,
  });
  const items = [task("t1", "Pretend plain to-do"), task("t2", "Pretend dated to-do", { due: await pageDate(page, 3) })];
  await page.evaluate(async (is) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(["items"], "readwrite");
      for (const r of is) tx.objectStore("items").put(r);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, items);
}

type Look = { h: number; pad: string; radius: string; tickW: number; tickH: number; tickX: number; tickMidY: number; titleSize: string; titleWeight: string; metaSize: string | null; metaOpacity: string | null };

async function look(strip: Locator): Promise<Look> {
  return strip.evaluate((el) => {
    const s = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const tick = el.querySelector(".tick, .tick-auto")!.getBoundingClientRect();
    const title = getComputedStyle(el.querySelector(".strip-title")!);
    const metaEl = el.querySelector(".strip-meta");
    const meta = metaEl ? getComputedStyle(metaEl) : null;
    return {
      h: s.height,
      pad: cs.padding,
      radius: cs.borderRadius,
      tickW: tick.width,
      tickH: tick.height,
      tickX: tick.left - s.left,
      tickMidY: tick.top + tick.height / 2 - s.top - s.height / 2,
      titleSize: title.fontSize,
      titleWeight: title.fontWeight,
      metaSize: meta?.fontSize ?? null,
      metaOpacity: meta?.opacity ?? null,
    };
  });
}

function same(journal: Look, task: Look) {
  expect(Math.abs(journal.h - task.h)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(journal.tickMidY - task.tickMidY)).toBeLessThanOrEqual(0.5);
  expect({ ...journal, h: 0, tickMidY: 0 }).toEqual({ ...task, h: 0, tickMidY: 0 });
}

test.use({ viewport: { width: 1280, height: 900 } });

test("Home's Journal rows match a task strip with the same content; 8px between strips", async ({ page }) => {
  await seedTasks(page);
  await page.goto("/area/art");
  const todos = page.getByRole("list", { name: "To-dos" });
  const plain = await look(todos.locator("li.strip", { hasText: "Pretend plain to-do" }));
  await page.goto("/");
  const rows = page.getByRole("list", { name: "Journal" }).locator("li.strip");
  await expect(rows).toHaveCount(3);
  // Locked here: no small line (the exercise's "Day N · Theme" needs the cards) and no streak.
  for (const i of [0, 1, 2]) same(await look(rows.nth(i)), plain);
  const gap = await rows.nth(0).evaluate((el) => el.nextElementSibling!.getBoundingClientRect().top - el.getBoundingClientRect().bottom);
  expect(gap).toBe(8);
});

test("Mind's Habits rows match a task strip with a small line", async ({ page }) => {
  await seedTasks(page);
  await page.goto("/area/art");
  const dated = await look(page.getByRole("list", { name: "To-dos" }).locator("li.strip", { hasText: "Pretend dated to-do" }));
  await page.goto("/area/mind");
  const habits = page.getByRole("list", { name: "Habits" }).locator("li.journal-row");
  await expect(habits).toHaveCount(3);
  for (const i of [0, 1, 2]) same(await look(habits.nth(i)), dated); // "every day" under the title
});
