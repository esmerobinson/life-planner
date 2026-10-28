import { expect, test, type Page } from "@playwright/test";
import { pageDate } from "./helpers";

type Seed = { id: string; title: string; due?: string; touchedAt: string };

/** Writing raw rows into IndexedDB is the only way to backdate touchedAt; acceptable for a seed. */
async function seedItems(page: Page, rows: Seed[]) {
  await page.evaluate(async (rs) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open("life-hub");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("items", "readwrite");
      for (const r of rs) {
        tx.objectStore("items").put({
          id: r.id,
          kind: "task",
          title: r.title,
          links: [],
          areaId: "art",
          priority: 3,
          status: "open",
          createdAt: r.touchedAt,
          touchedAt: r.touchedAt,
          ...(r.due ? { due: r.due } : {}),
        });
      }
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, rows);
}

test("Inbox shows overdue, due soon and stale tasks and the count drops when a date is saved", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Nothing planned for today.").first()).toBeVisible();
  const today = await pageDate(page, 0);
  await seedItems(page, [
    { id: "a1", title: "Pretend late errand", due: await pageDate(page, -3), touchedAt: today },
    { id: "a2", title: "Pretend soon errand", due: await pageDate(page, 2), touchedAt: today },
    { id: "a3", title: "Pretend forgotten errand", touchedAt: await pageDate(page, -20) },
  ]);
  await page.goto("/inbox");

  await expect(page.getByRole("heading", { name: "Needs a look" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overdue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Due soon" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not looked at in a while" })).toBeVisible();
  await expect(page.getByText("Overdue by 3 days.")).toBeVisible();
  await expect(page.getByText("Due in 2 days.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Inbox (3)" })).toBeVisible();

  await page.getByLabel("Change due date for Pretend late errand").fill(await pageDate(page, 40));
  await page.getByRole("button", { name: "Save date for Pretend late errand" }).click();
  await expect(page.getByText("Pretend late errand")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Inbox (2)" })).toBeVisible();
});
